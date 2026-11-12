# CLASSPREF3CT — Business Model

The commercial case behind what is in this repository: who pays, why, how much, what it costs to
serve, and what has to be true before any of it is real.

`CLASSPREF3CT v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE`

---

## 1. The problem, in money

Kenyan universities still take attendance by **calling out names** — five to fifteen minutes of a
two-hour lecture — or by passing a **paper sheet** that gets signed for absent friends.

| What it costs | Where it shows up |
|---|---|
| ~20% of contact time in a 45-minute lecture | Baraton-sized timetable: an entire teaching week lost per semester per lecturer |
| Proxy attendance | a register the institution cannot defend in an audit |
| Discovery too late | a student at 45% found out in week 14, when nobody can save them |
| Manual reconciliation | lecturers re-keying sheets into Excel, registrars chasing signatures |
| No evidence | CUE/commission audits and HELB compliance asking for records nobody kept |

Attendance already carries financial and legal consequences — exam eligibility, loan compliance,
lecturer workload verification. Institutions currently take **weak data with expensive
consequences**. That gap, not the app, is the business.

---

## 2. The product

**A register that proves itself, opened in one tap, hosted on the lecturer's own phone.**

What a class looks like:

1. Lecturer opens the app, taps **START** on the unit card. The phone issues a four-digit code and
   becomes the class server for the next 5–60 minutes.
2. Students open the student app. It finds the lecturer's phone over the campus Wi-Fi, or over
   Bluetooth when the network isolates clients. No address is typed, no account is created.
3. A student posts: **correct code + on the final register + inside the GPS fence + a phone bound to
   their identity**. The record is final the instant it is accepted.
4. The lecturer watches names arrive, and presses **DOWNLOAD EXCEL** when the window closes.

### Why the hosting decision *is* the business model

The obvious build is a server per campus. That build has a permanent cost — a VPS, someone to keep
it patched, a firewall rule, a network that has to cooperate — and it fails exactly where the
product is needed most: a hall with no usable Wi-Fi.

CLASSPREF3CT puts the authority on the phone that runs the class:

| Consequence | Effect on the business |
|---|---|
| No server per campus | near-zero cost of goods; the demo is the production deployment |
| A class runs with no internet at all | sells into halls, annexes and rural campuses where SaaS assumes connectivity |
| Lecturer owns the register | the person with the audit risk is the person holding the data — the easiest sale in the institution |
| Cloud is a shelf, not the brain | the cloud bill scales with *sync*, not with *classes*; it can be switched off and nothing stops |
| Two APKs, no Play Store | deployable today to a whole faculty by WhatsApp and a QR code |

---

## 3. Who uses it, who pays

| Segment | Kenya | User | Buyer |
|---|---|---|---|
| Private universities (UEAB/Baraton, Daystar, Strathmore, Kabarak…) | ~30 | lecturers, students | **Registrar / DVC Academics** |
| Public universities and campuses | ~40 campuses | lecturers, students | ICT director + Dean of Students |
| TVETs and colleges | 1,000+ | trainers, trainees | Principal / Academic Registrar |
| Professional bodies, CPD, driving schools | long tail | trainers | Training manager |

**User ≠ buyer.** Lecturers and students use it daily; the **registrar** signs, because attendance
compliance is their exposure. Every sales conversation starts with "can you defend last semester's
register?" and never with a feature list.

---

## 4. Revenue model

**Primary — per-student licence, per semester**

| Tier | Price | Includes |
|---|---|---|
| Department pilot | KES 30,000 / semester | up to 1,000 students, one campus, email support, evaluation report |
| Institution | KES 45–60 per student / semester | unlimited units, lecturer app, admin reporting, Excel/CSV, priority support |
| Group / multi-campus | negotiated | SSO/ERP integration, branded reports, SLA, on-site training |

Reference: a 5,000-student institution at KES 50 × two semesters = **KES 500,000 per year**, roughly
the cost of one exam-malpractice appeal.

**Secondary**

- **Beacon kit** — KES 2,500–4,000 per lecture hall, installed and labelled (~30% margin). Optional:
  it hardens the fence, and it is the natural upsell after a pilot.
- **Integration fee** — KES 80,000–150,000 one-off for student-records/ERP sync.
- **Eligibility analytics** — the dean's-office dashboard: who is below 75%, who is one absence from
  losing exam access.
- **Training** — KES 20,000 per department cohort.

