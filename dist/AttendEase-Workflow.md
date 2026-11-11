# AttendEase — Workflow

How a change becomes a shipped APK, how the repository is run, and the runbook for the twenty
minutes before a demo. This is the process that actually produced the commits on
`hackathon/pitch-pack`.

`AttendEase v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE`

---

## 1. The change loop

Every change, however small, walks the same six steps. The point of the loop is that **nothing is
claimed until it is seen inside the built artefact** — the APK, not the source.

```
  ① edit            assets/ (shared web)  or  native/<app>/.../host/ (phone rules)
  ② stage           node tools/build-mobile.js          → native/*/www/
  ③ sync            (cd native/<app> && npx cap sync android)
  ④ build           (cd native/<app>/android && ./gradlew assembleDebug --no-daemon)
  ⑤ test + verify   ./gradlew :app:testDebugUnitTest  +  unzip and grep the APK
  ⑥ ship            cp to dist/  →  commit  →  push branch  →  PR to master
```

### The one-liner that does ②–⑤

```bash
export JAVA_HOME="$PWD/.toolchain/jdk" ANDROID_HOME="$PWD/.toolchain/sdk"
node tools/build-mobile.js
(cd native/student  && npx cap sync android) ; (cd native/student/android  && ./gradlew assembleDebug --no-daemon)
(cd native/lecturer && npx cap sync android) ; (cd native/lecturer/android && ./gradlew assembleDebug :app:testDebugUnitTest --no-daemon)
```

Then **always** confirm the change travelled, because a green build proves compilation, not intent:

```bash
unzip -p dist/AttendSmart-Student-debug.apk assets/public/assets/js/app.js | grep "<a string you changed>"
for d in $(unzip -l dist/AttendSmart-Lecturer-debug.apk | grep -o "classes[0-9]*\.dex"); do
  unzip -p dist/AttendSmart-Lecturer-debug.apk "$d" > /tmp/d.bin; echo "$d $(grep -ac <YourClass> /tmp/d.bin)"; done
```

That last trick exists because the app's own classes land in `classes8.dex` in a multi-dex build —
grepping `classes.dex` alone will tell you a class is missing when it is present.

---

## 2. Branching and commits

| Rule | Why |
|---|---|
| `master` is the demoable state; work happens on a branch | a judge may open the repo at any moment |
| one branch per theme, not per file | `hackathon/pitch-pack` carries three coherent commits |
| commits say **why**, in the imperative | `Let a student app find a register hosted on its own phone`, not `update files` |
| source **and** the rebuilt APK in the same commit | the repository always contains the binary its sources produce |
| never commit `native/*/www`, `.toolchain/`, `data/`, `*.log` | they are generated or machine-local; see `.gitignore` |
| push the branch, then open the PR | the diff is the pitch: reviewers read changes, not a wall of files |

The branch in this repository is the worked example:

```
18f42b3  Let a student app find a register hosted on its own phone    code + both APKs
3c6f088  Write the pitch pack for the phone-hosted build              dist/*.md
f20cd08  Log the issues the phone-hosted build exposed                docs + README
```

---

## 3. Verification gates (what "done" means)

| Gate | Command | Must show |
|---|---|---|
| Rules suite | `:app:testDebugUnitTest` | `RulesTest` 8/8, `TransportTest` 6/6, 0 failures |
| Lecturer build | `assembleDebug` | `BUILD SUCCESSFUL` |
| Student build | `assembleDebug` | `BUILD SUCCESSFUL` |
| Artefact contains the change | unzip + grep (above) | the string or class, in the APK |
| Package ids untouched | `grep applicationId native/*/android/app/build.gradle` | `.lecturer` / `.student` |
| Permissions intact | `grep uses-permission` merged manifest | INTERNET, location, Bluetooth pair/scan/connect |
| Docs match code | read the claim, then find the file | every path, port and endpoint in `dist/` exists |
| Cloud still answers | `curl <cloud>/api/health` | `{"ok":true,...}` |

**Not a gate:** running the app on a phone. There is no device in this workspace, so the loop stops
at the artefact and the remaining step is written down in `docs/ISSUES-SOLVED.md` rather than
pretended. Any workflow that silently skips a gate is worse than one that names the gap.

