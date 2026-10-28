'use strict';
/* ---------- 1. Permanent configuration ---------- */
const CONFIG = Object.freeze({
  START_ISO: '2026-10-29T04:59:00+06:00',
  START_UTC_ISO: '2026-10-28T22:59:00.000Z',
  TZ: 'Asia/Dhaka', OFFSET_MS: 6 * 3600000,
  ADAPTER_URL: '',                       // optional: HTTPS endpoint returning {"unixMs": <number>}
  ADAPTER_LABEL: 'Custom time adapter',  // shown verbatim; never claimed official
  SYNC_MS: 600000, SAMPLES: 3, TIMEOUT_MS: 6000, MAX_RTT_MS: 5000, MAX_JUMP_MS: 60000
});
const START_MS = Date.parse(CONFIG.START_UTC_ISO);
const START_OK = START_MS === Date.parse(CONFIG.START_ISO);
const NS_MS = 1000000n, NS_S = 1000000000n;

/* ---------- 2. Pure arithmetic (BigInt, no floats) ---------- */
function elapsedNsFrom(nowNs) { return nowNs - BigInt(START_MS) * NS_MS; }
function splitTotals(ns) {
  const nsRem = ns % NS_S, S = ns / NS_S;
  const sec = S % 60n, M = S / 60n, min = M % 60n, H = M / 60n, hr = H % 24n, days = H / 24n;
  return { ns, nsRem, S, sec, M, min, H, hr, days };
}
const pad = (b, n) => b.toString().padStart(n, '0');
const group = (b) => b.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
function calendarDiff(startMs, nowMs, off) {
  const a = new Date(startMs + off), b = new Date(nowMs + off);
  if (isNaN(a) || isNaN(b) || nowMs < startMs) return null;
  let y = b.getUTCFullYear() - a.getUTCFullYear(), mo = b.getUTCMonth() - a.getUTCMonth(),
      d = b.getUTCDate() - a.getUTCDate(), h = b.getUTCHours() - a.getUTCHours(),
      mi = b.getUTCMinutes() - a.getUTCMinutes(), s = b.getUTCSeconds() - a.getUTCSeconds();
  if (s < 0) { s += 60; mi--; } if (mi < 0) { mi += 60; h--; } if (h < 0) { h += 24; d--; }
  if (d < 0) { d += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate(); mo--; }
  if (mo < 0) { mo += 12; y--; }
  return { y, mo, d, h, mi, s };
}

/* ---------- 3. Trusted-time estimator ---------- */
const Clock = {
  ref: null, mode: 'syncing', uncertain: false, pending: null, failures: 0, timer: null, busy: false,
  nowNs() {
    if (!this.ref) return BigInt(Date.now()) * NS_MS;
    return this.ref.epochNs + BigInt(Math.round((performance.now() - this.ref.perf) * 1e6));
  },
  uncertaintyMs() {
    if (!this.ref) return null;
    return this.ref.uncMs + (performance.now() - this.ref.perf) * 5e-5 + (this.uncertain ? 2000 : 0);
  }
};
const plausible = (ms) => Number.isFinite(ms) && ms > Date.parse('2024-01-01') && ms < Date.parse('2200-01-01');

async function oneSample() {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), CONFIG.TIMEOUT_MS);
  const adapter = !!CONFIG.ADAPTER_URL;
  let url = adapter ? CONFIG.ADAPTER_URL : location.href.split('#')[0];
  if (!adapter) url += (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
  const t0 = performance.now();
  try {
    const r = await fetch(url, { method: adapter ? 'GET' : 'HEAD', cache: 'no-store', signal: ctl.signal });
    const t1 = performance.now(), rtt = t1 - t0;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (rtt > CONFIG.MAX_RTT_MS) throw new Error('round trip too slow');
    let epochMs, uncMs, label, res;
    if (adapter) {
      const j = await r.json(); epochMs = j && j.unixMs;
      if (typeof epochMs !== 'number' || !plausible(epochMs)) throw new Error('malformed adapter response');
      epochMs += rtt / 2; uncMs = rtt / 2 + 1; label = CONFIG.ADAPTER_LABEL + ' (1 ms resolution)'; res = 1;
    } else {
      const dh = r.headers.get('Date'), ms = Date.parse(dh);
      if (!dh || !plausible(ms)) throw new Error('missing or malformed Date header');
      epochMs = ms + 500 + rtt / 2; uncMs = 500 + rtt / 2;
      label = 'HTTP Date header of this page’s host (1 s resolution; not an official or atomic source)'; res = 1000;
    }
    return { epochMs, uncMs, perf: t1, rtt, label, adapter };
  } finally { clearTimeout(to); }
}

