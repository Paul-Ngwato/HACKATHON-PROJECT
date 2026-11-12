# CLASSPREF3CT — How It Really Works

**The plain-language version. No code, no jargon, nothing you need a computer science degree for.**

`CLASSPREF3CT v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE`

---

## 1. The whole thing in sixty seconds

Think of the lecturer's phone as a **small classroom website that lives in their pocket**. It is not on
the internet. It is not in a server room. It is running inside the phone, in the lecturer's bag.

When the lecturer presses **START**, that phone quietly starts three things:

1. A **notice board** that says "the register for DBM411 is at this phone, right now".
2. A **counter** where students can walk up and post their name.
3. A **clock** that closes the counter after ten minutes.

Students' phones look for that notice board, find it, and post to it. The lecturer watches names appear
and downloads the register as Excel when class ends. Nothing touches the internet, so a dead campus
network, a power cut in the server room, or a month of no data bundles changes nothing.

The internet is used for **one optional thing**: keeping a copy of the roster and the finished reports
on a shelf in the cloud, so a lecturer who loses a phone does not lose the semester.

That is the product. Everything else in this document explains how those few sentences are true.

---

## 2. Where the idea came from

The idea did not start as a technology idea. It started as an **argument at the back of a lecture hall**.

A roll call in a class of 60 takes three to five minutes. Multiply that by every unit, every week, for
every lecturer: it is weeks of teaching time a semester, spent reading names. Then the same names are
copied into a paper sheet, then into a spreadsheet at the end of the term, then argued about when a
student is told they will not sit an exam because they were marked absent in a class they swear they
attended.

The obvious fix is a system on the campus network. The problem, which anybody who has actually been in
a lab knows, is that the network is exactly the thing that fails. Rooms have no coverage. Access points
put every phone on its own island so phones cannot see each other. The password was changed last week.
The server is down for maintenance. And when it fails, the lecturer goes back to paper — so the school
paid for software nobody uses.

The turn was simple and slightly uncomfortable: **give the responsibility to the person who already
has it.** The lecturer is the authority for their own class. Their phone is already in the room,
already charged, already in their hand. So the register should be *on that phone*, not on a server
somebody else maintains.

Once you accept that, the rest follows:

- If the register is on the lecturer's phone, students must reach that phone. There are exactly two
  ways two phones in one room can talk without a working network: **Wi-Fi Direct-ish local networking
  (same network, or a hotspot)** and **Bluetooth**.
- Because campus Wi-Fi often blocks phone-to-phone traffic, **Bluetooth is not a gimmick. It is the
  lane that survives the worst network.** That is why it is the selling part: it removes the last
  excuse for falling back to paper.
- If the register lives on one phone, then every rule must be decided on that phone, because that phone
  is the only writer. There is no second copy to reconcile. That is a **feature**, not a limitation:
  one authority means no conflicts.
- The cloud can only be a **shelf**. If the cloud were the authority, the class would stop working the
  moment the internet did, and we are back to the problem we started with.

So the design is not "an app with a database". It is **a register that happens to be a phone app**, plus
a shelf, plus a paper trail in Excel.

---

## 3. What the system actually is — three pieces

| Piece | What it is in plain words | Where it lives |
|---|---|---|
| **Lecturer app** | The register, the rules, the clock, the Excel export. Also the thing students connect to. | Lecturer's Android phone |
| **Student app** | Looks for the register, posts your name, shows your attendance percentage. | Student's Android phone |
| **Cloud shelf** | A copy of the roster and finished reports, so records survive a lost phone. Optional. | Cloudflare Worker + database |

There is a fourth piece that only exists for demonstrations: the same screens also run in a normal
browser against a small server on a laptop (`server.js`). That is useful when a judge wants to see the
dashboard on a projector, and it means the interface and the transport code are shared, so the two can
never drift apart.

Both apps are the same web screens wrapped in a thin Android shell. That is why they are small (about
7.7 MB each) and why one fix to a screen fixes it in both apps and in the browser version.

---

## 4. How the two phones find each other — the Wi-Fi lane

This is the part that looks like magic and is actually three very old, very boring tricks stacked.

### 4.1 Step one: the lecturer's phone announces itself

When the lecturer presses START, the phone does two things at once, because campus networks differ:

- **mDNS / DNS-SD.** It publishes a service called `_attendease._tcp.` on the local network. Think of it
  as the phone writing its name and address on a notice board that every device on that network can
  read. It costs nothing and needs no server. This is the same mechanism that lets a printer appear in
  your phone's print menu.
