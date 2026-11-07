# AttendSmart AI

Location-aware smart attendance for universities (Baraton University demo).

Students can only register attendance when they are **actually in the room**:

1. the class's Bluetooth broadcast is heard on their device,
2. they are on the lecturer's **final register** for the semester,
3. their GPS fix (phone GNSS or a **GlobalSat BT-821C** receiver) is inside the hall's radius,

then they confirm and **post once**. The record is locked to that student and device — no
edits, no reassignment, no proxy check-ins — and the analytics engine turns it into
attendance percentages, risk flags, absentee rankings and trend lines.

No build step, no framework, no accounts: the app is plain ES modules served by a 60-line Node static server, with a seeded semester of data in `localStorage`.

---

## Run it

Requires Node 18+ (no npm install needed).

```bash
node server.js
# → http://localhost:4173
```

`npm start` does the same thing.

### Two installable apps

The student and lecturer shells are installable apps, not bookmarked pages.

- Each has its own manifest — `student.webmanifest` and `lecturer.webmanifest` — with its own
  start URL, standalone display, theme colour, home-screen shortcuts and icons.
- Icons live in `assets/icons/` and are generated with no dependencies:
  `node tools/make-icons.js` (green check for students, blue board for lecturers).
- **Android / Chrome:** open the app, tap **Install app** in the sidebar, or use the browser's
  "Add to Home screen". **iOS Safari:** Share → "Add to Home Screen".
- An installed app opens full screen with no browser chrome, keeps the remembered student
  sign-in, and works with no connection because `sw.js` caches the shell.
- A native `.apk` / `.ipa` needs a wrapper (Capacitor or Cordova) plus the Android SDK and a
  JDK. Neither is installed on this machine, so the deliverables here are installable PWAs.
- Installing on a real phone needs a secure origin: HTTPS, or `localhost` on the device itself.
  `server.js` binds `127.0.0.1:4173`, so a phone on the same Wi-Fi cannot reach it — host the
  folder behind HTTPS (or open it on the desktop) when you want to add it to a home screen.

### Building the Android APKs (Capacitor)

Each app has its own native Android project under `native/<app>/`, wrapping the same shell that
runs as a PWA. `tools/build-mobile.js` stages that shell into `native/<app>/www`
(`student.html` / `lecturer.html` becomes `index.html`, plus the shared assets), so the APK and
the web app cannot drift apart.

| App | Project | Application ID |
|---|---|---|
| Student | `native/student` | `com.baraton.attendsmart.student` |
| Lecturer | `native/lecturer` | `com.baraton.attendsmart.lecturer` |

**One-time toolchain.** Capacitor 8 targets Android SDK 36 and is not buildable with this repo's
Node-only setup; neither a JDK nor the Android SDK is installed on this machine yet.

| Tool | Version | Why |
|---|---|---|
| Android Studio | Otter (2025.2.1) or newer | bundles the SDK manager, emulator and a matching JDK |
| Android SDK Platform | API 36 (`minSdk 24`) | `compileSdk` / `targetSdk` 36 |
| JDK | 21 | `@capacitor/android` compiles with Java 21 |
| Node.js | 22+ | Capacitor 8 CLI requirement |
| Gradle / AGP | 8.14.3 / 8.13.0 | already pinned by each project's Gradle wrapper |

Install Android Studio, then in **SDK Manager** add *Android SDK Platform 36*, *Android SDK
Build-Tools*, *Android SDK Platform-Tools* and *Android SDK Command-line Tools*. Android Studio
ships its own JDK 21; point `JAVA_HOME` at it for command-line builds:

```bash
# Windows (Git Bash) — adjust the paths if you installed elsewhere
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
java -version   # must print 21.x
```

**Build an APK:**

