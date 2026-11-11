# AttendEase — The 5-Minute Pitch

A word-for-word script that fits **5:00**, with the demo beats that win it and the answers judges
actually ask for. Times are cumulative; if you are running late, cut §4's second refusal, never the
lecturer's live panel.

`AttendEase v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE`

---

## Before you walk up (5 checks)

- [ ] Lecturer app open on the phone, signed in, **START** pressed once and **STOP** pressed, so you
      know the register starts on the first try. Leave the app in recents.
- [ ] Student app open on the **same phone or a second one**, already pointed at the lecturer's phone
      (or at `127.0.0.1:4173` if you are demonstrating on one handset), signed in as **John Kimutai**.
- [ ] Demo data clean: **Admin console → University → Reset demo data**.
- [ ] Excel download tested once into a visible folder.
- [ ] Screenshots of every screen open in a tab, in case a radio refuses to cooperate.

**The one-line thesis, memorise it:** *"Attendance you can prove — and the proof lives on the
lecturer's phone, so it works in a hall with no internet."*

---

## 0:00 – 0:40 · The problem (no slides yet, just talk)

> "Every lecturer in this room loses between five and fifteen minutes of every lecture calling out
> names. And the sheet that gets passed around instead can be signed by the friend at the hostel.
>
> So the institution ends up with a register it cannot defend: not in an audit, not in a malpractice
> appeal, not when it has to tell a student in week fourteen that they will not sit the exam.
>
> Attendance already decides exam eligibility and loan compliance. The data behind it is worth
> nothing."

**Slide (if used): one number — 20% of contact time, or one proxy signature.**

## 0:40 – 1:20 · The idea, and the decision that makes it different

> "AttendEase is a register that proves itself. Four things have to agree before a record exists:
> the lecturer has a window open, the student has the four-digit code, the student is on the final
> semester register, and their phone is inside the GPS fence of that room. A posted record is final.
>
> But here is the decision that matters more than any of those: **there is no server.** The
> lecturer's phone *is* the class server. It hosts the register, it enforces the rules, and students
> reach it over the campus Wi-Fi — or over Bluetooth, when the campus Wi-Fi is the reason nothing
> works."

**Slide: the one-page architecture from `dist/README.md`.**

## 1:20 – 2:40 · Live demo (the whole pitch lives or dies here)

**1:20 — Lecturer dashboard.**
> "Dr. Mwangi's three units: room, time, eighty-five students, and Present Today — zero, because no
> class is open."

**1:30 — Tap START.**
> "One tap. The phone opens a window for ten minutes and issues a code: 4-8-2-1. That is the entire
> job of the lecturer."

*(Point at the phone's own status line: the register is running on port 4173, discovery is
advertising, Bluetooth door is open.)*

**1:45 — Student app.**
> "The student opens the app and does not type an address. The phone finds the lecturer's phone on
> the Wi-Fi — and if the network won't let them talk, the same request goes down a Bluetooth link.
> They land on Step 2: the unit, the room, the lecturer, and how long is left."

**2:00 — Type 4821, POST.**
> "Code, register, fence. Zero metres from the class. Posted — and final."

**2:10 — Back to the lecturer, no refresh.**
> "Posted this session: one of eighty-five. Name, registration number, time, NEW."

*(Pause. This is the moment judges remember.)*

**2:25 — Break it on purpose.**
> "Same phone, same code, again: *'You already posted attendance for DBM411 today at 09:37. A class
> is recorded once.'* Not a grey area — refused by the register, with the original time quoted.
> And a student who is not on the register is refused **and** logged so the lecturer can see the
> attempt."

**2:40 — STOP, then DOWNLOAD EXCEL.**
> "STOP compiles the register: present, late, absent, distance from the room. Excel, one tap, and
> that is the document the registrar can defend."

## 2:40 – 3:40 · It is engineered, not mocked

> "Three things I want to point at, because they are the parts that are hard.
>
> **One:** the rules live in one place — on the phone — so two students and the lecturer cannot
> disagree. Same code, same contract, in `Rules.java`.
>
> **Two:** a whole class posts in the same few seconds. The register coalesces its live updates and
> keeps one revision counter; the desktop server of the same product took 85 simultaneous check-ins
> in 252 milliseconds, zero failures, and that load test is in the repo.
>
> **Three:** failure is honest. Location failure is no longer one message: no permission, no fix, and
> an insecure origin each say what they are. Bluetooth says *'beacon not seen'* rather than pretending."