- **A UDP broadcast beacon on port 4174.** Every few seconds the phone shouts "CLASSPREF3CT is here, port
  4173" to the whole room. Some campus access points drop the mDNS multicast packets, but they almost
  always let a broadcast through. Whichever of the two answers first wins.

The announcement carries a friendly label ("CLASSPREF3CT DBM411") so a student can see *which* register
they found when two lecturers are in the same corridor.

### 4.2 Step two: the student's phone listens

The student app listens for that announcement. When it hears one, it learns two facts: an **IP address**
(the phone's number on the local network, something like `192.168.1.42`) and a **port** (the door number
on that phone — `4173`). Address plus door is everything needed to knock.

If nothing answers on the network, the student app also checks one special case: **is the register on
this very phone?** If the lecturer is testing alone, the app tries `http://127.0.0.1:4173` — "me, talking
to myself" — and skips the whole search. That is why a single-phone demo works instantly.

### 4.3 Step three: they speak normal web language

The phone at the other end is running a tiny web server. The student app sends it ordinary web requests,
the same kind a browser sends when you open a page:

```
GET  /api/health                      "are you there, and which version?"
GET  /api/state                       "give me the current register"
GET  /api/sessions/lookup?code=4821   "which class does 4821 belong to?"
POST /api/checkin                     "post my attendance"
GET  /api/events                      "keep a live line open and tell me about changes"
```

The answers come back as small blocks of text in a format called JSON, which is just labelled data:

```json
{ "ok": true, "result": { "ok": true, "step": "done",
  "record": { "status": "present", "distanceM": 12 } } }
```

That is the entire "API". There is no special protocol. It is the same shape the laptop server uses, so
the same web screens work against either one.

### 4.4 Why this survives a bad network

- No DNS server, no internet, no domain name. Just two devices on the same wire/air.
- The lecturer can turn on a **phone hotspot** and read the code off the screen; the register is then at
  `192.168.43.1`, and the app knows that address by heart.
- Every request carries `Connection: close` and is answered by one small handler, so a student walking
  out of range drops one request and nothing else.
- The lecturer's own screen talks to `127.0.0.1`, so **the lecturer never depends on the network at all**
  — even if the hotspot dies, the lecturer can still start, stop and export.

---

## 5. How the two phones find each other — the Bluetooth lane

This is the lane that makes the promise real, because it needs **no network at all**. Not the campus
Wi-Fi, not a hotspot, not even a SIM card. Two phones, ten metres, done.

### 5.1 The pieces

| Piece | Plain meaning |
|---|---|
| **RFCOMM** | The classic Bluetooth "serial cable in the air". One phone listens, one connects, then it is just a pipe you can write bytes into. |
| **SDP record** | The name tag the listening phone publishes: "I speak the CLASSPREF3CT service". Its identifier is fixed: `8f1c9d42-6b7e-4c1a-9f10-2d5e7a3b6c88`. |
| **Pairing / bonding** | The one-time security handshake Android shows as a dialog. After it, the two phones remember each other and never ask again. |
| **Discoverable** | The five-minute window in which an unpaired phone is allowed to *see* the lecturer's phone at all. |
| **Insecure RFCOMM** | A deliberately PIN-less variant, so pairing is a single "Pair" tap instead of typing a number. |

### 5.2 What actually happens, in order

1. The lecturer taps **Make this phone findable**. Android asks for *Nearby devices* permission, then
   opens a five-minute discoverable window. The app keeps the Bluetooth listener running the whole time
   class is live.
2. The student taps **SCAN BLUETOOTH**. Their phone first tries the phone that hosted the last class
   (remembered), then any already-paired phone that publishes the CLASSPREF3CT service, then finally a
   fresh Bluetooth discovery scan.
3. When it finds the lecturer's phone, Android shows a pairing prompt. The student taps Pair. The phones
   bond. This happens **once per student per semester**.
4. The student's app then opens a Bluetooth socket and — this is the important design decision — sends
   **the same HTTP requests** down it that it would have sent over Wi-Fi.
5. On the lecturer's phone, the Bluetooth server hands that socket to the *same* `ClassServer` code that
   handles Wi-Fi. Same routes, same rules, same answers. One line of code decides: is this a network
   socket or a Bluetooth socket? Everything after that is identical.

