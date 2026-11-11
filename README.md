# AttendEase

**Location-verified attendance for Baraton University (UEAB).**
Two installable Android apps and one shared server: a lecturer opens a class window, students post
from inside the room, and the register compiles itself.

`AttendEase v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE`

---

## What it does

A student can only post attendance when **all four** gates agree:

| Gate | Rule |
|---|---|
| 1. Open window | the lecturer pressed **START** and the 5–60 minute window is still open |
| 2. Correct code | the four digits on the projector, issued by the server for that session |
| 3. On the final register | the semester register was posted by the lecturer; nobody can add themselves |
| 4. Inside the fence | the phone's GPS (or the BT-821C receiver) is within the hall radius, default 30 m |

A posted record is final: it cannot be edited, moved to another student, or posted twice — not even
in a fresh window on the same day. Device identity is locked to one student, so passing a phone
around does not work either.

The lecturer watches a live **Posted this session** list fill up with names, times and NEW badges,
then downloads the register as Excel/CSV.

---

## Quick start

Requires **Node 18+**. No npm install, no build step, no framework.

```bash
node server.js
# Local   : http://localhost:4173
# Network : http://<laptop-lan-ip>:4173   ← type this into the phones
```

The server prints the LAN address on start-up. Phones on the same Wi-Fi open that address, or use
the APKs in `dist/` and enter it once on the setup screen.

| Account | Sign in as | What it shows |
|---|---|---|
| `s1` | John Kimutai · BAR/2023/101 | student portal, DBM411 at 83.5% |
| `l1` | Dr. Peter Mwangi | lecturer portal, 3 units (DBM411, BBIT500, BBIT312) |
| `a1` | Administrator | admin console, demo reset |

No passwords — the seeded accounts exist so a demo can switch roles in two taps.

---

## The two apps

| App | Source shell | Android project | APK |
|---|---|---|---|
| Student | `student.html` | `native/student` | `dist/AttendSmart-Student-debug.apk` |
| Lecturer | `lecturer.html` | `native/lecturer` | `dist/AttendSmart-Lecturer-debug.apk` |

Both are the same government-portal interface (green header, beige page, boxy tables, flat grey
buttons) and both are real Capacitor builds with location and Bluetooth permissions declared.

The **lecturer APK hosts the register itself** on port 4173 and advertises it (NSD `_attendease._tcp.`
plus a UDP beacon on 4174); the student APK finds it over the campus Wi-Fi, over Bluetooth RFCOMM when
the network isolates clients, or on loopback when both apps are on one handset. The laptop server in
`server.js` remains for a desktop demo and is not needed to run a class.

```bash
npm run mobile:stage        # stage the web shell into native/*/www
cd native/student  && npx cap sync android && cd android && ./gradlew assembleDebug
cd native/lecturer && npx cap sync android && cd android && ./gradlew assembleDebug
```

The full toolchain steps (JDK, Android SDK, signing) are in
[docs/GUIDE.md](docs/GUIDE.md#building-the-apks).

---

## Documentation

| Document | Read it for |
|---|---|
| [docs/GUIDE.md](docs/GUIDE.md) | install, run, connect phones, beacon setup, classroom walkthrough, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | stack, data model, request flows, concurrency, security rules |
| [docs/BUSINESS-MODEL.md](docs/BUSINESS-MODEL.md) | problem, market, pricing, unit economics, go-to-market, risks |
| [docs/PRESENTATION.md](docs/PRESENTATION.md) | slide outline, 3-minute demo script, judge Q&A |
| [docs/ISSUES-SOLVED.md](docs/ISSUES-SOLVED.md) | the engineering log: every bug found and how it was fixed and verified |
| [dist/](dist/) | the pitch pack: business model, five-minute script, code tour, build/API/Q&A — written against the phone-hosted build |

---

## How it is built

```
student.html / lecturer.html     installable shells (portal UI)
index.html                       role picker
server.js                        static server + JSON API + SSE live feed
server/db.cjs                    node:sqlite store, WAL, migrations, seed reset
server/domain.cjs                the four gates, sessions, roster, venue rules
server/seed.cjs                  8 units, 340 students, a semester of history
assets/css/portal.css            the government-portal skin
assets/js/app.js                 router, portal shell, live refresh
assets/js/data.js                API client + selectors
assets/js/location.js            GPS with distinct insecure / denied / indoor failures
assets/js/ble.js                 BLE scanning: native plugin in the APK, Web Bluetooth in Chrome
assets/js/gps.js                 BT-821C bridge client
assets/js/views/                 portal-student, portal-lecturer, login, admin
tools/build-mobile.js            stage the shell into the native projects
tools/loadtest.cjs               whole-class check-in load test
tools/bt821c-bridge.js           NMEA → JSON bridge for the receiver
```

**No runtime dependencies.** `node:sqlite` is built into Node; the only third-party code that ships
is `@capacitor-community/bluetooth-le` inside the two Android wrappers.

---

## Measured behaviour

| Check | Result |
|---|---|
| 85 students posting at once (same class, same second) | 85 recorded, 0 failures, **252 ms** wall time, p95 **224 ms**, ~**337 posts/s** |
| Duplicate post attempt | refused at the server, `step: duplicate`, one record kept |
| Second window for the same unit on the same day | refused — a class is recorded once |
| Live feed after a post | lecturer card shows `Posted this session 1 of 85` with a NEW badge, no refresh |
| GPS with location permission denied | explained as a permission problem, not "no fix" |

Reproduce with `node tools/loadtest.cjs` (start it against a scratch database, see the guide).

---

## Status and honest limitations

- **Bluetooth is a scan, not a transmission.** Both apps listen for the session beacon
  (`DBM411_MONDAY_CLASS`). Something must put it on air — a beacon, a phone running a beacon app,
  or the BT-821C. The lecturer phone cannot advertise yet.
- **The APKs have not been run on physical hardware in this workspace.** They build, package the
  permissions and plugin, and pass static checks; a real device walk-through is still owed.
- **Identity is bound to an app-installed device id**, not to hardware attestation. Strong for
  classroom use, not proof against a rooted phone.
- **GPS can be spoofed** by a determined student; the fence stops casual proxy attendance, not
  developer-options mock locations.
- SQLite is a single-writer store. It is comfortable at department scale; a multi-campus rollout
  would move to Postgres and keep the same domain rules.

---

## Demo data

`data/attendsmart.db` is generated from `server/seed.cjs` on first run. **Admin → University →
Reset demo data** (or `POST /api/admin/reset` with `{"actorId":"a1"}`) rebuilds it: 8 units,
340 students, a full semester of attendance history, and John Kimutai deliberately near 50% in
DBM411 so the eligibility warnings have real signal.

---

Built for the Baraton University / UEAB hackathon, 2026.
