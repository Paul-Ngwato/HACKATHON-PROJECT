# AttendEase — Issues Log

Every problem this build actually hit, what caused it, what changed, and how it was checked — in one
table you can read in three minutes. The long-form version, with code detail, is
[`docs/ISSUES-SOLVED.md`](../docs/ISSUES-SOLVED.md).

`AttendEase v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE`

---

## 1. The twenty, at a glance

| # | Issue | Area | Fixed in | Verified by |
|---|---|---|---|---|
| 1 | Attendance rules lived in the browser; two tabs disagreed | correctness | `server/domain.cjs` | two browsers, one database |
| 2 | Pressing POST hung forever on a pending geolocation promise | UX | `assets/js/location.js` | permission blocked → returns with a reason |
| 3 | "No GPS fix yet" blamed the weather for three different failures | UX | `assets/js/location.js` | each branch forced and read back |
| 4 | The APK could never get a location at all | packaging | both manifests | `aapt` lists the permissions |
| 5 | The student scan froze at Step 1 after a live re-render | UX | `scanDeadline`/`scanTimer` | refresh mid-scan still lands on Step 2 |
| 6 | A posted student could post again in a new window | correctness | `Rules.checkIn` (same-day gate) | window B refused, quoting the time |
| 7 | The student screen still offered a code box after posting | UX | `postedToday()` in the view | no input, no button, original time shown |
| 8 | A whole class posting would queue behind itself | performance | revision-only SSE, coalescing | 85 posts, 0 failures, 252 ms |
| 9 | Bluetooth was announced but never actually scanned | honesty | `ble.js` + native plugin | plugin in the APK, label changes with reality |
| 10 | The lecturer could not tell who had just posted | product | *Posted this session* panel | name, reg no, time, NEW badge |
| 11 | Sign-in and first-run screens broke the portal skin | UI | `views/login.js`, `portal.css` | DOM checks: header `rgb(11,93,46)` |
| 12 | No way to rescan when the scan found the wrong class | UX | **SCAN AGAIN** in all states | button rendered in the found box |
| 13 | The lecturer had one unit in a timetable demo | demo data | `server/seed.cjs` | three cards, correct rooms and counts |
| 14 | The Android build was impossible on this machine | toolchain | `.toolchain/`, `local.properties` | reproducible `BUILD SUCCESSFUL` |
| 15 | The README described a different product | docs | README + `docs/` | every claim checked against the system |
| 16 | Every native call silently did nothing inside the APK | **transport** | `nativePlugin()` via `Capacitor.Plugins` | bridge plugin list in the error text |
| 17 | Discovery found the phone; the socket never opened | **transport** | Bluetooth RFCOMM lane | transport tests; device pass owed |
| 18 | Bluetooth could carry a request but not the live feed | **transport** | `serveOne(..., allowEvents)` | `/api/events` refused, 6/6 tests |
| 19 | On one handset the student app could not see the register beside it | **transport** | loopback probe in `ClassFinder` | probe present in `classes8.dex`, APKs rebuilt |
| 20 | The docs described a laptop server per campus | docs | `dist/` pack | every path, port and count read from code |

---

## 2. The five that mattered most

**#1 — the rules were in the wrong place.** Validating in the browser meant clearing storage wiped the
university and two tabs could disagree about who was present. Everything moved behind one writer: the
register document on the lecturer's phone (`Rules.java`), and the same contract in `server/domain.cjs`
for the laptop edition.

**#8 — the burst.** Check-in used to return the whole database and broadcast a frame per post: 85
students meant 85 snapshots per phone. The reply now carries only the record and a revision, frames
are coalesced at 150 ms, and clients pull one snapshot per burst. Measured 85 posts, 0 failures,
252 ms, p95 224 ms.