So Bluetooth is not a second app or a second set of rules. It is **a different pipe into the same
register**. A student who posts over Bluetooth and a student who posts over Wi-Fi create exactly the same
kind of record, subject to exactly the same five gates.

### 5.3 What Bluetooth cannot do, and why that is fine

Bluetooth is a serial link: roughly one conversation at a time, a second or two per post. It cannot hold
a live stream open for the lecturer's dashboard the way Wi-Fi can. So one route — `/api/events`, the live
feed — is deliberately refused over Bluetooth with a clear message:

> `Live updates are not available over Bluetooth.`

What a Bluetooth student loses is a continuously refreshing screen. What they keep is everything that
matters: they can look up the code, post attendance, and get a receipt. For a class of 60, that is one
to three minutes of posting — which is what a roll call already costs, except nobody reads names.

### 5.4 Why Bluetooth is the selling part

Because it is the answer to the only objection that has ever killed this kind of project:

> "Our Wi-Fi doesn't let phones talk to each other."

With Bluetooth, the network becomes irrelevant. The class still runs. That is the difference between a
demo and something a lecturer will use on a Monday morning when the access point is down.

---

## 6. The invisible parts — what happens that nobody sees

This is the list judges and school administrators rarely ask about, and it is where trust actually lives.

| Invisible thing | What it is doing for you |
|---|---|
| **DHCP and IP addresses** | Every phone in the room quietly gets a number from the router. The app reads that number instead of asking anybody to type it. |
| **ARP** | When the student's phone knows the lecturer's number, ARP finds the physical device on the wire. One layer below anything a user sees. |
| **TCP handshake** | Before a single byte of attendance is sent, the two phones agree they can both talk. If that fails, you get "couldn't connect", not a lost record. |
| **Ports** | `4173` register, `4174` discovery beacons, `4190` the app's internal bridge. They are door numbers on one address, which is why two things can run on one phone. |
| **Gzip compression** | A full state is about 1.2 MB of JSON. Compressed it is a tenth of that, which is why 60 students polling do not melt the hotspot. |
| **Server-sent events** | One long-lived connection where the phone pushes a small frame whenever something changes, plus a keep-alive. This is the lecturer's live dashboard. |
| **A revision counter** | The register increments a number on every change. Two screens can then tell whether they are looking at the same reality without comparing megabytes. |
| **Idempotency** | Every record has its own id, and the cloud inserts by id. A phone that retries after a dropped connection creates **zero** duplicates. This was tested: a re-push inserted 0 rows. |
| **A device binding ("identity lock")** | The first phone that posts for a student is written into the register as theirs, permanently. Another phone claiming that student is refused and logged. |
| **Security events** | Refused attempts are written down, not just rejected: "this person tried to post for a unit they are not registered for". The lecturer can see them. |
| **SHA-256 hashing** | The cloud never stores the class key in readable form, only its fingerprint. Even someone with the database cannot derive the key. |
| **Android permissions** | Camera-free, contact-free, but it does need location (for the fence) and Nearby devices (for Bluetooth). Missing permissions are surfaced as a sentence, not a crash. |
| **MediaStore** | A web page cannot save a file to Downloads. So the export is handed to Android's own download store, which is why the CSV appears in `Downloads/CLASSPREF3CT`. |
| **WebView settings** | The phone allows the packaged page to talk to `http://192.168.x.x` (cleartext) and to mix content. Without that one setting the app would look broken on a LAN. |
| **Timezone handling** | All times are stored in UTC and shown in the phone's local time, so "posted at 09:37" is 09:37 where the class is. |
| **A clock sweep** | On every request the register closes windows whose end time has passed. Nobody presses "stop" and forgets; the window still closes. |
| **Boot painting** | The app draws its real shell before the data arrives, and a watchdog at three seconds says "still searching" instead of leaving a blank screen. |

None of this appears on a slide. All of it is the difference between a demo and a register a registrar
will accept.

---

## 7. Location — the fence, the maths, and honesty about it

### 7.1 Where the location comes from

The phone's GPS chip (assisted by Wi-Fi and cell towers) produces a latitude, a longitude, and an
**accuracy radius in metres**. The app asks for a fix with a timeout, and knows the difference between
"here is my position" and "I have no idea" — a `0,0` fix is treated as *no fix*, not as a position off
the coast of Africa.

### 7.2 What the lecturer's phone records

