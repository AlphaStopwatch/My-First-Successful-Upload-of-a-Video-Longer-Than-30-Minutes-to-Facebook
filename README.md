# Infinite Stopwatch — since 2026-10-29T04:59:00+06:00 (Asia/Dhaka)

Static site: `index.html`, `style.css`, `script.js`. No dependencies, no tracking.

**Run locally:** `python3 -m http.server` in this folder, open http://localhost:8000
(opening via `file://` works but time sync fails, so the device clock is used and labelled as such).
**Deploy:** push the folder to a GitHub repo → Settings → Pages → deploy from branch.
**Tests:** `node test.js` (arithmetic, BigInt, calendar boundaries).

## Time source — honest status
- **BSTI / time.gov.bd is NOT integrated.** No verified, browser-accessible (HTTPS/CORS) interface was found; browsers cannot speak NTP (UDP). Nothing is scraped or guessed.
- **Actually used:** the HTTP `Date` header of the host serving the page (1 s resolution, ±~0.5 s plus half the round trip). Labelled "not an official or atomic source". Best of 3 samples by lowest round trip; malformed/implausible/slow responses rejected; a >60 s jump needs a second confirming sync.
- **Optional adapter:** set `CONFIG.ADAPTER_URL` to an HTTPS endpoint returning `{"unixMs": <number>}` with CORS enabled (e.g. a small proxy to a real NTP server). The adapter itself is **not included**.
- **Offline:** last sync + `performance.now()`; uncertainty shown. If the device clock and monotonic clock disagree by >2 s (sleep/clock change) the status becomes "uncertain" and a resync is attempted.
- Re-sync triggers: load, every 10 min, tab visible, focus, bfcache restore, back online; exponential backoff on failure.

## Known limitations
Calendar panel uses JS `Date` (valid to ~±275,000 years; totals use BigInt beyond that). Month borrow uses the length of the previous month. Browser/UI tests (Android widths, console, sleep, throttling) were **not run** here.