```bash
npm install                # once — Capacitor CLI + Android platform
npm run mobile:student     # stage the shell, then npx cap sync android
npm run mobile:lecturer

cd native/student/android && ./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`npm run mobile:open:student` / `mobile:open:lecturer` open the project in Android Studio instead.
For a distributable build, create a keystore, configure it in `android/app/build.gradle` and run
`./gradlew assembleRelease`. Re-run `npm run mobile:student` (or `mobile:lecturer`) after every web
change so the bundled assets match.

The APKs need no connection at runtime: every asset is bundled, and the service worker is skipped
inside the native WebView (`window.Capacitor.isNativePlatform()`).

### Prebuilt APKs

Both debug APKs were built on this machine using a project-local toolchain in `.toolchain/`
(Temurin JDK 21 + Android SDK 36; git-ignored, ~1.5 GB). Install them with `adb`, or copy them to
the phone and open them:

| APK | Package | Install |
|---|---|---|
| `dist/AttendSmart-Student-debug.apk` | `com.baraton.attendsmart.student` | `adb install -r dist/AttendSmart-Student-debug.apk` |
| `dist/AttendSmart-Lecturer-debug.apk` | `com.baraton.attendsmart.lecturer` | `adb install -r dist/AttendSmart-Lecturer-debug.apk` |

Rebuild after any web change:

```bash
npm run mobile:student && npm run mobile:lecturer
cd native/student/android && ./gradlew assembleDebug   # repeat for native/lecturer
```

They are debug-signed (`CN=Android Debug`), so the phone asks to allow installs from unknown
sources and Play Store upload is not possible. A release build needs your own keystore
(`./gradlew assembleRelease`). On a machine without `.toolchain/`, install Android Studio and a
JDK 21 instead — the versions are in the section above.

### Connectivity model

- **Attendance is offline.** Check-in uses Bluetooth proximity and the browser's local
database; posting never calls a server, and the BT-821C bridge is loopback only.
- **Student sign-in happens once.** After the first sign-in, the student app remembers the
account on that device and later launches skip the login screen. Signing out forgets it.
- **Register updates are the sync step.** Importing or posting the final register is the only
flow that needs a connection.
- `sw.js` caches both app shells and every asset, so the apps open with no Wi-Fi after the
first visit (service workers need `localhost` or HTTPS).

### Two apps, one backend

| App | URL |
| --- | --- |
| Student app | <http://localhost:4173/student.html> |
| Lecturer app | <http://localhost:4173/lecturer.html> |
| Full demo (admin + both roles) | <http://localhost:4173/> |

`student.html` and `lecturer.html` are standalone shells that lock sign-in and navigation to
their own role — no role picker, no link into the other app. All three share the same
`localStorage` database, so attendance posted in the student app appears live in the lecturer
app (use two tabs). The root `index.html` keeps the role picker and the administrator console.

> Use `http://localhost:4173`, not `file://`. The Geolocation API and the BT-821C bridge
> need a secure context, and `localhost` counts as one.

---

## Demo walkthrough (60 seconds)

Open two browser tabs at <http://localhost:4173>.

**Tab 1 — lecturer, at the start of semester**

1. Sign in as **Dr. Peter Mwangi** → **Register course**.
2. Set the day, times and window length — every change saves automatically.
3. Add students by ticking names, or paste the whole class from Excel as two columns
   (**ID, name** — the ID is the primary key, so repeats never duplicate anyone).