async function syncNow() {
  if (Clock.busy) return; Clock.busy = true; render(true);
  try {
    const got = [];
    for (let i = 0; i < CONFIG.SAMPLES; i++) { try { got.push(await oneSample()); } catch (e) { if (!got.length && i === CONFIG.SAMPLES - 1) throw e; } }
    if (!got.length) throw new Error('no valid samples');
    got.sort((a, b) => a.uncMs - b.uncMs); const best = got[0];
    const current = Number(Clock.nowNs() / NS_MS), est = best.epochMs + (performance.now() - best.perf);
    if (Clock.ref && Math.abs(est - current) > CONFIG.MAX_JUMP_MS + Clock.ref.uncMs) {
      const p = Clock.pending;
      if (!(p && Math.abs(est - p) < 5000)) { Clock.pending = est; throw new Error('suspicious time jump; awaiting confirmation'); }
    }
    Clock.pending = null;
    Clock.ref = { epochNs: BigInt(Math.round(best.epochMs * 1e6)), perf: best.perf, wall: Date.now(),
                  uncMs: best.uncMs, label: best.label, at: Number(best.epochMs), rtt: best.rtt };
    Clock.mode = 'synced'; Clock.uncertain = false; Clock.failures = 0; Clock.lastError = null;
  } catch (e) {
    Clock.failures++; Clock.lastError = e.message; Clock.mode = Clock.ref ? 'offline' : 'device';
    console.warn('[time sync failed]', e.message);
  } finally { Clock.busy = false; schedule(); render(true); }
}
function schedule() {
  clearTimeout(Clock.timer);
  const d = Clock.failures ? Math.min(CONFIG.SYNC_MS, 5000 * 2 ** (Clock.failures - 1)) : CONFIG.SYNC_MS;
  Clock.timer = setTimeout(syncNow, d);
}
function resyncSoon() { if (!Clock.busy) syncNow(); }