**Pricing logic:** price under the cost of the teaching time lost to roll-call, which is the one
number the registrar can compute without trusting us.

---

## 5. Unit economics (5,000-student institution, per year)

| Line | KES |
|---|---|
| Revenue (institution tier) | 500,000 |
| Cloud sync (Worker + D1, roster/report shelf) | 4,000 |
| Support (0.2 FTE) | 90,000 |
| Beacon hardware (40 halls, amortised over 3 years) | 40,000 |
| Sales and onboarding (amortised) | 60,000 |
| **Gross margin** | **≈ 306,000 (61%)** |

Marginal cost per extra institution is almost entirely support, because there is no per-campus
server to run: the same cloud shelf absorbs every tenant's sync, and the classes themselves cost
nothing to host. Margin improves with density on the same playbook.

---

## 6. Go-to-market

1. **Land the pilot at UEAB.** One department, one semester, free, with success criteria agreed in
   writing before the first class.
2. **Convert with evidence, not slides.** The pilot produces a report the registrar takes to Senate:
   minutes of contact time recovered, proxy attempts blocked, students flagged in week 6 instead of
   week 14.
3. **Department → faculty → campus.** Lecturers champion from inside; the student union promotes it
   because it protects honest students from being graded alongside proxies.
4. **Channel partners.** ICT integrators who already sell ERP and timetabling; TVET associations;
   county education offices.
5. **Hackathon and demo circuit.** Cheap credibility, warm introductions, and a room full of people
   who have personally lost ten minutes of a lecture to roll-call.

**The adoption wedge** is the lecturer's *Posted this session* panel: it answers "who is actually in
this room?" in one glance. That is the moment a lecturer becomes a champion, and it is the screen
the demo must land on.

---

## 7. Pilot KPIs (what gets measured, and what "pass" means)

| Metric | Target |
|---|---|
| Scheduled classes with a window opened | ≥ 90% |
| Register present per session | ≥ 80% |
| Median time from code shown to posted | < 60 s |
| Legitimate posts that fail | < 2% |
| Proxy / unregistered attempts blocked and logged | 100% |
| Lecturer time saved per class | ≥ 5 minutes vs roll-call |
| Support tickets per 1,000 students | < 10 per semester |

---

## 8. Risks, and what we actually do about them

| Risk | Mitigation | Honest limit |
|---|---|---|
| GPS spoofing (rooted phone, mock locations) | fence + device binding + anomaly log the lecturer sees + optional beacon requirement | raises the cost of proxy attendance, does not defeat a determined developer |
| Campus Wi-Fi isolates clients | Bluetooth RFCOMM lane carrying the same routes; the register answers either way | Bluetooth needs a one-time pairing per student |
| Lecturer's phone dies mid-class | records are on that phone's private storage and pushed to the cloud shelf when a network appears; a second phone can host the next class | the class in progress is over; nothing is invented |
| Data protection (Kenya DPA 2019) | location kept as distance from the room at post time, not a movement trail; per-student export and deletion; institutional processing agreement | needs a signed DPA per institution |
| "This is surveillance" | no background tracking; the lecturer already owns the register; the student sees the same data the lecturer does | needs to be said out loud in every pilot briefing |
| Free alternatives (Google Forms, QR, paper) | they record a click, not a presence, and give the registrar nothing auditable | they are free, so the pitch must be audit risk, not convenience |
| Single-phone authority | one writer per class, revision-counted, idempotent sync | two phones cannot co-host one class |

---

## 9. Roadmap

| Phase | Scope |
|---|---|
| **Now (this build)** | phone-hosted register, five gates, Wi-Fi + Bluetooth transport, live lecturer feed, Excel export, cloud roster/report shelf |
| **Pilot (one semester)** | institutional SSO, offline queue for the student app, beacon kit, registrar report pack, DPA template |
| **Scale (year 1)** | multi-campus tenancy, Postgres behind the same API, ERP/timetable import, lecturer workload exports |
| **Platform (year 2)** | public API, CPD/training-provider edition, exam-eligibility automation wired to the registrar's rules |

---

## 10. The ask

- **KES 250,000 pilot funding** — 40 beacons, one semester of support, and an independent evaluation
  report for Senate.
- **People** — one Android engineer for offline sync, one designer for the registrar's reports.
- **Access** — introductions to two registrars and one TVET principal for discovery interviews.

The money does not buy code. The code is in this repository and it runs today. The money buys
**one real semester of evidence**, which is the only thing that converts a demo into a contract.