When the lecturer starts a class, the phone captures its own position as the **official class location**
and stores it on the session (a `venueCapturedAt` timestamp and an accuracy figure are kept too). If the
lecturer has previously captured the room's position, that is the fallback. The default fence is **30
metres**, adjustable between 10 and 200. A manually captured venue defaults to 50 m, and 20–200 m is
accepted.

### 7.3 What the student's phone is checked against

The student's app sends its own fix with the post. The lecturer's phone computes the **great-circle
distance** between the two points using the haversine formula — the same maths a map app uses to say how
far apart two pins are — and compares it to the fence:

```
distance = 2 × 6,371,000 m × arcsin( √( sin²(Δlat/2) + cos(lat₁)·cos(lat₂)·sin²(Δlng/2) ) )
```

If the distance is greater than the radius, the post is refused with the real number:

> You are 84 m from the class location. Attendance requires you within 30 m, even with the correct code.

That sentence is the product working. A friend at home with the code gets a distance, not a record.

### 7.4 The honest limitation

GPS is not a courtroom instrument. Indoors it can drift 10–30 m, and a phone near a window can be
"outside" a 30 m fence while sitting in the room. That is why the fence is **one gate among five**, why
the radius is adjustable per class, and why every record keeps the distance it was accepted at. A
lecturer who wants to be strict can tighten the fence; a lecturer in a basement lab can widen it and let
the code, the roster and the device lock do the work.

### 7.5 The other location trick

The same BLE beacon check on the scan screen is a second opinion: if the class session has a beacon name
(`DBM411_MONDAY_CLASS`), the student's phone can confirm it is physically next to that beacon. That is
proximity evidence that does not depend on GPS at all — useful indoors, where GPS is weakest.

---

## 8. The screens, and where the graphics come from

There are no downloaded images and no icon packs. Every visual is drawn by the page itself: CSS for the
layout and colour, inline SVG for the icons, and small animations for feedback.

- **The old-government-portal look** is deliberate. Green `#0B5D2E`, beige paper, boxed tables, a formal
  footer. A registrar should recognise it as an institutional document, not a startup toy. It also means
  the app feels like the school's system, which is what makes staff trust it.
- **The radar and the progress bar** on the scan screen are honest theatre: they show that a search is
  happening, they are driven by the real scan, and they never claim success before the register answers.
- **The boot card** paints the app's real shell immediately, then replaces the placeholders with data. On
  a slow phone this is the difference between "loading" and "broken".
- **The unit cards** on the lecturer dashboard are state you can read at a glance: live, closed, how many
  names, how long left.
- **The percentage bars** on the student's attendance are computed from real records, not decoration.

The graphics are cheap on purpose: a WebView on a KES 8,000 Android phone can draw all of it smoothly,
and nothing has to be downloaded before the app is useful.

---

## 9. The five gates — why a good app still cannot be cheated

Every check-in passes through one function, on one phone, in this order. Nothing is written until all
five pass; a refusal leaves the register exactly as it was.

| Gate | The question | The refusal a cheater meets |
|---|---|---|
| **1. Is a window open?** | Does this four-digit code belong to a live session? | "That code is not open right now." |
| **2. Are you on the final register?** | Is this student id on the unit's finalised roster? | "You are not on the final register for DBM411. This attempt was recorded and will be shown to the lecturer." |
| **3. Are you in the room?** | Is the student's fix inside the fence? | "You are 84 m from the class location…" |
| **4. Have you already posted?** | Same session? Then same calendar day, same unit? | "Attendance was already posted for you at 09:37." / "A class is recorded once." |
| **5. Is this your phone?** | Is this device already bound to somebody else? | "This device is permanently bound to another student." |

Two details that matter:

- **Late is not absent.** A post more than **5 minutes** after the window opened is recorded as `late`,
  not refused. The register shows it, and the lecturer decides what late means.
- **Closing and reopening a window for the same unit on the same day is not a second chance.** The
  one-per-day rule is separate from the one-per-session rule, precisely because that was the obvious
  loophole.

And the roster itself can be **finalised**. Once a lecturer finalises a unit's roster for the semester,
the rules refuse to add, remove or change students. That is what makes the register defensible later.

---

## 10. The cloud shelf — how "the server" connects

This is the part people assume is the hard part. It is deliberately the smallest part.

### 10.1 What it stores

Three tables, all in a Cloudflare D1 database (SQLite under the hood):