**#16 — the silent bridge.** `Capacitor.registerPlugin()` is not injected by the Android bridge; it
lives in `@capacitor/core`'s JS bundle, which this app does not ship. Every plugin lookup returned
`undefined` and nothing threw. Fixed by reading `Capacitor.Plugins[name]`, with `registerPlugin` only
as a fallback — and by making the failure message name the plugins that *were* available.

**#17 — the campus network.** Discovery returned the lecturer's address, then no socket opened: the
access point isolates clients. That is why a Bluetooth lane exists at all — and why the JS retries a
request on it **only** when the fetch itself failed, so a refusal is never posted twice.

**#19 — one phone.** With both APKs on a single handset, the student app searched Wi-Fi and Bluetooth
and found nothing, because discovery assumed two devices. It now probes
`http://127.0.0.1:4173/api/health` first and treats an answer as `via:"loopback"`. Two APKs rebuilt,
tests green, probe confirmed inside `classes8.dex`.

---

## 3. Open gaps (the honest list)

These are the entries a judge should be able to find, and they are also opened as issues on the
GitHub repository so they cannot quietly disappear.

| Gap | Why it matters | Next action |
|---|---|---|
| No two-phone hardware walk-through | the APKs are built and statically verified; pairing, RFCOMM throughput and the WebView LAN fetch are unproven on real handsets | install both APKs, run one session, record timings |
| No institutional authentication | demo accounts are the identity; a register entry is not yet tied to a verified person | SSO (institutional email / ERP), server-side authorisation |
| Bluetooth needs a one-time pairing per student | a new class must open the 5-minute *findable* window | Wi-Fi Direct group with fixed credentials, or a `WifiNetworkSpecifier` join (one approval, then silent) |
| No offline queue in the student app | a post is lost if the radio dies mid-request | queue locally, retry on next launch, idempotent by record id |
| Live updates unavailable over Bluetooth | a serial link cannot carry a broadcast stream | poll (already the behaviour); revisit only if the link becomes packet-based |
| Cloud shelf is a single free-tier environment | fine for a pilot, not a contract | paid limits, backup policy, an export path for the institution |
| Legacy views still in the tree | `views/student.js`, `views/lecturer.js` are no longer mounted; a reader may mistake them for the product | delete in the first cleanup commit |
| Debug-signed APKs | Android warns on install; no store distribution | keystore + release signing before a pilot |
| No CI | a broken build is found by hand | a GitHub Action running `:app:testDebugUnitTest` on push |

---

## 4. How to reproduce the verification

```bash
# rules + transport suites (no device needed)
cd native/lecturer/android && ./gradlew :app:testDebugUnitTest --no-daemon
cat app/build/test-results/testDebugUnitTest/TEST-*.xml | grep -o 'tests="[0-9]*" .*errors="[0-9]*"'

# the change is inside the artefact, not just the source
unzip -p dist/AttendSmart-Student-debug.apk assets/public/assets/js/app.js | grep "finds the register on the same phone"
unzip -l dist/AttendSmart-Student-debug.apk | grep -o "classes[0-9]*\.dex"

# the cloud still answers, and refuses the wrong key
curl -s https://site-0e3e6d5545fc40a7ae3aadc8cf8cb062.freebuff.page/api/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://site-0e3e6d5545fc40a7ae3aadc8cf8cb062.freebuff.page/api/v1/classes/DBM411/reports \
  -H 'content-type: application/json' -d '{"key":"wrong","sessions":[]}'      # expect 403

# whole-class concurrency, laptop edition, scratch database
ATTENDEASE_DB="$PWD/data/loadtest.db" PORT=4199 node server.js &
node tools/loadtest.cjs
```

---

## 5. What this log is for

A hackathon project is usually judged on the demo and the story. This log exists because the
interesting engineering here is not the screens — it is the two transports, the one writer, and the
refusals. Being able to say *"that bug is #17, here is what it did to us and what we changed"* is worth
more than a feature list, and it is the only honest way to present a build that has not yet been in a
real classroom.
