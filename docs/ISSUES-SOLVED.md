# CLASSPREF3CT — Engineering Log: Issues Found and Solved

Every entry is a problem that actually appeared while building this, what caused it, what changed,
and how the fix was checked. Dates are the working sessions; the whole build sits on top of one
baseline commit (`Baseline before shared-backend rework`).

---

## 1. Attendance rules lived in the browser

**Symptom.** Two tabs could disagree: one showed a student as present, the other as absent. Clearing
browser storage wiped the university.

**Cause.** The prototype validated check-ins in `assets/js/data.js`, per tab, with state in
`localStorage`.

**Fix.** Moved the whole domain into `server/domain.cjs` and `server/db.cjs` on `node:sqlite`. The
client now only renders what the server returns.

**Verified.** Two browsers, two roles, one database: a post in tab A appears in tab B without a
refresh; resetting storage changes nothing.

---

## 2. The whole page hung on a geolocation promise

**Symptom.** Press POST, the button stuck on "POSTING…" forever, and only a reload recovered it.

**Cause.** Chromium can leave `getCurrentPosition` pending indefinitely while the permission dialog
is unanswered. The code awaited it directly.

**Fix.** A watchdog around every attempt (`assets/js/location.js`), plus a second, cheaper attempt
with network location before reporting failure.

**Verified.** With permission blocked, the button returns within the timeout with
*"Location permission is off for CLASSPREF3CT…"*.

---

## 3. "No GPS fix yet" blamed the weather for three different problems

**Symptom.** Students were told to walk to a window when the real problem was a blocked permission
or an insecure `http://` address.

**Cause.** Every failure path collapsed into one message.

**Fix.** `assets/js/location.js` distinguishes insecure origin, permission denied, timeout and
"indoors with no satellites", each with its own instruction, and retries with network location
because lectures happen indoors.

**Verified.** Forced each branch in the browser and read the four messages back.

---

## 4. The APK could never get a location at all

**Symptom.** Inside the installed app, location failed instantly, every time.

**Cause.** The Android manifests declared only `INTERNET`. A Capacitor WebView cannot even prompt for
location without `ACCESS_FINE_LOCATION`.

**Fix.** Added `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` to both manifests.

**Verified.** `aapt dump badging` on the built APKs lists both permissions.

---

## 5. The student scan could freeze on Step 1

**Symptom.** The radar stuck at "Scanning..." at ~56%. Reproduced after a live event re-rendered the
page mid-scan.

**Cause.** The completion timer lived in the DOM node that was replaced, so the new mount never
finished the scan.

**Fix.** Deadline + single timer: `scanDeadline` records when the scan must end, and exactly one
`scanTimer` is kept across re-renders.

**Verified.** Triggered a live refresh during the scan; it still lands on Step 2.

---

## 6. A posted student could post again in a new window

**Symptom.** Lecturer ends the window, presses START again, and the same student posts a second
time for the same class.

**Cause.** Duplicate protection was per session (`UNIQUE (session_id, student_id)`), and a new window
is a new session.

**Fix.** `checkIn` also refuses a record for the same unit on the same calendar day, inside the same
transaction, with the original time in the message.

**Verified.** Window A posts; window B refuses with
*"You already posted attendance for DBM411 today at 09:37 AM. A class is recorded once…"*; the same
window refuses too; exactly one record exists.

---

## 7. The student screen then let them try anyway

**Symptom.** Even after the server started refusing, the student still saw a code box and a POST
button for a class they had posted.

**Cause.** The view only checked the in-memory receipt, not the register.

**Fix.** `postedToday()` looks at the snapshot for that unit today and renders the found box with the
original time, no input and no button.

**Verified.** Live page returned `hasCodeInput: false, hasPostButton: false` and
*"Attendance for this class was already posted today at 09:37."*

---

## 8. A class posting together would have queued behind itself

**Symptom (predicted, then measured).** Each check-in returned the entire database snapshot, and
each check-in broadcast an SSE frame to every phone — 85 posts meant 85 snapshots and 85 pulls per
client.

**Cause.** Snapshot in the write reply; uncoalesced broadcast.

**Fix.**
- Check-in replies with its own record and the new revision only.
- Broadcasts coalesced over 150 ms (one frame per burst).
- Clients debounce to one snapshot pull per burst.
- SQLite in WAL with `synchronous = NORMAL`; keep-alive 65 s, 512 connection ceiling.