| Table | Holds |
|---|---|
| `classes` | One row per class code: the unit, the lecturer, and the published roster. |
| `sessions` | One row per class meeting a phone has finished. |
| `records` | One row per check-in, keyed by its own id. |

### 10.2 How a phone talks to it

```
POST /api/v1/classes                    publish a unit + roster (needs the class key)
GET  /api/v1/classes?code=DBM411        read a published unit by code
GET  /api/v1/classes/DBM411/reports     read the finished sessions and records
GET  /api/health                        "is the shelf awake?"
```

The class code is public — a join code is not a secret, and the payload holds no credentials. **Writing
needs the key** that the lecturer's phone generated for that class. The key itself is never stored, only
its SHA-256 fingerprint, so a leaked database does not hand anybody write access.

### 10.3 Why it can never break a class

- The phone writes to its own file **first**, always. The cloud is a copy, never the source of truth.
- Every write is idempotent: same ids in, no duplicates out. Re-pushing a whole semester is safe.
- Losing the internet mid-push costs nothing. The next push finishes the job.
- If the cloud is unreachable, the student app simply does not show "published units" — and every class
  still runs, because the class register never asks the cloud anything.

Verified behaviour from the live shelf: a wrong key returns `403`, a missing key returns `401`, and a
repeated push inserted **0** rows. The shelf currently holds 3 units, 85 students and 43 sessions from
testing.

### 10.4 The laptop option

For a demo where a projector is involved, `server.js` serves the same routes on a laptop, and the same
web pages run in a normal browser. It is the identical contract, which is why the phone host could be
built by moving the rules rather than rewriting them.

---

## 11. What was actually achieved

Not claims — artefacts you can open.

| Achieved | Evidence |
|---|---|
| Two installable Android apps | `CLASSPREF3CT-Lecturer-debug.apk`, `CLASSPREF3CT-Student-debug.apk`, ~7.7 MB each, debug-signed |
| A register that runs on a phone | `ClassServer` on port 4173, `Register` persisting to a JSON file, revision counter, SSE live feed |
| Rules in one place, unit-tested | `Rules.java` — 8 tests (enrolment, duplicate, day lock, fence, late grace, device lock…) |
| Two transports sharing one contract | `ClassServer.serveOne()` serves both the TCP socket and the RFCOMM socket — 6 transport tests |
| Real discovery, two mechanisms | NSD `_attendease._tcp.` plus a UDP beacon on 4174, with a loopback fast path for a single-phone demo |
| Bluetooth that a new student can actually find | Android 12+ `BLUETOOTH_ADVERTISE` granted and requested; five-minute discoverable window; SDP-checked dialling; pairing once, then remembered |
| Excel that lands somewhere real | CSV written through Android's MediaStore into `Downloads/CLASSPREF3CT` |
| An optional cloud shelf | Cloudflare Worker + D1, key-hashed writes, idempotent inserts, live-verified status codes |
| A documented, reproducible build | `tools/build-mobile.js` → `cap sync` → `gradlew assembleDebug`, plus a test command and a dex-verification step |
| A pitch pack that matches the code | Seven documents in `dist/`, an issues log with how each fix was verified, and seven open issues on GitHub |

**What is not achieved yet, said plainly:** the two apps have not been walked through on two physical
handsets in this workspace. Pairing prompts, RFCOMM throughput on real hardware, and a WebView's LAN
fetch are verified by construction and by JVM tests, not by holding two phones. That is the next
thirty minutes of work, and it is the one claim this document will not fake.

---

## 12. What this is meant to be on a real campus

A pilot at UEAB, one department, one semester, in this order:

1. **Week 1 — one unit, one lecturer, one class.** Install both APKs, run a real lecture, export the
   CSV, compare it against the paper sheet. Nothing else changes.
2. **Week 2–4 — one department.** Import the real rosters (registration numbers and names), finalise
   them, and let lecturers run every class. The registrar gets a weekly CSV per unit.
3. **Semester — the report pack.** Attendance percentages per student per unit, per lecturer, per
   department. This is the artefact that makes exam-eligibility conversations short.
4. **Then, and only then, integration.** Push the same records into whatever the school already uses
   (a student portal, an ERP, an LMS) through a small adapter. The export format is already the
   integration point; the cloud shelf is the second.

What it is **not** trying to be: an LMS, a gradebook, a timetable system, a biometric turnstile, or a
replacement for the registrar's database of record. It is the attendance register — the thing that
currently exists as paper and argument — done properly.

---

