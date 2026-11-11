# AttendEase — Code Tour

Where every file is, what it does, and how one check-in travels from a student's thumb to the
lecturer's screen. Written so that "show me where that lives" has an answer in one line.

`AttendEase v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE`

---

## 1. The mental model (read this first)

There are **three surfaces** and only one of them is authoritative during a class.

| Surface | Where it runs | Authority |
|---|---|---|
| **Phone register** | the lecturer APK: `native/lecturer/.../host/` | **the only writer for its class** |
| **Student app** | the student APK: the same web assets, plus `ClassFinder` | none — it asks and displays |
| **Cloud shelf** | `cloud/worker.js` on Cloudflare Workers + D1 | none — roster and finished reports only |

Plus a fourth, older surface kept working for desktop demos: `server.js` + `server/` (a Node
server with SQLite) exposing the same `/api/*` contract. It is not needed for a class.

The web code is shared by both apps: `tools/build-mobile.js` copies `assets/`, `sw.js` and the
manifests into `native/student/www` and `native/lecturer/www`, and copies `student.html` or
`lecturer.html` in as `index.html`. Same screens, two installs.

---

## 2. The whole repository, folder by folder

```
index.html              role chooser (browser only)
student.html            the student shell: <body data-app="student">, portal styles, app.js
lecturer.html           the lecturer shell: <body data-app="lecturer">
sw.js                   service worker: offline shell for the browser build
server.js               optional laptop server: static files + JSON API + SSE (:4173)
server/db.cjs           node:sqlite store, WAL, migrations, demo reset
server/domain.cjs       the same five gates, server edition
server/seed.cjs         8 units, 340 students, a semester of history

assets/css/portal.css   the entire government-portal skin (green #0B5D2E, beige, boxed tables)

assets/js/app.js        router + shell + boot: decides which view renders, wires live refresh
assets/js/data.js       API client and selectors: request(), serverBase(), BLUETOOTH_BASE
assets/js/host.js       "where is the server?" in the installed apps (ClassHost / ClassFinder)
assets/js/bt.js         the student's Bluetooth lane (btAvailable / btFind / btCall)
assets/js/cloud.js      the shelf client: publishCourse, pushCourseReports, pullStudentClasses
assets/js/location.js   one GPS fix with three distinct failures
assets/js/gps.js        BT-821C receiver bridge client (optional hardware)
assets/js/ble.js        BLE beacon scan: native plugin in the APK, Web Bluetooth in Chrome
assets/js/roster.js     register import/paste parsing
assets/js/analytics.js  attendance percentages, eligibility flags, per-unit trends
assets/js/ui.js         icon(), avatar(), esc(), toast()

assets/js/views/login.js           portal sign-in
assets/js/views/portal-student.js  the three student tabs
assets/js/views/portal-lecturer.js the unit dashboard, live panel, Excel export
assets/js/views/admin.js           admin console (reset, KPIs)
assets/js/views/student.js         earlier dashboard-era screen, no longer mounted by app.js
assets/js/views/lecturer.js        earlier dashboard-era screen, no longer mounted by app.js

tools/build-mobile.js   stage assets into native/*/www
tools/loadtest.cjs      whole-class load test against the laptop server
tools/bt821c-bridge.js  NMEA -> JSON bridge for the GPS receiver
tools/make-icons.js     icon generation

native/lecturer/        Capacitor 8 project, appId com.baraton.attendsmart.lecturer
native/student/         Capacitor 8 project, appId com.baraton.attendsmart.student
native/*/capacitor.config.json   webDir "www", androidScheme https, cleartext, mixed content
native/*/android/       Gradle project, manifests, MainActivity, (lecturer) host/ package
dist/                   the two APKs, the source zip, and this pack
docs/                   the long-form engineering docs (architecture, guide, issues, slides)
```

### The native side, file by file

| File | Role |
|---|---|
| `native/lecturer/.../MainActivity.java` | registers `ClassHost` with the bridge before the WebView loads |
| `.../host/ClassHostPlugin.java` | the JS-facing plugin: `start`, `stop`, `status`, `enableBluetooth`, `discoverable`; owns `ClassServer`, `BtServer`, `Register` |
| `.../host/ClassServer.java` | a tiny HTTP/1.1 server on **:4173**. One method, `serveOne(in, out, allowEvents)`, is shared by the Wi-Fi socket and the Bluetooth socket |
| `.../host/Register.java` | the register document: load/save `class-register.json`, revision counter, dirty flag, listeners for live events |
| `.../host/Rules.java` | **every rule**. Sessions, codes, the fence, duplicates, device binding, late marking |
| `.../host/Discovery.java` | advertises the register: NSD `_attendease._tcp.` and a UDP beacon on **:4174** |
| `.../host/BtServer.java` | RFCOMM listener on UUID `8f1c9d42-…-3b6c88`, service name `AttendEase`; one socket per student, served in a loop |
| `.../host/RulesTest.java` | 8 JVM tests over the gates |
| `.../host/TransportTest.java` | 6 JVM tests over the HTTP/1.1 transport |
| `native/student/.../host/ClassFinderPlugin.java` | `find()` (loopback, then NSD/beacon, then Bluetooth) and `call({method,path,body})` |
| `native/student/.../host/BtClient.java` | dials the lecturer: remembered device → bonded devices → scan + bond + dial; speaks HTTP/1.1 over the socket |
| `native/student/.../host/Discovery.java` | the client half of NSD + the UDP beacon |