**Slide: evidence table from `dist/AttendEase-Build-API-QA.md`.**

## 3:40 – 4:30 · Business model

> "We charge institutions per student per semester — forty-five to sixty shillings. A five-thousand
> student university is about half a million shillings a year, which is roughly one malpractice
> appeal.
>
> The cost side is the point: no server per campus, so gross margin is about sixty percent and the
> cloud bill is four thousand shillings a year, because the cloud is only a shelf for rosters and
> reports. The lecturer's phone does the work.
>
> The buyer is the registrar, because the audit risk is theirs. The wedge is the lecturer, because
> that live panel is the first time anyone has told them who is actually in the room."

## 4:30 – 5:00 · The ask, and the honest edge

> "We are asking for two hundred and fifty thousand shillings for one semester at Baraton: forty
> beacons, evaluation support, and a report for Senate.
>
> What we are not going to claim: this has not been run for a full semester, and we have not walked
> it through on two physical phones in front of you — the APKs are built, unit-tested and packaged
> here, and a hardware walk-through is the first thing the pilot pays for.
>
> The code works today. What we need is one real semester of evidence."

---

## If the demo breaks (say it, don't fix it on stage)

| What happened | What to say, then do |
|---|---|
| Student app cannot find the phone | "This is the exact failure the Bluetooth lane exists for — the campus AP is isolating us." Switch to the two-tab browser demo already open on the laptop. |
| Location refused | "Location is off, so the app refuses rather than guessing — that is the design." Show the specific message, then post from the browser tab with a saved fix. |
| Nothing posts | Show the refusal. A refusal with a precise reason demos better than a success. |
| Wi-Fi dies completely | Switch to screenshots: "Every screen here was captured from the running build." |

Never debug live for more than twenty seconds. Judges score the story, not your typing speed.

---

## Rapid Q&A — the twelve they actually ask

**"What stops a student sending the code to a friend?"**
The friend is not on the final register, their phone is not inside the fence, and their device is
bound to their own identity — and every blocked attempt is logged for the lecturer.

**"Can't GPS be spoofed?"**
Yes, on a rooted phone with mock locations. That is why the fence is one layer, not the defence: a
beacon requirement per hall and anomaly reporting raise the cost from "sign a sheet" to "root a
phone and beat two radios".

**"Why no server? That can't scale."**
The class doesn't need to scale — one phone serves one class of eighty-five, and it does that
without internet. Scale lives in the optional cloud shelf, which only stores rosters and finished
reports. No server per campus is why the margin works.

**"What if the lecturer's phone dies?"**
The class in progress is lost, and the app says so — nothing is invented. Finished sessions already
pushed to the shelf survive, and the next class can run on any lecturer phone.

**"How is this different from a QR code or Google Forms?"**
Those prove someone had a link. This proves a registered student's bound phone was inside the room
during an open window, and keeps an audit trail of attempts. The registrar can defend it.

**"Is it surveillance?"**
Location is captured once, at the moment of posting, and stored as distance from the room. There is
no background tracking and no movement history.

**"Does it work offline?"**
The class runs with no internet at all — the lecturer's phone is the server. The cloud is optional;
when a network appears the phone publishes the roster and pushes finished reports.

**"How do students get the app?"**
An APK installed from a link or a QR code — no store, no account, two minutes. That is deliberate:
a pilot cannot wait for app-store review.

**"Why two apps?"**
Different jobs and different permissions. Students get three tabs; lecturers get units, live
monitoring and export. Separate packages also mean the lecturer's install can host and the
student's cannot.

**"What is genuinely hard here?"**
The transport and the honesty of failure: a class posting at once without queueing, and a phone
that reaches the register when the campus network isolates every client. Both are written up in
`docs/ISSUES-SOLVED.md`.

**"Who owns the data?"**
The institution. Per-student export and deletion, location reduced to distance, and a
data-processing agreement — the register belongs to the university, we host the sync.

**"What would you do with the money?"**
One semester at Baraton, forty beacons, an independent evaluation, and offline queuing so a
completely disconnected hall still records. The software already does the rest.