**Verified.** `node tools/loadtest.cjs`: 85 students, **85 posted, 0 failed, 252 ms wall, p95 224 ms,
~337 posts/s**, 85 records in the database.

---

## 9. Bluetooth was announced but never actually used

**Symptom.** "Bluetooth: ON" was a label, not a measurement; the student's scan button did not even
appear inside the APK.

**Cause.** The WebView has no Web Bluetooth, and nothing packaged a native scanner. The lecturer's
label was inferred from an open window.

**Fix.**
- `@capacitor-community/bluetooth-le` added to both Android projects; `BLUETOOTH_SCAN` and
  `BLUETOOTH_CONNECT` declared.
- `assets/js/ble.js` scans natively in the APK and via Web Bluetooth in Chrome, always resolving with
  a reason.
- Student matches the session beacon name (`DBM411_MONDAY_CLASS`) and posts `method: "ble"`.
- Lecturer's card is labelled from its own scan: `beacon <NAME>` / `beacon not seen` / `BT-821C`.

**Verified.** Plugin present in `capacitor.plugins.json` and in the APK's dex; permissions listed by
`aapt`; lecturer card flipped to `Bluetooth: ON — beacon not seen` when a window was open with
nothing on air. A real beacon match is still owed — no BLE hardware was available here.

---

## 10. The lecturer could not tell who had just posted

**Symptom.** "Present Today: 1" with no name.

**Cause.** The count was there; the records were not surfaced.

**Fix.** A **Posted this session** panel per live unit: newest first, `NEW` badge for two minutes,
matching rows highlighted, updated from the live stream.

**Verified.** After a real post: `Posted this session 1 of 85`,
`John Kimutai BAR/2023/101 09:20 · NEW`, row highlighted, count 1.

---

## 11. Header, footer and sign-in were still the modern dashboard

**Symptom.** Portal screens looked like a government portal; the sign-in and the first-run server
setup did not.

**Fix.** `assets/js/views/login.js` rewritten with portal markup (green header, boxed account list,
flat buttons); the setup screen skinned by `assets/css/portal.css`; footer everywhere is
`CLASSPREF3CT v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE`.

**Verified.** Live DOM: `isPortalLogin: true`, header colour `rgb(11, 93, 46)`, `oldAuth: false`; the
same strings confirmed inside both APKs.

---

## 12. No way to rescan when the scan found the wrong class

**Symptom.** The scan landed on a unit the student was not sitting in, and there was no way back.

**Fix.** **SCAN AGAIN** on the found box as well as the not-found and posted states; it clears the
code, the error and the receipt, then re-runs the scan.

**Verified.** Found box rendered `rescanButtons: ["SCAN AGAIN"]` next to POST ATTENDANCE.

---

## 13. The lecturer had two units, not four

**Symptom.** Dr. Mwangi taught one unit in the demo; a hackathon demo needs a full timetable.

**Fix.** Added BBIT500 (Web Development, Room C3) and BBIT312 (Computer Networking, Room B2) to
`server/seed.cjs` with 44 students each and generated history, then regenerated the demo database.

**Verified.** Dashboard shows three cards with correct room, time and student counts.

---

## 14. The Android build was impossible on this machine

**Symptom.** No JDK, no SDK, and Capacitor 8 needs Android SDK 36.

**Fix.** A project-local toolchain in `.toolchain/` (JDK 21 + SDK 36, git-ignored), `local.properties`
per project, and a documented build sequence. APKs are produced at `dist/` with a `BUILD SUCCESSFUL`
log.

**Verified.** Both packages rebuild reproducibly (~2 min first time, ~30 s after) and the packaged JS
matches the source (grep inside the APK).

---

## 15. The README described a different product

**Symptom.** Documentation claimed "no accounts, localStorage, simulated Bluetooth, client-side
verification, loopback-only server" — all false after the rework.

**Fix.** README rewritten, plus `docs/GUIDE.md`, `ARCHITECTURE.md`, `BUSINESS-MODEL.md`,
`PRESENTATION.md` and this log.

**Verified.** Every claim in the docs was checked against the running system; limitations that
remain (no hardware test, no lecturer advertising, single-file database) are stated, not hidden.

---

