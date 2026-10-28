"use strict";

const CONFIG = Object.freeze({
 startUtcMs: Date.parse("2026-10-28T22:59:00.000Z"),
 startIso: "2026-10-28T22:59:00.000Z",
 timeZone: "Asia/Dhaka",

 // Replace with your own HTTPS adapter only after validating its response.
 // Expected response: { "unixMs": 1793228340000, "source": "verified-adapter" }
 adapterUrl: "",
 syncIntervalMs: 15 * 60 * 1000,
 requestTimeoutMs: 8000,
 maximumAcceptedJumpMs: 24 * 60 * 60 * 1000
});

const state = {
 trustedEpochMs: null,
 monoAtSync: null,
 source: "No trusted source",
 lastSyncMs: null,
 uncertaintyMs: null,
 status: "Synchronization in progress.",
 timer: null,
 syncTimer: null,
 syncing: false
};

const $ = id => document.getElementById(id);

function monotonicMs() {
 return performance.timeOrigin + performance.now();
}

function estimatedNowMs() {
 if (Number.isFinite(state.trustedEpochMs) && Number.isFinite(state.monoAtSync)) {
 return state.trustedEpochMs + (monotonicMs() - state.monoAtSync);
 }
 return Date.now();
}

function setStatus(message, kind = "warn") {
 state.status = message;
 $("sync-status").textContent = message;
 $("runtime-badge").textContent = kind === "good" ? "Trusted estimate" : "Needs attention";
 $("status-dot").className = `status-dot ${kind}`;
}

function formatNumber(value) {
 return value.toLocaleString("en-US");
}

function pad(value, width = 2) {
 return String(value).padStart(width, "0");
}

function formatDateTime(ms) {
 return new Intl.DateTimeFormat("en-GB", {
 timeZone: CONFIG.timeZone,
 dateStyle: "medium",
 timeStyle: "medium",
 hour12: false
 }).format(new Date(ms));
}

function formatLocalClock(ms) {
 return new Intl.DateTimeFormat("en-GB", {
 timeZone: CONFIG.timeZone,
 dateStyle: "full",
 timeStyle: "medium",
 hour12: true
 }).format(new Date(ms));
}

function addMonthsClamped(date, months) {
 const result = new Date(date.getTime());
 const day = result.getUTCDate();
 result.setUTCDate(1);
 result.setUTCMonth(result.getUTCMonth() + months);
 const lastDay = new Date(Date.UTC(
 result.getUTCFullYear(),
 result.getUTCMonth() + 1,
 0
 )).getUTCDate();
 result.setUTCDate(Math.min(day, lastDay));
 return result;
}