4. Capture the room with **Use this phone** or **Scan BT-821C** (the bridge reads the
   receiver's NMEA fix), then **Post final register**.
5. The register, venue and schedule are now locked for the semester.

**Tab 1 — lecturer, when class starts**

1. Go to **Attendance → Take attendance**, choose 5–30 minutes, **Start attendance window**.
2. Leave the screen open: names appear on the live feed as students post.

**Tab 2 — student**

1. Sign in as **John Kimutai** → **Check in**. The app scans automatically.
2. Tap **DBM411 · Database Systems**, confirm the venue, window and identity.
3. Allow location access — student check-in uses this phone's GPS only — then **Confirm & post**.
4. Tab 1's live feed shows John immediately; his record is locked.

Things worth showing:

| Demo action | What it proves |
| --- | --- |
| Post from outside the fence (walk out of range) | GPS fence rejects it with the real distance |
| Sign in as **Mary Barasa** on the same browser and post | The device is permanently bound to John, so the identity lock blocks her and logs it |
| Sign in as a student not on the register and post | The attempt is rejected and kept for the session report |
| **Close window** on tab 1 | The register compiles: present, late, absent, and the filtered attempts |
| Try to edit the register after posting | Roster, venue and schedule are disabled for the semester |
| **Reset demo data** (Admin → University) | Seeded semester regenerates |

John Kimutai is deliberately seeded near 50% (7 of 14 sessions) in DBM411, so the red
eligibility alert, the advisor worklist and the absentee report all have real signal.

---

## Roles

**Student** — three-tap check-in (scan → class → confirm → post), attendance %, missed
classes, late arrivals, risk banners, notifications, history with CSV export. Nothing to
type, and nothing to edit after posting.

**Lecturer** — two sections only. **Attendance** lists the classes they teach as boxes, opens
a live window (names arrive as students post, compiled on close), and links to all-student
analytics (totals, average, risk, trend, top absentees, CSV). **Register course** holds the
semester setup with auto-save — venue, schedule, window, student names and IDs — and the
final register lock. Outside attempts never enter the attendance table.

**Administrator** — university KPIs, monthly trend, weekday/slot performance, course
performance, the cross-course risk worklist, session log, demo reset.

---

## Verification rules

All gates must pass, in order. The same function (`checkIn` in `assets/js/data.js`) is the
single source of truth:

1. **Session live** — exists, status `active`, not past `endsAt`.
2. **Bluetooth proximity** — the student's device heard that session's broadcast.
3. **Final register** — the student is on the register the lecturer posted at the start of
   semester. Anyone else is rejected and logged as an `unregistered_attempt`; they never
   enter the attendance table.
4. **GPS fence** — haversine distance to the hall ≤ the hall's radius (40–75 m here).
5. **No duplicate** — one record per student per session, forever.
6. **Identity lock** — the first device to post is permanently bound to that student in
   `db.identityLocks`. Any other student posting from it is blocked and logged as
   `identity_locked`.

Posting is **append-only**: records are never updated, moved or reassigned, and there is no
UI path to change one. Closing a window compiles the session report from the final register,
so the report and the attendance table always agree.

Late is derived from the session start: more than **5 minutes** after start is `late`.

Attendance % = sessions attended ÷ sessions held. Below **70%** is `at risk`,
70–79.9% is `watchlist`, 80%+ is `on track`.

---

## GlobalSat BT-821C integration

The BT-821C is a Bluetooth **Classic SPP** NMEA 0183 receiver (MTK chipset, GGA/GSA/GSV/RMC,
**38400 8N1**). Browsers cannot open SPP sockets — Web Bluetooth is BLE-only — so the app
uses a small local bridge instead of pretending it can talk to the receiver directly.

```
BT-821C ──Bluetooth SPP──▶ Windows COM port ──▶ tools/bt821c-bridge.js ──HTTP JSON──▶ web app
```

The fix from the receiver goes through exactly the same distance calculation as built-in
GPS, so a session can require the external receiver's precision without changing any rule.

### 1. Pair the receiver

1. Charge and power on the BT-821C (green LED blinks once it has a satellite fix).
2. Windows: **Settings → Bluetooth & devices → Add device → Bluetooth → `BT-821C`**.
   If asked for a PIN, `0000` is the usual default.
3. Give it a clear view of the sky; the first fix outdoors takes ~35 s cold.

### 2. Find the outgoing COM port

```bash
npm install serialport        # one-time, optional dependency for the bridge
node tools/bt821c-bridge.js --list
```

Pick the port created for the BT-821C (often `COM7` / `COM8` — the *outgoing* one).

### 3. Start the bridge

```bash
node tools/bt821c-bridge.js --port COM7 --baud 38400
# [bridge] serving fixes at http://127.0.0.1:4190/fix
# [bridge] COM7 open at 38400 baud — waiting for NMEA sentences
# [bridge] fix acquired: -0.157000, 35.269000 (±5 m, 9 sats)
```

Endpoints (loopback only):

| Endpoint | Purpose |
| --- | --- |
| `GET /fix` | current fix: `lat`, `lng`, `accuracy`, `sats`, `hdop`, `ageMs`, `status` |
| `GET /health` | port, baud, sentence count, rejected checksums, last sentence time |
| `GET /nmea` | last raw sentences, for debugging |

The bridge verifies NMEA checksums, converts `ddmm.mmmm` to decimal degrees, treats
`GGA` fix quality 0 / `GSA` fix type 1 as **no fix**, derives accuracy from HDOP and marks a
fix stale after 10 s so a frozen stream can never mark attendance.

### 4. Use the receiver in the app

Lecturer → **Register course → Classroom GPS → Scan BT-821C**. The app discovers the bridge,
reads the current fix and stores it as the class venue with the fix accuracy, or reports the
port while waiting for satellites. Student check-in intentionally uses the phone's own GPS only.

### Testing without the hardware

`tools/nmea-simulator.js` emits valid, checksummed GGA/RMC sentences so the whole
receiver path can be demoed with no device:

```bash
node tools/nmea-simulator.js --jitter 3 | node tools/bt821c-bridge.js --stdin --http 4190
# [simulator] -0.157, 35.269 · 9 sats · HDOP 0.9 · 1000 ms · jitter 3 m
# [bridge] serving fixes at http://127.0.0.1:4190/fix
curl http://127.0.0.1:4190/fix
# {"ok":true,"lat":-0.157,"lng":35.269,"accuracy":5,"sats":9,"hdop":0.9,...}
```

That pipeline is the exact end-to-end check used while building this: the app's
**BT-821C** source consumes `/fix` through the same distance rule as built-in GPS.

### Mobile app path

For the Flutter/Android build described in the proposal, read the SPP stream directly:

- UUID `00001101-0000-1000-8000-00805F9B34FB`
- `BluetoothAdapter.getRemoteDevice(mac).createRfcommSocketToServiceRecord(uuid)`
- read lines at 38400 baud, parse the same GGA/RMC fields, and feed them to the
  location provider.

On Android you can also pair the receiver with a mock-location app such as *Bluetooth GPS*:
the OS then reports the BT-821C position through the standard location provider, and the
web app's "Phone GPS" source automatically uses the external receiver.

---

## How the demo data works

`assets/js/data.js` seeds, on first load:

- 96 students, 4 lecturers, 1 registrar, 6 courses, 4 halls around the Baraton campus
  coordinates (`-0.157, 35.269`, 50 m radius by default)
- ~4 months of sessions on each course's weekday, with attendance derived from a
  per-student/per-course propensity so trends and risk bands are realistic
- John Kimutai pinned near 50% in DBM411 (7 of 14 sessions — the red-alert example from the brief)

Everything persists in `localStorage` (`attendsmart.state.v1`). **Admin → University →
Reset demo data** rebuilds it. The signed-in user is kept in `sessionStorage` so two tabs
can hold different roles while sharing attendance — that is what makes the cross-tab live
roster work.

---

## Project map

```
index.html                  shell
server.js                   zero-dependency static server (loopback)
assets/css/app.css          design system
assets/js/app.js            role router, shell, cross-tab sync
assets/js/data.js           seed data, persistence, register + check-in rules
assets/js/analytics.js      percentages, risk, trend, absentee + risk rows
assets/js/gps.js            device GNSS / BT-821C bridge / simulated sources
assets/js/ui.js             icons, SVG charts, toasts, modals, CSV
assets/js/views/            login, student, lecturer, admin
tools/bt821c-bridge.js      NMEA → JSON bridge for the external receiver
tools/nmea-simulator.js     checksummed NMEA feed for bridge tests and demos
```

### Third-party code

No third-party code ships with the app. `serialport` is optional and only needed by the
Bluetooth bridge.

---

## Known limitations

- **Bluetooth discovery is simulated.** A browser cannot advertise or scan BLE without a
  native companion, so the "scan" proves the flow, not the radio. On mobile, replace it with
  `flutter_blue_plus` / `BluetoothLeScanner` and require the discovered session id to post.
- **All verification runs client-side** in this prototype. Production would move `checkIn`,
  the final register and the device/identity binding into the API (the rules are already
  isolated in one function), with server-side locking and rate limiting.
- **The identity lock is per browser profile**, since a web prototype has no device
  attestation. A native build would bind to an OS-level device identifier instead.
- The analytics are computed from local records on each render (a few thousand rows), which
  is fine for a demo but would move to SQL aggregates at university scale.