## 13. What it saves and earns the school — every angle

All figures below are **illustrative arithmetic with stated assumptions**, not a quote. The point is the
shape of the maths, which any bursar can redo with the school's own numbers.

### 13.1 Assumptions used

- 3,000 students, average class stream of 50 → about **60 streams**.
- Each stream meets twice a week for 14 weeks → **28 meetings** per stream.
- Total class meetings per semester ≈ **1,680**.
- A paper roll call costs **4 minutes** of teaching time.
- A ream of paper ≈ KES 500; a roll-call sheet holds ~50 names.

### 13.2 The direct savings

| Angle | The arithmetic | What it means |
|---|---|---|
| **Teaching time returned** | 1,680 meetings × 4 min ≈ **112 hours** per semester | Nearly three working weeks of lecturing that currently goes to reading names |
| **Paper and printing** | ~1,680 sheets ≈ 34 reams ≈ **KES 17,000** per semester, plus toner and storage | Small money, but it is money spent to create a document that is then re-typed |
| **Re-typing into spreadsheets** | 1,680 sheets × ~2 min of data entry ≈ **56 hours** of clerical time | Usually unpaid overtime, and where transcription errors are born |
| **Missing-sheet reconstruction** | Every lost sheet is a re-interview of the class | The register lives on a phone that backs up to a shelf; a lost sheet is a re-sync |
| **Exam-eligibility disputes** | Each dispute is a meeting, a search and a decision | The percentage and the per-class detail already exist, with a distance and a timestamp |

At a modest internal rate of KES 1,200 per teaching hour, the 112 recovered hours alone are worth
**≈ KES 134,000 per semester** — for one campus, before any dispute is avoided.

### 13.3 The angles that do not look like money but are

- **Fee leakage.** When attendance cannot be proven, some schools cannot defend "you did not attend,
  therefore…" — and some students learn exactly which classes are never checked. Verifiable attendance
  makes the register a financial document, not a courtesy.
- **Accreditation and audit.** External auditors ask for evidence of engagement, not assurances. A CSV
  per unit, per semester, with timestamps, is evidence.
- **Lecturer accountability, both ways.** A lecturer cannot be accused of not holding a class that the
  register proves happened — and cannot claim one that did not.
- **Timetable truth.** Which rooms are actually full at 8 a.m. is a scheduling decision nobody currently
  has data for.
- **Zero hardware.** No turnstiles, no fingerprint readers, no cards, no dedicated server, no campus
  network upgrade. Students and lecturers already own the devices.
- **Deployment speed.** A pilot is two APKs and a roster import — days, not a procurement cycle.

### 13.4 What it could earn, if sold beyond one campus

Three honest models, in ascending ambition:

1. **Per-student licence** — e.g. KES 50–150 per student per semester. At 3,000 students that is
   KES 150,000–450,000 per semester **per institution**, against near-zero marginal cost per extra
   student (the phone does the work, the shelf costs cents).
2. **Department or faculty licence** — a flat fee per department, which is easier to budget and easier to
   approve than a per-head charge.
3. **Institution licence plus services** — roster import, report formats for the registrar, integration
   with the existing portal, training. Services are where the durable revenue is, because every school's
   registrar wants their own report shape.

Compare the alternative the market usually buys: a biometric or card attendance system is commonly
**KES 400,000 to 1,500,000 per lab**, plus installation, plus maintenance, plus cards, plus the queue at
the door. CLASSPREF3CT's hardware cost is **zero** and its marginal cost per class is a few kilobytes of
Bluetooth.

### 13.5 The costs it creates, stated honestly

- Support load: someone must answer "it says 84 metres" at 8 a.m.
- A lecturer's phone becomes a piece of campus infrastructure — it must be charged and present.
- Training: ten minutes for a lecturer, two for a student, but it has to actually happen.
- Data protection: attendance is personal data. Under Kenya's Data Protection Act (2019) the school
  needs a lawful basis, a retention rule, and a way to answer "show me my data". The design helps (the
  phone holds the record, the class key gates writes), but policy is the school's job, not the app's.
- A registrar will still want the paper signature for some processes for a while. Plan for a transition
  year rather than a switch.

---

## 14. Why invest

1. **The failure mode of every competitor is the network. This one does not need it.** That is not a
   feature list; it is the reason the project exists.
2. **The cost of trying is two APKs and one lecture.** No procurement, no installation, no hardware. If
   it fails, the school has lost an afternoon.
