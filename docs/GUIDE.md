# CLASSPREF3CT — Setup and Operating Guide

Everything needed to run a demo, a pilot class, or a full semester. Read
[ARCHITECTURE.md](ARCHITECTURE.md) if you want to know *why* it behaves this way.

---

## 1. One-time setup on the laptop

**Requirements**

- Node.js **18 or newer** (`node -v`). `node:sqlite` is built in, so there is nothing to `npm install`.
- A Wi-Fi network that the phones can join, on the same subnet as the laptop.
- Windows, macOS or Linux all work.

```bash
git clone <repo> && cd attendsmart-ai
node server.js
```

The banner prints what you need:

```
  CLASSPREF3CT — shared backend running
  Database : .../data/attendsmart.db
  Local    : http://localhost:4173
  Network  : http://192.168.72.124:4173   ← use this on the phones
  BT bridge: http://192.168.72.124:4190/fix
```

**Leave this terminal open.** The attendance server must stay running for the whole session.

> Windows Firewall will ask whether to allow Node.js. Allow it on **private networks**, or the
> phones cannot reach port 4173.

---

## 2. Put the apps on the phones

Two options, in order of reliability.

### A. Install the APKs (recommended)

1. Copy `dist/CLASSPREF3CT-Student-debug.apk` to a student phone and
   `dist/CLASSPREF3CT-Lecturer-debug.apk` to the lecturer's phone (USB, WhatsApp to yourself, Drive).
2. Open the file, allow "install from unknown sources" when Android asks, install.
3. First launch shows **CLASSPREF3CT — CLASS SERVER**. Type the laptop's `Network` address
   (`http://192.168.72.124:4173`) and press **CONNECT**.
4. Sign in with a demo account (below).

The address is remembered. To change it later, use **Switch user** in the footer.

### B. Use the browser

Open `http://192.168.72.124:4173` on the phone, choose Student or Lecturer, then use the browser's
"Add to Home screen". The interface is identical, but the browser blocks GPS on a plain `http://`
address and has no native Bluetooth scan — the app will say so plainly and use the server scan.

---

## 3. Bluetooth

The apps **listen** for a BLE advertisement whose name matches the session, e.g.
`DBM411_MONDAY_CLASS`. Three ways to put that on air:

| Option | How |
|---|---|
| A BLE beacon | configure its advertised name to the session's beacon name; any cheap iBeacon/Eddystone tag that allows renaming works |
| A spare phone | run any "BLE advertiser" app and set the advertised name |
| BT-821C on the laptop | the receiver's bridge publishes the fix; the card then shows `ON — BT-821C (COM3)` |

What the screens report:

| Label | Meaning |
|---|---|
| `Bluetooth: ON — beacon DBM411_MONDAY_CLASS` | the phone hears the class beacon |
| `Bluetooth: ON — beacon not seen` | window open, nothing on air nearby |
| `Bluetooth: ON — BT-821C (COM3)` | laptop receiver attached |
| `Bluetooth: OFF` | no window open |

The student's Step 1 has **SCAN WITH BLUETOOTH**: in the APK it scans silently, in Chrome it opens
the browser's device picker. A match shows `Bluetooth: confirmed <NAME>` and the post is stored with
`method: "ble"`. **No match never blocks attendance** — the code and the GPS fence still decide.

---

## 4. Running a class

**Lecturer (2 minutes before class)**

1. Sign in → **Lecturer Dashboard**.
2. Check the unit card: Room, Time, `Code: ---- NOT STARTED`, Students, Present Today.
3. Press **START**. The card shows `Code: 4821 LIVE`, `Bluetooth: ON — …`, and a
   **Posted this session 0 of 85** panel.
4. Project the four digits, or read them out.

**Students**

1. **Take Attendance** → the scan box runs automatically.
2. `Step 2 — Lecture Found` shows the unit, room, time and lecturer.
3. Type the four digits → **POST ATTENDANCE**.
4. Green confirmation: `Attendance posted successfully for Database Systems - DBM411 · 0 m from the
   class · marked present`. That record is final.

**Lecturer, while it runs**

- Names appear in **Posted this session** with a NEW tag for the first two minutes; the matching row
  in the class table is highlighted.
