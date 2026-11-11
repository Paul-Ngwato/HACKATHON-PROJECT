# AttendEase — Build, API and Judge Q&A

How the APK came to exist, what is inside it, the complete API of all three surfaces, the process
that produced it, the evidence that it works, and twenty answers for the people asking hard
questions.

`AttendEase v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE`

---

## 1. How the APK came to exist

An APK is a zip of compiled code, assets and a manifest. Getting there from this repository takes
four transformations, and each one is a command you can run.

```
 student.html / lecturer.html ──┐
 assets/js, assets/css          │  ① tools/build-mobile.js
 sw.js, *.webmanifest ──────────┴─► native/<app>/www/   (index.html + shared files)
                                            │
                                            │  ② npx cap sync android
                                            ▼
                     native/<app>/android/app/src/main/assets/public/  (the same files, renamed)
                                            │
                                            │  ③ ./gradlew assembleDebug
                                            ▼
        Java/Kotlin ─► .class ─► classes.dex (and classes2…8) ─┐
        assets + manifest ────────────────────────────────────┴─► app-debug.apk
                                            │
                                            │  ④ copy
                                            ▼
                       dist/AttendSmart-Student-debug.apk, dist/AttendSmart-Lecturer-debug.apk
```

**① Stage.** `tools/build-mobile.js` deletes `native/*/www`, copies `assets/`, `sw.js` and both
web manifests in, and copies `student.html` or `lecturer.html` as `index.html`. Both APKs therefore
carry byte-identical JavaScript — the only difference at this stage is which shell is the entry
point (`<body data-app="student"|"lecturer">`).

**② Sync.** `npx cap sync android` copies `www/` into the Gradle project's assets, writes
`capacitor.plugins.json` from the installed Capacitor plugins, and updates the Android project.

**③ Compile.** Gradle compiles the Java sources (MainActivity, the `host/` package, and Capacitor
itself), merges the manifests and their permissions, and packages everything.

**④ Name and ship.** The build output is a single file:
`native/<app>/android/app/build/outputs/apk/debug/app-debug.apk`.

### The exact commands (Windows Git Bash, Linux or macOS)

```bash
export JAVA_HOME="$PWD/.toolchain/jdk"
export ANDROID_HOME="$PWD/.toolchain/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

node tools/build-mobile.js                      # ① stage both shells
(cd native/student && npx cap sync android)     # ② sync
(cd native/lecturer && npx cap sync android)
(cd native/student/android  && ./gradlew assembleDebug --no-daemon)   # ③ compile
(cd native/lecturer/android && ./gradlew assembleDebug --no-daemon)
cp native/student/android/app/build/outputs/apk/debug/app-debug.apk  dist/AttendSmart-Student-debug.apk
cp native/lecturer/android/app/build/outputs/apk/debug/app-debug.apk dist/AttendSmart-Lecturer-debug.apk
```

**Toolchain.** JDK 21 and Android SDK 36 live in `.toolchain/` — project-local and git-ignored, so
the build does not depend on what a machine happens to have installed. `local.properties` in each
`native/*/android` points Gradle at that SDK. First build ≈ 2 minutes (compiles Capacitor); later
builds ≈ 25–35 seconds.

**Tests run alongside the build:**

```bash
cd native/lecturer/android && ./gradlew :app:testDebugUnitTest --no-daemon
# TEST-…-RulesTest.xml      tests="8" failures="0" errors="0"
# TEST-…-TransportTest.xml  tests="6" failures="0" errors="0"
```

### What is inside the APK