---

## 3. How a check-in actually travels

### Step 0 — the lecturer opens the class

`portal-lecturer.js` → `data.js request('POST','/api/sessions/start', …)` → `ClassServer` →
`Rules.startSession`. The phone clamps the window to 5–60 minutes, allocates a four-digit code that
no other live session is using, stamps `bleName` (e.g. `DBM411_MONDAY_CLASS`), stores the lecturer's
own GPS fix as the fence, and bumps the revision. `Register.bump()` writes
`class-register.json` in the app's private files directory and wakes any live readers.

### Step 1 — the student's phone finds the register (`host.js ensureHost`)

```
student app boots
  └─ isNativeApp()? ──no──► web mode, use the address in the URL bar
        │yes
        ├─ student typed an address earlier?  → use it, don't second-guess them
        └─ otherwise ask ClassFinder.find(timeoutMs)
               ├─ 1. 127.0.0.1:4173 answering /api/health?  → same handset demo, use loopback
               ├─ 2. NSD _attendease._tcp. + UDP beacon :4174 → http://<lecturer-ip>:4173
               └─ 3. Bluetooth: remembered/bonded device, else scan + pair → via:"bluetooth"
```

On the lecturer app the same function does the opposite: it starts `ClassHost` (HTTP + discovery +
`BtServer`), asks for the Bluetooth permission once, and points its own pages at
`http://127.0.0.1:4173`.

### Step 2 — every request goes through one function (`data.js request`)

```
request(method, path, body)
  ├─ if the base is "bluetooth.local"  → btCall(method, path, body) and return
  ├─ otherwise fetch(base + path)
  │     └─ throws? tag err.network ──► if Blues available, retry ONCE over Bluetooth
  └─ a refusal from the register (err.register) is never retried on the other lane
```

That single rule is what makes two transports safe: a POST is retried on the other lane **only**
when the first lane never reached the register. If the register answered — `ok:false` with a reason
— the answer is the answer, and a duplicate check-in is impossible by accident.

### Step 3 — the register decides (`Rules.checkIn`)

```
1  code is four digits                                    else "Enter the four-digit code…"
2  a live session uses that code                          else "That code is not open right now."
3  course + student exist, venue has a real fix           else "Invalid course, student or location."
4  student is on the final register                       else REFUSE + log security_event
5  no record for this session                             else "already posted at 09:37"
6  no record for this unit on the same calendar day       else "A class is recorded once…"
7  phone not permanently bound to someone else            else REFUSE + log security_event
8  coordinates are real (not 0,0 / NaN)                   else "Enable location…"
9  haversine(student, venue) <= radius (10–200 m)         else "You are N m from the class."
10 INSERT the record, lock the device, bump the revision
```

Late is not a refusal: a post more than five minutes after START is stored `status:"late"`.
A refusal never writes attendance; only security events are logged.

### Step 4 — the lecturer's screen updates without a refresh

`GET /api/events` is a Server-Sent Events stream that carries the **revision number only**. `app.js`
debounces a frame and pulls `GET /api/state` once, so eighty-five posts produce one snapshot pull
per phone rather than eighty-five. Over Bluetooth the stream is refused on purpose
(*"Live updates are not available over Bluetooth."*) and the screen falls back to polling — a
serial link should not pretend to be a broadcast bus.

### Step 5 — the class ends, and the record travels

STOP closes the session. `cloud.js syncLecturer` then, when a network happens to exist:

- `publishCourse` → `POST /api/v1/classes` with the unit and its enrolled students;
- `pushCourseReports` → `POST /api/v1/classes/<code>/reports` with every **ended** session and its
  records, each carrying its own id so a retry cannot duplicate anything.

Both are fire-and-forget: no screen waits for the cloud, and a failure is retried on the next sync.

---

## 4. The register document (what "the database" is)

One JSON document in the lecturer phone's private storage (`class-register.json`), seeded on first
launch from the `host-seed.json` asset shipped inside the APK:

