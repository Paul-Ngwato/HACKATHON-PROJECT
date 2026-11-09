# AttendEase — Presentation Pack

Slides, demo script, and the answers to the questions judges actually ask.

---

## 1. Slide outline (8 slides, 6 minutes)

**1 — Title**
AttendEase · Location-verified attendance · Baraton University (UEAB) · Hackathon 2026.
One line: *"Attendance you can prove."*

**2 — The problem (with a number)**
Roll-call eats 5–15 minutes of every lecture. One paper sheet, one pen — proxies sign for friends.
The student at 45% is discovered at exam time. Attendance already decides exam eligibility, yet the
data behind it is unverifiable.

**3 — The idea (four gates)**
Open window → correct code → on the final register → inside the GPS fence. One post, final, bound to
the student's device. Show the four-gate diagram from `docs/ARCHITECTURE.md`.

**4 — Live demo** (see §2 below — this is the slide that wins or loses it)

**5 — What the lecturer gets**
Live "Posted this session" list with NEW badges, Present Today count, one-click Excel register, and
analytics that flag the students who need a call before exams.

**6 — It is engineered, not mocked**
Server-side rules in one transaction · SSE live feed coalesced at 150 ms · 85 students posting at
once in 252 ms · GPS failure modes distinguished · native BLE scanning in both APKs · 340 seeded
students and a full semester of history.

**7 — Business model**
KES 45–60 per student per semester. 5,000 students ≈ KES 500,000/year. Pilot at Baraton first;
beacon bundles and ERP integration as upsell. (Full detail in `BUSINESS-MODEL.md`.)

**8 — Ask**
Pilot funding (KES 250,000), one Android engineer for offline sync, two registrar introductions.
Close with: *"The code works today. What we need is one real semester of evidence."*

---

## 2. The 3-minute demo script

**Before you start**

- Laptop running `node server.js`; two browser tabs open: lecturer (`l1`) and student (`s1`).
- Phones: one APK installed, pointed at the laptop, signed in as a second student.
- Reset the demo data so the numbers are clean.

**0:00 — Open on the lecturer dashboard**
"This is Dr. Peter Mwangi's three units. Room, time, students, and Present Today — 0 right now,
because no class is open."

**0:20 — Press START**
"One tap opens the window and issues a four-digit code. This is the only thing the lecturer does."

**0:40 — Student app, scan**
"The student scans and lands on Step 2: the unit, the room, the lecturer, and where the window
closes." *(Point at the Bluetooth line if a beacon is on air.)*

**1:00 — Type the code, POST**
"Code plus the final register plus the GPS fence. They're 0 metres from the class, so it posts."

**1:10 — Back to the lecturer, no refresh**
"Posted this session: 1 of 85. Name, registration number, time, NEW." *(Pause for effect — this is
the moment.)*

**1:30 — Prove it cannot be cheated**
- Type the code again on the same phone → *"already posted today, a class is recorded once."*
- Change the phone's simulated location or walk out of range → *"You are 120 m from the class."*
- Sign in as a student not on the register → refused **and** logged for the lecturer.
- Start a brand-new window for the same unit → still refused.

**2:20 — Close the window, download the register**
"STOP compiles it: present, late, absent, plus the blocked attempts. Excel in one tap."

**2:40 — Analytics and the honest close**
"My Attendance: 83.5% overall, DBM411 flagged. That is the student an advisor can save in week 6
instead of week 14. What we have not yet done is run it on real hardware for a full semester —
that's the pilot we're asking for."

---

## 3. Judge Q&A — prepared answers

**"What stops a student from sending the code to a friend?"**
Three things: the friend is not on the final register; the phone must be inside the 30 m fence; and
the device is permanently bound to one student. Each block is logged for the lecturer. A beacon can
also be required so only phones physically in the hall can post.

**"Can't GPS be spoofed?"**
Yes, by a rooted phone with mock locations. That is why the fence is one layer, not the whole
defence, and why BLE beacons matter. We raise the cost of proxy attendance from "sign a sheet" to
"root a phone and defeat two radios" — and every anomaly is visible.

**"Is this surveillance?"**
Location is captured once, at the moment of posting, and stored as distance from the room, not as a
movement history. There is no background tracking; the app cannot see where a student is between
classes.

**"Why not just QR codes or Google Forms?"**
Those prove someone had the link. The registrar needs to defend a register in an audit: who was in
the room, when, how far from the class, and whether the attempt was tampered with. That is the
product.

**"Does it work without internet?"**
It runs on the campus LAN with no internet at all — one laptop is the server. Offline queuing (post
now, sync at the door) is on the pilot roadmap.

**"What happens if the lecturer forgets to open a window?"**
No window, no posts — nothing is silently recorded. The dashboard shows the class as NOT STARTED,
and the lecturer can open it late; posts after 5 minutes are marked late rather than rejected.

**"Why two apps instead of one?"**
Different jobs and different permissions. Students get a three-tab portal (Take Attendance, My
Attendance, Reports); lecturers get unit management, live monitoring, and export. Separate packages
also mean separate installs on separate phones.

**"What is actually hard here?"**
The concurrency and the honesty of failure. A whole class posting at once had to be one broadcast
and one snapshot pull; and location failure had to stop pretending that "no fix" always means
"go to a window". Both are documented in `ISSUES-SOLVED.md`.

**"What would you do with funding?"**
One semester at Baraton with 40 beacons, an evaluation report for Senate, and offline sync so a
wifi-less hall still works. The software already does the rest.

---

## 4. What to show, what to avoid

**Show**

- The lecturer's live feed updating with no refresh.
- A refusal with a *specific* reason (distance, duplicate, not on register).
- The Excel download opening with real rows.
- The Bluetooth label changing state honestly (`beacon not seen` is credible, and credible is what
  wins technical judges).

**Avoid**

- Claiming the lecturer phone emits a beacon — it does not yet.
- Claiming the APKs were tested on hardware here — they were built and statically verified, not
  walked through on a phone.
- Reading the slides. The product is the pitch.

---

## 5. Logistics checklist

- [ ] `node server.js` running, laptop on charge, firewall allows 4173
- [ ] Demo data reset (clean Present Today counts)
- [ ] Lecturer tab signed in as `l1`, student tab as `s1`
- [ ] Phone APK pointed at the laptop address, signed in as `s2`
- [ ] Beacon on air (or rehearse the "beacon not seen" explanation)
- [ ] Excel/CSV download tested into a visible folder
- [ ] Backup screenshots of every screen in case the Wi-Fi dies