- **Present Today** counts up live, no refresh.

**When the window ends**

- Press **STOP**, or let the window expire (the server sweeps every 15 s).
- **DOWNLOAD EXCEL** exports the compiled register: Student, Reg No, Status, Time, Distance.

---

## 5. Creating a unit

**+ Create New Unit** → popup → Unit Name, Course Code, Room, Time, **Paste Students**.

Paste two columns straight from Excel:

```
BAR/2023/201   Alice Wambui
BAR/2023/202   Brian Otieno
```

Existing registration numbers are matched and reused, so pasting twice cannot duplicate anyone.
**SAVE UNIT** adds it to the dashboard immediately.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| App says it cannot reach the server | wrong address, phone on mobile data, firewall | re-enter the `Network` address, same Wi-Fi, allow Node on private networks |
| `This page is on http://, so the browser blocks GPS` | browser + insecure origin | use the APK, or serve over https |
| `Location permission is off for CLASSPREF3CT` | permission denied | Settings → Apps → CLASSPREF3CT → Permissions → Location → Allow while using |
| `No GPS fix yet` | indoors, no satellites | the app retries with network location; step near a door/window and press POST again |
| `You already posted attendance for DBM411 today` | one post per class per day | expected — nothing to do |
| `You are N m from the class location` | outside the fence | move closer; the fence is the point |
| `This device is permanently bound to another student` | phone already used by someone else | that phone cannot be reassigned; use the student's own phone |
| Lecturer card says `beacon not seen` | no beacon on air | see §3, or accept code + GPS only |
| Bluetooth button missing | browser without Web Bluetooth | use the APK |

Server logs: the terminal running `node server.js`. Every API error prints with a stack trace.

---

## 7. Demo reset

Restores the seeded semester (wipes test posts, keeps code untouched):

```bash
curl -X POST http://localhost:4173/api/admin/reset \
  -H "Content-Type: application/json" -d '{"actorId":"a1"}'
```

Or **Admin console → University → Reset demo data**.

Accounts after a reset:

| Role | Id | Name | Notes |
|---|---|---|---|
| Student | `s1` | John Kimutai · BAR/2023/101 | 83.5% overall, DBM411 at risk |
| Student | `s2` | Mary Barasa · BAR/2023/102 | used to test the device-identity lock |
| Lecturer | `l1` | Dr. Peter Mwangi | DBM411 (85), BBIT500 (44), BBIT312 (44) |
| Lecturer | `l2` | Dr. Grace Chebet | DBM412, DBM415 |
| Admin | `a1` | Administrator | reset, university KPIs |

---

## 8. Building the APKs

One-time toolchain (already present in `.toolchain/`, git-ignored):

- **JDK 21** and **Android SDK 36** (build-tools 36.0.0, platform 36).
- `local.properties` in each `native/*/android` points at the SDK.

```bash
export JAVA_HOME="$PWD/.toolchain/jdk"
export ANDROID_HOME="$PWD/.toolchain/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

node tools/build-mobile.js                    # stage web assets into native/*/www

cd native/student && npx cap sync android
cd android && ./gradlew assembleDebug --no-daemon
# app/build/outputs/apk/debug/app-debug.apk

cd ../../../lecturer && npx cap sync android
cd android && ./gradlew assembleDebug --no-daemon
```

Copy both `app-debug.apk` files into `dist/` with the names above. First build compiles the
Bluetooth plugin and takes ~2 minutes; later builds are ~30 s.

**Permissions the apps declare** (do not remove them): `INTERNET`, `ACCESS_FINE_LOCATION`,
`ACCESS_COARSE_LOCATION`, `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, plus the legacy Bluetooth pair for
Android 11 and below.

---

## 9. Load test

Proves a whole class can post at once without queueing:

```bash
# scratch database on a spare port, so demo data is untouched
ATTENDEASE_DB="$PWD/data/loadtest.db" PORT=4199 node server.js &

node tools/loadtest.cjs            # defaults to :4199, course c1, every enrolled student
```

Expected on a laptop: 85 posts in well under a second, zero failures, every record present.
Point it at the live server with `BASE=http://localhost:4173 node tools/loadtest.cjs` — that one
writes real records.