| Key | Holds |
|---|---|
| `students` | id, regNo, name |
| `lecturers` | id, name |
| `courses` | id, code, name, lecturerId, hallId, day, start, end, windowMinutes, studentIds[] |
| `halls` | id, name, building, lat, lng, radius |
| `sessions` | id, courseId, code, token, bleName, startedAt, endsAt, lat, lng, radius, status |
| `attendance` | id, sessionId, courseId, studentId, checkedInAt, method, distanceM, status, deviceId |
| `identityLocks` | deviceId → studentId, permanent |
| `securityEvents` | unregistered and identity-misuse attempts, shown to the lecturer |
| `revision` | integer bumped on every write; drives live refresh and the snapshot cache |

There is one writer, so no locking is needed beyond `Register`'s own synchronisation. That is the
whole reason the rules can be this strict.

---

## 5. The cloud shelf (`cloud/worker.js`)

A Cloudflare Worker with a D1 database. Three tables: `classes` (payload + key hash + revision),
`sessions`, `records`. Everything is keyed by the **class code** the lecturer chooses.

- Writes need the **class key**: the phone derives it deterministically from the unit id
  (`classKeyFor` in `cloud.js`), so the same unit always maps to the same row, and the Worker stores
  only its SHA-256. Wrong key → 403, missing key → 401.
- Reads of one class by code are public, because a join code is not a secret and the payload holds
  no credentials.
- If the chosen code already belongs to a different phone's key, the phone re-publishes under
  `<CODE>-<last4>` instead of failing forever.
- `INSERT OR IGNORE` everywhere: sync is idempotent by construction.

Endpoints, schema and the exact request bodies are in
[AttendEase-Build-API-QA.md](AttendEase-Build-API-QA.md#3-the-api-three-surfaces).

---

## 6. Change this → edit that

| You want to change… | Edit |
|---|---|
| the four-digit code length, window limits, fence limits, late grace | `Rules.java` (`cleanCode`, `clamp`, `LATE_GRACE_MIN`) |
| what counts as a duplicate | `Rules.checkIn`, the same-day block |
| a refusal message a student reads | `Rules.checkIn` / `Rules.lookupSession` (`failure(...)`) |
| the lecturer's live panel, START/STOP, Excel columns | `assets/js/views/portal-lecturer.js` |
| the student's three tabs | `assets/js/views/portal-student.js` |
| the portal colours and footer | `assets/css/portal.css`; footer string sits in the views |
| how students find the phone | `host.js` + `Discovery.java` (NSD type, beacon port) |
| the Bluetooth lane | `bt.js`, `BtClient.java`, `BtServer.java`, `SERVICE_UUID` in `BtServer` |
| what syncs to the cloud | `cloud.js` (`publishCourse`, `pushCourseReports`) and `cloud/worker.js` |
| the demo semester (units, students, history) | `server/seed.cjs` for the laptop; `host-seed.json` asset for the phone |
| the API | `ClassServer.java` (phone), `server/domain.cjs` (laptop), `cloud/worker.js` (shelf) |

---

## 7. Tests, and what they cover

| Suite | Count | Covers |
|---|---|---|
| `RulesTest` | 8 | code/register/fence/dedup/device-lock behaviour, late marking |
| `TransportTest` | 6 | hand-rolled HTTP/1.1: health, full state, uncompressed bodies, `/api/events` refused over Bluetooth, several requests on one stream, a closed stream returning false |
| `ExampleUnitTest` | 1 | Capacitor scaffold sanity |

```bash
cd native/lecturer/android && ./gradlew :app:testDebugUnitTest --no-daemon
# results: app/build/test-results/testDebugUnitTest/TEST-*.xml
```

There is no JavaScript test runner in this project; the browser views are verified by hand against a
running register, and the load test (`tools/loadtest.cjs`) covers concurrency on the laptop edition.

---

## 8. Where the seams are (the honest bit)

- The web assets are shared by both apps, so a change to a view ships to both — that is deliberate,
  and the only thing that keeps the two packages in step.
- `views/student.js` and `views/lecturer.js` are the previous dashboard-era screens. `app.js` now
  mounts `portal-*.js`; the old files remain for the browser dashboard route and are the first thing
  to delete in a cleanup.
- `server.js` and `server/*.cjs` are a second implementation of the same rules. They exist so the
  product can be demoed on a laptop with no phones, and they are the source of the 85-check-in load
  numbers. Two implementations of one contract is a real maintenance cost — worth saying before a
  judge finds it.
- The cloud is optional by design. If it is down, a class is unaffected; the only loss is that a
  student's phone cannot refresh its roster until the next sync.
