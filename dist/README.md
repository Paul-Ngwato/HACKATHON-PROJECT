# CLASSPREF3CT — Pitch Pack

Everything a judge, a registrar or a new developer needs, in the order they need it.
All of it describes the code in this repository as it actually is, not an aspiration.

`CLASSPREF3CT v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE`

---

## What this is in six sentences

1. Two Android apps. The **lecturer app hosts the attendance register on the lecturer's own phone** — no laptop, no server, no campus network required.
2. The lecturer taps **START**, the phone issues a four-digit code and starts a register that class can reach over Wi-Fi or Bluetooth.
3. A student posts from inside the room: the code, the final semester register, a GPS fence and a device that is permanently bound to them.
4. The lecturer watches names arrive live and downloads the register as Excel the moment class ends.
5. A small optional cloud (Cloudflare Worker + D1) is a shelf, not the authority: the lecturer's phone can publish a unit's roster and push finished reports so students' phones can see their units and the record survives the phone.
6. Nothing about a normal class depends on the internet, and every rule is enforced in one place — on the phone that runs the class.

---

## Read these in this order

| File | Answers |
|---|---|
| [CLASSPREF3CT-How-It-Works-Simply.md](CLASSPREF3CT-How-It-Works-Simply.md) | **Start here if you are not a developer.** The whole system in plain words: where the idea came from, how the phones talk over Wi-Fi and Bluetooth, the invisible machinery nobody sees, where location and the graphics come from, how the cloud shelf connects, what the school saves and earns, and how Bluetooth fits into a real class. |
| [CLASSPREF3CT-Pitch-5-Minutes.md](CLASSPREF3CT-Pitch-5-Minutes.md) | What do I say, in what order, for exactly five minutes — plus the demo beats that win it and the answers to the questions judges actually ask. |
| [CLASSPREF3CT-Business-Model.md](CLASSPREF3CT-Business-Model.md) | Who pays, how much, why now, what it costs to serve, and what the pilot has to prove. |
| [CLASSPREF3CT-Code-Tour.md](CLASSPREF3CT-Code-Tour.md) | Where every file is, what it does, and how one check-in travels from a student's thumb to the lecturer's screen — over Wi-Fi and over Bluetooth. |
| [CLASSPREF3CT-Build-API-QA.md](CLASSPREF3CT-Build-API-QA.md) | How the APK came to exist step by step, the complete API of all three surfaces, the process, the evidence, and twenty prepared answers. |
| [CLASSPREF3CT-Workflow.md](CLASSPREF3CT-Workflow.md) | The change loop, the verification gates, the release process, and the demo-day runbook with its fallback ladder. |
| [CLASSPREF3CT-Issues-Log.md](CLASSPREF3CT-Issues-Log.md) | All twenty issues on one page with how each was verified, plus the open gaps that are still owed. |

Also in this folder: `CLASSPREF3CT-Student-debug.apk` and `CLASSPREF3CT-Lecturer-debug.apk` — the
installable builds, and `CLASSPREF3CT-source.zip`, a snapshot of the source these were built from.

---

## The architecture on one page

```
              LECTURER PHONE                                   STUDENT PHONE
   ┌──────────────────────────────┐                 ┌──────────────────────────────┐
   │ CLASSPREF3CT Lecturer APK      │                 │ CLASSPREF3CT Student APK       │
   │                              │  1. Wi-Fi  ────►│ finds the register by:       │
   │  ClassHost  :4173  ◄─────────┼─────────────────┼── NSD _attendease._tcp.      │
   │  Discovery  :4174  (beacon)  │  2. BT     ────►│── UDP beacon :4174           │
   │  BtServer   RFCOMM ──────────┼─────────────────┼── Bluetooth RFCOMM (pairing) │
   │                              │                 │                              │
   │  Register  class-register.json                 │  data.js request()           │
   │  Rules     the five gates    │                 │  bt.js  Bluetooth lane       │
   └───────────────┬──────────────┘                 └──────────────────────────────┘
                   │ optional, never in the way
                   ▼
        ┌──────────────────────────────────────┐
        │ Cloud Worker + D1  (Cloudflare)      │  roster publish · report push
        │ public site-0e3e6d55....freebuff.page│  idempotent, key-hashed writes
        └──────────────────────────────────────┘
```

The same web assets power both apps (`student.html` / `lecturer.html` staged by
`tools/build-mobile.js`), so the screens and the transport code cannot drift apart, and the same
pages also run in a browser against the laptop server (`server.js`) for a desktop demo.

---

## Honest status

Built, packaged and unit-tested here; **not walked through on two physical phones** in this
workspace. Bluetooth pairing, RFCOMM throughput and the WebView's LAN fetch are verified by
construction and by JVM tests, not by holding two handsets. Every other claim in this pack is
reproducible with a command in
[CLASSPREF3CT-Build-API-QA.md](CLASSPREF3CT-Build-API-QA.md#evidence-what-was-actually-run).