3. **The output is a document the school already wants** — a per-unit attendance sheet, in Excel, with
   timestamps and distances, ready for the registrar.
4. **It makes an existing argument cheaper.** Exam eligibility, absenteeism, fee disputes: all of them
   currently cost staff hours that this reduces to a lookup.
5. **It scales without scaling cost.** The register runs on a phone the school already owns; the cloud
   shelf costs pennies per class. A second campus costs a licence, not a data centre.
6. **It is honest about its limits** — distance-based presence, not biometric proof; GPS drift indoors;
   no live dashboard over Bluetooth. Investors who hear the limits up front are the ones who stay.

---

## 15. Bluetooth in the daily process, step by step

**The lecturer, first class of the semester**

1. Open CLASSPREF3CT → the unit card → **START**. The phone captures its location and issues a four-digit
   code.
2. Tap **Make this phone findable** → accept *Nearby devices*. A five-minute window opens.
3. Watch names arrive on the dashboard. Read the code out loud, or let students scan.

**The student, first class**

1. Open CLASSPREF3CT → **Take Attendance**.
2. Tap **SCAN BLUETOOTH**. The phone finds the lecturer's phone and Android asks to pair. Tap **Pair**.
3. Type the four digits → **POST ATTENDANCE** → a receipt with the distance and "present" or "late".

**Every class after that**

1. The lecturer presses START. No pairing, no discoverable window needed for students who are already
   bonded — their phones reconnect to the remembered register.
2. The student taps **SCAN BLUETOOTH** (or **SCAN WI-FI** if the room's network is friendly). Either lane
   reaches the same register with the same rules.

**Where Bluetooth will go next**

- **BLE advertising** so the lecturer's phone broadcasts a class beacon that students can detect without
  pairing at all, for pure proximity evidence.
- **Batched posting** — one connection carrying several students' posts, which removes the per-student
  pairing cost in a large class.
- **Automatic lane choice** — the app already remembers which lane answered last time; the next step is
  to prefer it and fall back silently.

---

## 16. What is still unproven

Say these out loud before a judge finds them:

1. **Two physical phones.** Pairing prompts, RFCOMM throughput, and a WebView fetching from a LAN address
   are verified by construction and JVM tests, not by a device walk-through. This is the next task.
2. **GPS indoors.** A 30 m fence is generous for a room, tight for a basement. The radius is adjustable
   for exactly this reason.
3. **A full class over Bluetooth.** Serial throughput is estimated at 1–3 seconds per post; a 60-student
   class on Bluetooth only is a two-to-three-minute window.
4. **Cloud publishing.** The shelf is live and verified by HTTP status codes, but the site's hosting was
   paused once by a daily write quota, so the deployed copy needs a fresh publish before a demo.
5. **Institutional data policy.** The app is ready; the school's consent and retention policy is not
   something an app can supply.

---

## 17. Plain-English glossary

| Word | What it actually means here |
|---|---|
| **APK** | The installable file for an Android app. |
| **IP address** | A phone's number on a network, e.g. `192.168.1.42`. |
| **Port** | A door number on that phone. The register listens at `4173`. |
| **mDNS / DNS-SD** | A way for devices on the same network to announce what they are, without a server. |
| **UDP broadcast** | Shouting a small message to every device in the room. |
| **RFCOMM** | The classic Bluetooth "serial cable in the air". |
| **SDP** | The name tag a Bluetooth service publishes so others can recognise it. |

| **Pairing / bonding** | The one-time security handshake that makes two phones trust each other. |
| **Discoverable** | The window in which an unpaired phone is allowed to see this phone. |
| **JSON** | Labelled plain text used to send data between the apps. |
| **SSE** | A connection that stays open so the phone can push updates. |
| **Haversine** | The formula for distance between two points on a sphere, in metres. |
| **Fence / radius** | The circle around the class location a student must be inside. |
| **Idempotent** | Doing the same write twice has the same effect as doing it once. |
| **SHA-256** | A one-way fingerprint of a value. You cannot turn it back into the key. |
| **D1** | Cloudflare's SQLite database used by the optional shelf. |
| **MediaStore** | Android's own file store, which is how the CSV lands in Downloads. |
| **WebView** | The browser component inside the app that draws the screens. |
| **Roster** | The final list of students registered for a unit. |
| **Identity lock** | The permanent binding between one student and one phone. |

---

`CLASSPREF3CT v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE`