| Part | Detail |
|---|---|
| `AndroidManifest.xml` | `INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `BLUETOOTH`/`BLUETOOTH_ADMIN` (≤ API 30), `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` |
| `assets/public/` | the entire web app: `index.html`, `assets/js/*`, `assets/css/portal.css` |
| `assets/public/host-seed.json` | the demo semester, copied into private storage on first launch (lecturer) |
| `classes.dex … classes8.dex` | Capacitor, Gson, the Bluetooth LE plugin and the app's own classes (multi-dex; the host package lands in `classes8.dex`) |
| `res/` | icons, splash, the `AttendEase` app name |
| signature | the **debug** keystore — installable from a file or a link, not publishable to Play |

**How to verify any claim in this pack without a phone:**

```bash
unzip -l dist/AttendSmart-Lecturer-debug.apk | head -20            # what shipped
unzip -p dist/AttendSmart-Student-debug.apk assets/public/assets/js/bt.js   # the Bluetooth lane
grep -E "uses-permission" native/lecturer/android/app/src/main/AndroidManifest.xml
```

### The two packages, and why they are two

| | appId | Hosts? | Finds? |
|---|---|---|---|
| Lecturer | `com.baraton.attendsmart.lecturer` | yes — `ClassHost`, `ClassServer`, `BtServer` | no |
| Student | `com.baraton.attendsmart.student` | no | yes — `ClassFinder`, `BtClient` |

Separate appIds mean both install side by side (on one handset too), and the capability is decided
by which native package is present, not by a flag on a shared build.

---

## 2. The process (how a change becomes a working APK)

1. **Change the shared web code** in `assets/` — one change serves both apps.
2. **Change a phone-side rule** in `native/lecturer/.../host/Rules.java` — and add a case to
   `RulesTest`, because that file is the contract.
3. **Stage, sync, build** with the four commands above.
4. **Run the JVM tests** (`:app:testDebugUnitTest`) — they need no device.
5. **Verify inside the artefact**, not in the source: unzip the APK and grep for the string or class
   you changed (this is how every claim below was checked).
6. **Copy to `dist/`** and commit both the source and the rebuilt APK, so the repository always
   contains the binary its sources produce.

Nothing in this chain requires Android Studio, a physical device, or an emulator.

---

## 3. The API (three surfaces)

### 3a. The phone register — authoritative during class

Base: `http://<lecturer-phone>:4173` (or `http://127.0.0.1:4173` on the lecturer's own phone), also
reachable over the Bluetooth RFCOMM link via `ClassFinder.call({method, path, body})`.

| Method | Path | Body / query | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | liveness + current revision |
| GET | `/api/state` | — | the whole register document the UI renders |
| GET | `/api/sessions/lookup` | `?code=&studentId=` | is this code open, for which unit, am I enrolled |
| GET | `/api/events` | — | SSE stream carrying only `{revision}` — **404 over Bluetooth** |
| POST | `/api/checkin` | `code, studentId, deviceId, lat, lng, accuracy, method` | post attendance through the five gates |
| POST | `/api/anchor` | fix payload | record the class anchor fix used by the fence |
| POST | `/api/sessions/start` | `courseId, actorId, durationMin, lat, lng, accuracy, radius` | open a window, issue a code |
| POST | `/api/sessions/end` | `sessionId, actorId` | close the window |
| POST | `/api/sessions/rotate` | `sessionId, actorId` | new code, same window |
| POST | `/api/courses/create` | `name, code, room, start, end, lecturerId` | new unit |
| POST | `/api/courses/setup` | unit setup payload | create/patch a unit in one call |
| POST | `/api/courses/roster` | `courseId, studentIds[]` | set the final register |
| POST | `/api/courses/import` | `courseId, entries[]` | paste a class list |
| POST | `/api/courses/finalize` | `courseId, actorId` | lock the register for the semester |
| POST | `/api/courses/venue` | `courseId, lat, lng, radius` | capture the room |
| POST | `/api/admin/reset` | `actorId: "a1"` | rebuild the demo seed |

**Refusals** from the register look like
`{ "ok": false, "step": "duplicate", "message": "You already posted attendance for DBM411 today at 09:37 AM. A class is recorded once, so this cannot be repeated." }`
with HTTP 200 for a *decision* (the HTTP call succeeded; the register said no) and 4xx for a bad
request. The `step` values (`code`, `session`, `enrolled`, `duplicate`, `fence`, `device`) are what
the UI uses to show the right instruction, and what `data.js` uses to decide whether to retry on the
other transport (it does not).

### 3b. The cloud shelf — optional, never authoritative

Base: `https://site-0e3e6d5545fc40a7ae3aadc8cf8cb062.freebuff.page` (Cloudflare Worker + D1).

| Method | Path | Body / query | Auth |
|---|---|---|---|
| GET | `/api/health` | — | public |
| POST | `/api/v1/classes` | `{ code, key, unit, students[] }` | class `key` (SHA-256 compared) |
| GET | `/api/v1/classes?code=DBM411` | — | public read of one class |
| GET | `/api/v1/classes?student=s1` | — | public: the classes that student is enrolled in |
| POST | `/api/v1/classes/:code/reports` | `{ key, sessions[] }` | class `key` |
| GET | `/api/v1/classes/:code/reports?key=…` | — | class `key` — merged totals per student |

**D1 schema**

```sql
classes (code TEXT PRIMARY KEY, key_hash TEXT, payload TEXT, revision INTEGER, updated_at INTEGER)
sessions(code TEXT, id TEXT, course_id TEXT, day TEXT, payload TEXT, created_at INTEGER,
         PRIMARY KEY (code, id))
records (code TEXT, id TEXT, session_id TEXT, student_id TEXT, day TEXT, status TEXT, at INTEGER,
         PRIMARY KEY (code, id))
```

Errors are `{ ok: false, error }`; 401 = key missing, 403 = key mismatch, 404 = no such code,
503 = storage unavailable.

**The class key.** `classKeyFor(courseId)` in `assets/js/cloud.js` hashes a fixed namespace plus the
unit id (FNV-1a plus a tail mix, base-36). The same unit therefore always produces the same key, so
two installs and a reinstall of the same unit land on the same row instead of forking the register.
It is a write credential for a shelf, not a user secret — and the Worker stores only its SHA-256.

**Idempotence.** Sessions and records are inserted with their own ids via `INSERT OR IGNORE`, and
the phone remembers which session ids it has already pushed. A retry after a dropped connection
cannot duplicate a check-in; a second push inserts zero rows.

### 3c. The laptop edition — same contract, for desktop demos

`node server.js` serves the static pages and the same `/api/*` routes on `:4173`, backed by
`node:sqlite` (`server/db.cjs`, `server/domain.cjs`, seeded by `server/seed.cjs`), plus
`tools/bt821c-bridge.js` on `:4190` for the optional GPS receiver. It exists so the product can be
shown on a laptop with no phones, and it is where the load numbers come from.

---

## 4. Evidence: what was actually run

| Check | Command / method | Result |
|---|---|---|
| Rules unit tests | `./gradlew :app:testDebugUnitTest` | **8 tests, 0 failures** |
| Transport unit tests | same run (`TransportTest`) | **6 tests, 0 failures** (health, full state, uncompressed body, `/api/events` refused over Bluetooth, several requests on one stream, closed stream → false) |
| Lecturer APK build | `./gradlew assembleDebug` | `BUILD SUCCESSFUL` |
| Student APK build | `./gradlew assembleDebug` | `BUILD SUCCESSFUL` |
| Packaged JS matches source | unzip `assets/public/assets/js/app.js` from the APK | string present (`finds the register on the same phone`) |
| Native code shipped | unzip + grep each `classes*.dex` | `registerOnThisPhone` found in `classes8.dex` |
| Permissions declared | merged manifest | `INTERNET`, location, `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, legacy Bluetooth |
| Whole-class concurrency (laptop edition) | `node tools/loadtest.cjs` | 85 posts, **0 failures, 252 ms** wall, p95 224 ms, ~337 posts/s |
| Cloud write auth | `curl` with wrong / missing key | **403** wrong key, **401** missing key |
| Cloud idempotence | push the same payload twice | second push `insertedRecords: 0` |
| Cloud end-to-end | phone client sync against the deployed Worker | 3 units, 85 students, 43 sessions stored and read back |
| Demo data | reset + reload | 8 units, 340 students, a semester of history |

**What was not run:** a walk-through on two physical phones. Pairing prompts, RFCOMM throughput and
the WebView's LAN fetch are verified by construction and by JVM tests over the transport, not by
holding two handsets. Say that before a judge finds it.

---

## 5. Known limitations (say them first)

| Limitation | Consequence |
|---|---|
| No hardware walk-through | the APKs are built and statically verified; the first pilot does the device pass |
| Bluetooth needs one-time pairing per student | the lecturer must open the 5-minute *findable* window for a new class |
| RFCOMM is serial | posts over Bluetooth queue at roughly 1–3 s each; a large class should use Wi-Fi |
| No live event stream over Bluetooth | the student screen polls instead of streaming |
| No authentication | demo accounts (`s1`, `l1`, `a1`) are the identity; production needs institutional SSO |
| GPS and BLE can be spoofed | the fence raises the cost of proxy attendance, it does not defeat a rooted phone |
| One phone per class | two lecturer phones cannot co-host one class; the register has one writer |
| Debug-signed APKs | fine for a pilot and sideloading, not for Play Store distribution |
| Cloud hosting is a single free-tier environment | fine for a pilot; a contract needs paid limits and a backup policy |

---

## 6. Twenty questions a judge may ask

**1. "Show me how the APK exists — not the demo, the actual artefact."**
Four steps: stage the web assets into both Capacitor projects, `cap sync`, `gradlew assembleDebug`,
copy the APK. §1 has the commands; the APK in `dist/` is that output, and you can unzip it and find
the same JavaScript that is in `assets/`.

**2. "Why Java and not Kotlin?"**
The host is a few hundred lines of threading and sockets; Java keeps it dependency-free apart from
Gson, and every Android engineer who reads it knows it. Kotlin would add a toolchain step, not a
capability.

**3. "Why Capacitor instead of native Android UI?"**
Both apps are mostly forms, tables and a status panel — the same screens the product already needed
in a browser. Capacitor shares that code between web and both APKs, and the only genuinely native
parts (a socket server, NSD, RFCOMM) are exactly the four small classes in `host/`.

**4. "Where is the actual server code?"**
`native/lecturer/android/app/src/main/java/com/baraton/attendsmart/lecturer/host/ClassServer.java` —
about 400 lines: parse a request line and headers, route, serialise JSON, keep-alive. One method,
`serveOne(InputStream, OutputStream, boolean allowEvents)`, is shared by the Wi-Fi socket and the
Bluetooth socket, so both transports enforce the same rules by construction.

**5. "How does a student's phone find the lecturer's phone?"**
Three ways, in order: loopback (same handset), NSD service `_attendease._tcp.` plus a UDP beacon on
port 4174, then Bluetooth. `host.js` only ever returns one of those, and `data.js` treats the result
as "the base".

**6. "What happens when the campus network isolates clients?"**
That is the case the Bluetooth lane exists for. The student's request is retried **only** when the
fetch itself failed; if the register answered with a refusal, that answer is final and is never
reposted down the other lane.

**7. "How do you prevent double posting when the second lane is tried?"**
Two independent guards: the transport rule above (retry only on a network failure), and the register
itself, which refuses a second record for the same session *and* the same unit on the same calendar
day, quoting the original time.

**8. "Why is the phone authoritative and not the cloud?"**
Because a lecture hall may have no working network, and a class cannot wait for one. The phone that
opened the window is the only writer, so there is no conflict to resolve — the cloud only stores
what a finished session produced.

**9. "Then what is the cloud for?"**
Two things: a roster shelf (a student's phone can learn which units they are in, and one added to a
unit late still gets in), and a durable copy of finished reports that survives the phone.

**10. "How is the class key protected if it is derived from the unit id?"**
It is not a user secret; it is a write credential that prevents one phone overwriting another
phone's class. The Worker stores only its SHA-256 and returns 401/403. Anything truly private would
need the SSO layer that is on the pilot roadmap.

**11. "What is the database?"**
On the phone: one JSON document (`class-register.json`) with a revision counter, written by a single
process. On the laptop edition: SQLite via `node:sqlite` (WAL). On the shelf: Cloudflare D1 with
three normalised tables.

**12. "How many students can post at once?"**
One phone serves one class of about 85 comfortably over Wi-Fi: the register is single-writer and the
live feed is coalesced to one revision bump per burst. The measured 85-post run (252 ms, zero
failures) is on the laptop edition; the phone runs the same algorithm with a smaller CPU budget, so
expect a second rather than 250 ms.

**13. "What if two students share a phone?"**
They cannot, by design: the first device that posts for a student is permanently bound to them, and
a second student using it is refused **and** logged for the lecturer. That is a policy choice, and
it is reversible only by the lecturer resetting the class.

**14. "What about a student with no smartphone?"**
The lecturer can mark them present manually in the register; the app never pretends a manual entry
is a verified post — the record carries its method, so the register stays honest.

**15. "Offline — what exactly happens?"**
The class does not depend on the cloud at all. A student's roster is cached; the post goes to the
lecturer's phone over Wi-Fi or Bluetooth; the report sits on the phone until a network appears, then
syncs idempotently.

**16. "How do you know the packaged app is the code you showed me?"**
Every claim in this pack was checked inside the artefact: unzip the APK and grep `assets/public/`
for the JavaScript, and `classes*.dex` for the Java. That is why the verification steps are written
down rather than described.

**17. "What is faked in this demo?"**
The semester history (seeded), the accounts (no passwords), and the GPS fixes (a laptop or a stored
fix). Everything else — the rules, the transports, the export, the cloud — is the real
implementation. Say this plainly; it is more credible than being caught.

**18. "What breaks first at scale?"**
Not the rules — the discovery. Hundreds of phones probing the same subnet is fine, but one lecturer
phone serving several parallel classes is not, and the cloud shelf's free tier is not a contract.
Both are known and both are pilot work.

**19. "Why should the registrar trust a phone?"**
They should not trust it blindly, and the design does not ask them to: every post carries a device
id, a distance, a method and a time; blocked attempts are logged; and the register is exportable, so
the institution can audit it offline the way it audits paper today.

**20. "What would you build next, in order?"**
Institutional SSO (so a register entry has a real identity), offline queuing for the student app
(the post survives a dead radio), and the registrar's report pack (per-unit percentages and
eligibility flags exported in the format Senate already reads).