---

## 4. Toolchain bootstrap (once per machine)

```bash
# JDK 21 + Android SDK 36, project-local and git-ignored
.toolchain/jdk/          # JAVA_HOME
.toolchain/sdk/          # ANDROID_HOME, build-tools 36.0.0, platform 36

# each Gradle project needs to know where the SDK is
native/student/android/local.properties   sdk.dir=.../.toolchain/sdk
native/lecturer/android/local.properties  sdk.dir=.../.toolchain/sdk

# Capacitor CLI comes from the project, not the global path
npx cap --version
```

Nothing here is required to *run* the product — only to rebuild an APK. The demo uses the APKs in
`dist/`, and the laptop edition needs nothing but `node server.js`.

---

## 5. The release process (what "shipping" means for this project)

There is no store and no CI. A release is four manual steps, and that is deliberate: a pilot
distributes a file over WhatsApp or a QR code.

1. **Version** — `dist/` file names, the footer string in the views
   (`AttendEase v1.2 | HACKATHON PROJECT | © 2026 | …`) and the `package.json` version move together.
2. **Build both**, run the gates in §3, copy into `dist/`.
3. **Snapshot the source** (`dist/AttendSmart-source.zip`) so a judge can read the tree without Git.
4. **Push the branch and open the PR.** Merging to `master` is what makes the repository's front page
   the current build.

Signing: the APKs are **debug-signed**. That is installable from a file and fine for a pilot; a store
release needs a keystore, `signingConfigs` in both `build.gradle` files and a version bump — say so
before a judge asks why Android warns about an unknown developer.

---

## 6. Demo-day runbook

**T–20 minutes**

- [ ] `node server.js` if you are using the laptop edition; otherwise both APKs installed and opened once.
- [ ] **Admin → University → Reset demo data** (clean counts, 8 units, 340 students).
- [ ] Lecturer app: sign in as `l1`, hide the keyboard, keep the app in recents.
- [ ] Student app: sign in as `s1`, confirm it reaches the register (`Step 1` finds it or shows the
      address box).
- [ ] Press START once, post once, press STOP, then reset again — you now know the happy path works
      on this device today.
- [ ] Excel download tested into a folder you can open in two clicks.
- [ ] Screenshots of every screen open in a browser tab.

**Order of operations on stage**

1. Lecturer dashboard (no class open).
2. START → read the four digits.
3. Student app → scan → Step 2.
4. Type the code → POST → green confirmation.
5. Lecturer panel updates with no refresh. *Pause here.*
6. Same code again → refusal quoting the original time.
7. STOP → DOWNLOAD EXCEL.

**Fallback ladder** — move down one rung, never debug on stage for more than twenty seconds:

| Rung | When | What you do |
|---|---|---|
| 1. Wi-Fi discovery | normal | do nothing, it works |
| 2. Bluetooth lane | campus AP isolates clients | student app searches Bluetooth; lecturer taps **Make this phone findable** once |
| 3. Same handset | only one phone | both apps on that phone; the student app finds the register on loopback |
| 4. Laptop edition | no phones at all | two browser tabs against `node server.js` |
| 5. Screenshots | anything else | "every screen here was captured from the running build" |

If a request fails, show the message. A refusal with a precise reason demos better than a silent
success, and it is the actual product.

---

## 7. Where the workflow is fragile (and the fix, when there is time)

| Fragility | Consequence | Fix |
|---|---|---|
| Two implementations of the rules (`Rules.java` and `server/domain.cjs`) | a rule change must be made twice or the editions diverge | one contract test suite run against both, or delete the laptop edition |
| No CI | a broken build is discovered by hand | a GitHub Action running the JVM suite on push (needs no Android device) |
| Shared web assets | a view change ships to both apps, wanted or not | already deliberate; keep the `data-app` guard when a screen is role-specific |
| `dist/*.apk` committed | repository grows ~8 MB per release | move APKs to Releases and keep only a checksum in the tree |
| Debug signing | Android warns on install | a real keystore before a pilot, stored outside the repo |
| No device in the loop | "built" can be mistaken for "works" | the hardware pass is the first pilot task, written in the issues log |