/* ---------- 4. Rendering ---------- */
const $ = (id) => document.getElementById(id);
const dF = new Intl.DateTimeFormat('en-GB', { timeZone: CONFIG.TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const tF = new Intl.DateTimeFormat('en-GB', { timeZone: CONFIG.TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
let lastSec = -1n, lastTotalSeconds = '0';
const STATUS = {
  synced: ['ok', 'Time synchronized to the host’s HTTP clock (not official BSTI time)'],
  syncing: ['', 'Synchronization in progress — showing device clock meanwhile'],
  offline: ['bad', 'Last trusted time source unavailable — offline estimate in use'],
  device: ['bad', 'Device-clock fallback in use — accuracy unknown']
};
function render(force) {
  const nowNs = Clock.nowNs(), nowMs = Number(nowNs / NS_MS);
  const pre = nowNs < BigInt(START_MS) * NS_MS;
  const t = splitTotals(pre ? 0n : elapsedNsFrom(nowNs));
  const fast = `${pad(t.nsRem, 9)}`;
  $('D').textContent = `${group(t.M)} : ${pad(t.sec, 2)} . ${fast}`;
  $('E').textContent = `${group(t.S)} . ${fast}`;
  if (t.S === lastSec && !force) return;
  lastSec = t.S; lastTotalSeconds = t.S.toString();
  $('B').textContent = `${group(t.days)} : ${pad(t.hr, 2)} : ${pad(t.min, 2)} : ${pad(t.sec, 2)}`;
  $('C').textContent = `${group(t.H)} : ${pad(t.min, 2)} : ${pad(t.sec, 2)}`;
  $('F').textContent = group(t.S);
  const c = pre ? null : calendarDiff(START_MS, nowMs, CONFIG.OFFSET_MS);
  $('A').textContent = c ? `${c.y} : ${pad(BigInt(c.mo), 2)} : ${pad(BigInt(c.d), 2)} : ${pad(BigInt(c.h), 2)} : ${pad(BigInt(c.mi), 2)} : ${pad(BigInt(c.s), 2)}`
    : (pre ? '0 : 00 : 00 : 00 : 00 : 00' : 'beyond calendar range — see total panels');
  const n = $('notice');
  n.hidden = !(pre || !START_OK);
  n.textContent = !START_OK ? 'Configuration error: start timestamp representations disagree.'
    : 'By the current clock estimate, the reference moment has not occurred yet; the counter shows zero until it does.';
  $('bdDate').textContent = dF.format(nowMs); $('bdTime').textContent = tF.format(nowMs);
  const [cls, txt] = STATUS[Clock.busy && !Clock.ref ? 'syncing' : Clock.mode];
  $('dot').className = 'dot ' + cls; $('status').textContent = txt + (Clock.uncertain && Clock.mode !== 'device' ? ' (accuracy currently uncertain)' : '');
  const u = Clock.uncertaintyMs();
  $('src').textContent = Clock.ref ? Clock.ref.label : 'Device system clock (unverified)';
  $('last').textContent = Clock.ref ? tF.format(Clock.ref.at) + ' Bangladesh time' + (Clock.lastError ? ` · last retry failed: ${Clock.lastError}` : '') : (Clock.lastError ? 'none · ' + Clock.lastError : 'none yet');
  $('unc').textContent = u == null ? 'unknown' : '± ' + (u < 1000 ? u.toFixed(0) + ' ms' : (u / 1000).toFixed(2) + ' s');
  $('subs').textContent = 'Mathematical representation of an estimate (monotonic clock, ~0.1–1 ms resolution). Not measured nanosecond accuracy.';
}

/* ---------- 5. Recovery hooks, loop, controls ---------- */
function tick() {
  if (Clock.ref) {
    const drift = (Date.now() - Clock.ref.wall) - (performance.now() - Clock.ref.perf);
    if (Math.abs(drift) > 2000 && !Clock.uncertain) { Clock.uncertain = true; resyncSoon(); }
  }
  render(false);
}
function frame() { render(false); requestAnimationFrame(frame); }
function init() {
  render(true); syncNow(); setInterval(tick, 1000); requestAnimationFrame(frame);
  addEventListener('online', resyncSoon); addEventListener('focus', resyncSoon);
  addEventListener('pageshow', (e) => { if (e.persisted) resyncSoon(); });
  addEventListener('offline', () => { Clock.mode = Clock.ref ? 'offline' : 'device'; render(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { resyncSoon(); render(true); } });
  const toast = (m) => { $('toast').textContent = m; setTimeout(() => { $('toast').textContent = ''; }, 2500); };
  const copy = async (text, ok) => {
    try { await navigator.clipboard.writeText(text); toast(ok); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? toast(ok) : toast('Copy not available'); } catch (_) { toast('Copy not available'); } ta.remove(); }
  };
  $('copyStart').onclick = () => copy(`${CONFIG.START_ISO} (${CONFIG.START_UTC_ISO})`, 'Start timestamp copied');
  $('copyTotal').onclick = () => copy(lastTotalSeconds, 'Total seconds copied (plain digits)');
  $('btnDetail').onclick = (e) => { const h = document.body.classList.toggle('hide-detail');
    e.target.textContent = h ? 'Show precision details' : 'Hide precision details'; e.target.setAttribute('aria-pressed', String(!h)); };
  $('btnCompact').onclick = (e) => { const c = $('full').hidden = !$('full').hidden; $('short').hidden = !c;
    e.target.textContent = c ? 'Full story' : 'Compact story'; e.target.setAttribute('aria-pressed', String(c)); };
}
if (typeof document !== 'undefined') init();
if (typeof module !== 'undefined') module.exports = { CONFIG, START_MS, START_OK, splitTotals, calendarDiff, group, pad, elapsedNsFrom };