## 16. Every native call silently did nothing inside the APK

**Symptom.** The installed apps could not start a host or find one; nothing threw, the plugin
lookups simply produced `undefined`.

**Cause.** The code assumed `Capacitor.registerPlugin()` existed. The injected Android bridge ships
`Capacitor.isNativePlatform()` and a `Capacitor.Plugins` map, but not `registerPlugin` — that lives in
`@capacitor/core`'s JS bundle, which this app deliberately does not ship.

**Fix.** `nativePlugin()` in `assets/js/host.js` (and the same lookup in `bt.js` and
`ClassFinderPlugin`'s callers) reads `Capacitor.Plugins[name]` first and only falls back to
`registerPlugin`. Failures now name the plugins the bridge actually exposed.

**Verified.** Error text changed from a bare failure to `bridge plugins: ClassHost, ClassFinder, …`,
and the host started on device-less inspection of the packaged bundle.

---

## 17. Discovery found the lecturer phone and the socket to it still never opened

**Symptom.** The student app reported `http://192.168.1.8:4173` as found, then every request failed.

**Cause.** The campus access point isolates clients: two phones on the same SSID cannot talk to each
other even though mDNS and the UDP beacon get through.

**Fix.** A second transport with no middlebox to configure. `BtServer` (lecturer) listens on RFCOMM
with a fixed service UUID; `BtClient` (student) remembers the phone, falls back to bonded devices,
then scans, bonds and dials. `assets/js/bt.js` exposes it as `btFind`/`btCall`, and `data.js` retries
a failed fetch exactly once on that lane.

**Verified.** The JVM transport tests exercise the same handler the Bluetooth socket calls. Not
verified on two physical handsets — stated as such in `README.md`.

---

## 18. Bluetooth could carry a request but not the register's live feed

**Symptom (by design, once found).** The same routes had to exist on both transports, but a
subscribe-forever SSE stream over a serial socket would stall every other student.

**Fix.** `ClassServer.serveOne(InputStream, OutputStream, boolean allowEvents)` is called by the TCP
socket with events allowed and by the Bluetooth socket with them refused — `/api/events` answers
`404 Live updates are not available over Bluetooth.` The student UI polls instead, and the JS never
mistakes that refusal for a failed request.

**Verified.** `TransportTest`: health, full state, uncompressed body, events-refused, several
requests on one stream, closed stream → `false`. 6 tests, 0 failures.

---

## 19. Demonstrating on a single handset: the student app could not see the register beside it

**Symptom.** With both APKs installed on one phone, the student app searched the Wi-Fi and Bluetooth
and found nothing, even though the lecturer app was hosting on the same device.

**Cause.** Discovery assumed two devices. Loopback was never tried.

**Fix.** `ClassFinderPlugin.find()` now probes `http://127.0.0.1:4173/api/health` first and, if a
register answers, returns it as `via: "loopback"` with no discovery at all. Nothing changes when the
register is on another phone.

**Verified.** Both APKs rebuilt (`BUILD SUCCESSFUL`, tests 8/8 and 6/6), the probe is present in
`classes8.dex` and the new copy is inside the packaged `app.js`. The single-handset flow itself still
needs a device to be walked through.

---

## 20. The documentation described a different product from the code

**Symptom.** `README.md` and `docs/` described a laptop server per campus; the code had moved the
register onto the lecturer's phone, added a Bluetooth transport and a cloud shelf. A judge reading
the README would have asked about a server that no longer matters.

**Fix.** `dist/` now holds a pitch pack written against the code as it is: business model, a
timed five-minute script, a file-by-file code tour, and the build/API/Q&A document, including the
three surfaces and what is honestly not verified.

**Verified.** Every file path, endpoint, port and test count in the pack was read from the source or
from a build, not from the older docs.

---

## What is not solved yet (and is written down as such)

| Gap | Why it matters | Plan |
|---|---|---|
| No physical-device walkthrough | APKs are built and statically verified, not used by a real student | install on two phones, run one session |
| Lecturer phone cannot advertise | a beacon must come from another device | native advertising plugin |
| GPS/BLE spoofable | determined proxy with a rooted phone | beacon requirement + anomaly reporting |
| No authentication | demo accounts only | institutional SSO |
| SQLite single writer | fine at department scale | Postgres + same domain rules |