function calendarDifference(startMs, endMs) {
 if (endMs <= startMs) {
 return { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
 }

 const start = new Date(startMs);
 const end = new Date(endMs);

 let cursor = new Date(startMs);
 let years = end.getUTCFullYear() - cursor.getUTCFullYear();

 if (years > 0) {
 const candidate = new Date(Date.UTC(
 cursor.getUTCFullYear() + years,
 cursor.getUTCMonth(),
 cursor.getUTCDate(),
 cursor.getUTCHours(),
 cursor.getUTCMinutes(),
 cursor.getUTCSeconds()
 ));

 if (candidate > end) years--;
 cursor = new Date(Date.UTC(
 cursor.getUTCFullYear() + years,
 cursor.getUTCMonth(),
 cursor.getUTCDate(),
 cursor.getUTCHours(),
 cursor.getUTCMinutes(),
 cursor.getUTCSeconds()
 ));
 }

 let months = (end.getUTCFullYear() - cursor.getUTCFullYear()) * 12 +
 end.getUTCMonth() - cursor.getUTCMonth();

 if (months > 0) {
 const candidate = addMonthsClamped(cursor, months);
 if (candidate > end) months--;
 cursor = addMonthsClamped(cursor, months);
 }

 let remainder = Math.max(0, endMs - cursor.getTime());
 const dayMs = 86400000;
 const hourMs = 3600000;
 const minuteMs = 60000;
 const secondMs = 1000;

 const days = Math.floor(remainder / dayMs);
 remainder %= dayMs;

 const hours = Math.floor(remainder / hourMs);
 remainder %= hourMs;

 const minutes = Math.floor(remainder / minuteMs);
 remainder %= minuteMs;

 const seconds = Math.floor(remainder / secondMs);

 return { years, months, days, hours, minutes, seconds };
}

function updateDisplay() {
 const nowMs = estimatedNowMs();
 const elapsedMs = Math.max(0, nowMs - CONFIG.startUtcMs);
 const elapsedNs = BigInt(Math.floor(elapsedMs)) * 1000000n;

 const totalSeconds = elapsedNs / 1000000000n;
 const nanoseconds = elapsedNs % 1000000000n;
 const totalMinutes = totalSeconds / 60n;
 const totalHours = totalSeconds / 3600n;
 const totalDays = totalSeconds / 86400n;

 const remainingSeconds = totalSeconds % 60n;
 const remainingMinutes = totalMinutes % 60n;
 const remainingHours = totalHours % 24n;

 const calendar = calendarDifference(CONFIG.startUtcMs, nowMs);

 $("calendar-elapsed").textContent =
 `${pad(calendar.years)} : ${pad(calendar.months)} : ${pad(calendar.days)} : ` +
 `${pad(calendar.hours)} : ${pad(calendar.minutes)} : ${pad(calendar.seconds)}`;

 $("total-days").textContent =
 `${formatNumber(Number(totalDays))} : ${pad(remainingHours)} : ` +
 `${pad(remainingMinutes)} : ${pad(remainingSeconds)}`;

 $("total-hours").textContent =
 `${formatNumber(Number(totalHours))} : ${pad(remainingMinutes)} : ${pad(remainingSeconds)}`;

 $("total-minutes").textContent =
 `${formatNumber(Number(totalMinutes))} : ${pad(remainingSeconds)} : ${nanoseconds.toString().padStart(9, "0")}`;

 $("total-seconds-ns").textContent =
 `${formatNumber(Number(totalSeconds))} : ${nanoseconds.toString().padStart(9, "0")}`;

 $("full-seconds").textContent = totalSeconds.toString();
 $("bd-time").textContent = formatLocalClock(nowMs);

 if (nowMs < CONFIG.startUtcMs) {
 $("calendar-elapsed").textContent = "STARTS IN THE FUTURE";
 setStatus("The permanent start instant has not yet occurred.", "warn");
 }
}

function validateSample(unixMs) {
 if (!Number.isFinite(unixMs) || unixMs < 0) {
 throw new Error("Invalid time sample.");
 }

 const localNow = Date.now();

 if (
 state.trustedEpochMs !== null &&
 Math.abs(unixMs - localNow) > CONFIG.maximumAcceptedJumpMs &&
 Math.abs(unixMs - state.trustedEpochMs) > CONFIG.maximumAcceptedJumpMs
 ) {
 throw new Error("Suspicious time jump rejected.");
 }

 return unixMs;
}

async function fetchAdapterTime() {
 if (!CONFIG.adapterUrl) throw new Error("No HTTPS time adapter configured.");

 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
 const requestStart = monotonicMs();

 try {
 const response = await fetch(CONFIG.adapterUrl, {
 method: "GET",
 cache: "no-store",
 headers: { "Accept": "application/json" },
 signal: controller.signal
 });

 if (!response.ok) throw new Error(`Adapter HTTP ${response.status}`);

 const body = await response.json();
 const receivedAt = monotonicMs();
 const unixMs = Number(body.unixMs);

 validateSample(unixMs);

 return {
 unixMs: unixMs + Math.max(0, (receivedAt - requestStart) / 2),
 source: String(body.source || "HTTPS time adapter"),
 uncertaintyMs: Math.max(1, receivedAt - requestStart)
 };
 } finally {
 clearTimeout(timeout);
 }
}

async function synchronize() {
 if (state.syncing) return;
 state.syncing = true;
 setStatus("Synchronization in progress.", "warn");

 try {
 const sample = await fetchAdapterTime();

 state.trustedEpochMs = sample.unixMs;
 state.monoAtSync = monotonicMs();
 state.source = sample.source;
 state.lastSyncMs = Date.now();
 state.uncertaintyMs = sample.uncertaintyMs;

 $("source-name").textContent = state.source;
 $("last-sync").textContent = formatDateTime(state.lastSyncMs);
 $("uncertainty").textContent = `approximately ±${Math.round(state.uncertaintyMs)} ms`;

 setStatus("Trusted HTTPS time estimate active.", "good");
 } catch (error) {
 if (state.trustedEpochMs !== null) {
 setStatus("Last trusted time source temporarily unavailable; offline estimate in use.", "warn");
 $("source-name").textContent = state.source;
 $("uncertainty").textContent = "Growing while offline";
 } else {
 state.trustedEpochMs = Date.now();
 state.monoAtSync = monotonicMs();
 state.source = "Device clock fallback";
 state.lastSyncMs = null;
 state.uncertaintyMs = null;

 $("source-name").textContent = state.source;
 $("last-sync").textContent = "None";
 $("uncertainty").textContent = "Unknown";

 setStatus("Device-clock fallback in use; synchronization accuracy is uncertain.", "warn");
 }
 } finally {
 state.syncing = false;
 updateDisplay();
 }
}

function copyText(text) {
 return navigator.clipboard?.writeText(text).catch(() => {
 const area = document.createElement("textarea");
 area.value = text;
 document.body.appendChild(area);
 area.select();
 document.execCommand("copy");
 area.remove();
 });
}

function bindControls() {
 document.querySelectorAll("[data-copy]").forEach(button => {
 button.addEventListener("click", async () => {
 const element = $(button.dataset.copy);
 const text = element.value ?? element.textContent;
 await copyText(text.trim());
 const original = button.textContent;
 button.textContent = "Copied";
 setTimeout(() => { button.textContent = original; }, 1200);
 });
 });

 window.addEventListener("online", synchronize);
 window.addEventListener("focus", synchronize);
 document.addEventListener("visibilitychange", () => {
 if (!document.hidden) synchronize();
 });
 window.addEventListener("pageshow", synchronize);
}

function init() {
 bindControls();
 updateDisplay();
 synchronize();

 state.timer = setInterval(updateDisplay, 250);
 state.syncTimer = setInterval(synchronize, CONFIG.syncIntervalMs);
}

init();
