# AttendEase — Business Model

The commercial case behind the demo: who pays, why, how much, and what has to be true.

---

## 1. The problem

Kenyan universities still take attendance by **calling out names** (5–15 minutes of a 2-hour lecture)
or passing a **paper sheet** that is signed for absent friends. What that costs:

- **Lost teaching time.** Baraton's 45-minute lectures lose ~20% of contact time to roll-call.
- **Proxy attendance.** One sheet, one pen — the friend at the hostel signs.
- **No early warning.** A student at 45% attendance is discovered at exam time, when it is too late
  for the advisor to act.
- **Manual reconciliation.** Lecturers re-enter sheets into Excel; registrars chase signatures;
  CUE/commission audits need evidence nobody has.

Attendance already has financial consequences — exam eligibility, HELB/loan compliance, lecturer
workload verification. Institutions currently take **weak data with expensive consequences**.

---

## 2. The product

**A verified register in 30 seconds per class.**

- Student posts from inside the room: code + final register + GPS fence (and a BLE beacon where
  hardware exists).
- Lecturer sees names arrive live and downloads the compiled register.
- Administration gets percentages, risk lists and an audit trail the moment the window closes.

**Why it is defensible**

| Moat | Detail |
|---|---|
| Rules are server-side | the four gates are enforced in one transaction; a modified client cannot bypass them |
| Low-cost deployment | one laptop or a $10 VPS per campus; no per-seat hardware |
| Works on the phones students already own | no new devices, no app store friction (APK + PWA) |
| Evidence-grade records | final register, locked records, audit events, per-session distance |
| Fits existing process | the lecturer still owns the register; the system only records who was there |

---

## 3. Customers and users

| Segment | Size (Kenya) | Buyer |
|---|---|---|
| Private universities | ~30 | Registrar / DVC Academics |
| Public universities | ~40 campuses | ICT director + Dean of Students |
| TVETs and colleges | ~1,000+ | Principal / Academic Registrar |
| Professional bodies, driving schools, CPD | large, long tail | Training manager |

**User vs buyer:** lecturers and students use it; the **registrar** pays, because attendance
compliance is their audit risk.

---

## 4. Revenue model

**Primary — per-student SaaS licence, per semester**

| Tier | Price | Included |
|---|---|---|
| Department pilot | KES 30,000 / semester | up to 1,000 students, 1 campus, email support |
| Institution | KES 45–60 per student / semester | unlimited units, admin console, analytics, CSV/Excel, priority support |
| Group / multi-campus | negotiated (volume) | SSO/ERP integration, custom reports, SLA, on-site training |

Reference maths for a 5,000-student institution: `5,000 × KES 50 × 2 semesters = KES 500,000/yr`.
Compare with one exam-malpractice appeal or one audit query.

**Secondary**

- **Beacon bundle:** KES 2,500–4,000 per lecture hall, installed and labelled (margin ~30%).
- **Integration fee:** one-off KES 80,000–150,000 for ERP/student-records sync.
- **Analytics add-on:** retention/eligibility dashboards for the dean's office.
- **Training and onboarding:** KES 20,000 per department cohort.

**Pricing logic:** undercut the cost of one lecturer-hour wasted per class per week, which is the
number the registrar can actually calculate.

---

## 5. Unit economics (per 5,000-student institution)

| Line | Amount / year (KES) |
|---|---|
| Revenue (institution tier) | 500,000 |
| Hosting (VPS + backup) | 30,000 |
| Support (0.2 FTE) | 90,000 |
| Beacon hardware (40 halls, amortised 3 yrs) | 40,000 |
| Sales/onboarding (amortised) | 60,000 |
| **Gross margin** | **~280,000 (56%)** |

Marginal cost per additional institution is mostly support, so margin improves with density on the
same server and the same playbook.

---

## 6. Go-to-market

1. **Land the pilot at Baraton (UEAB).** One department, one semester, free. Success criteria agreed
   up front: ≥90% of sessions posted, ≥80% of students posting per session, median post time < 60 s.
2. **Convert with evidence.** The pilot produces a report the registrar can take to Senate: contact
   hours recovered, proxy attempts blocked, students flagged early.
3. **Department-to-campus expansion.** Lecturer champions inside each faculty; the student union
   promotes it because it protects honest students.
4. **Channel partners.** ICT integrators who already sell ERP/timetabling to universities; TVET
   associations; county education offices.
5. **Hackathon and demo circuit.** Baraton/UEAB, university tech weeks, innovation challenges —
   cheap credibility and warm introductions to registrars.

**Adoption wedge:** the lecturer's "Posted this session" screen. It answers "who is actually here?"
in one glance, which is the moment a lecturer becomes a champion.

---

## 7. KPIs

| Metric | Target by end of pilot |
|---|---|
| Sessions with a live window opened | ≥ 90% of scheduled classes |
| Students posting per session | ≥ 80% of the register |
| Median time from code shown to post | < 60 seconds |
| Post failures for legitimate students | < 2% |
| Proxy/unregistered attempts blocked and logged | 100% |
| Lecturer time saved per class | ≥ 5 minutes vs roll-call |
| Support tickets per 1,000 students | < 10 per semester |

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| GPS spoofing / rooted phones | BLE beacon requirement per hall, device binding, anomaly reports to the lecturer; not solvable in software alone — priced as "raises the cost" |
| Poor campus Wi-Fi | the APK works on the LAN; a future release can queue posts offline and sync at the door |
| Data protection (Kenya DPA 2019) | location stored as distance + session venue, not a movement trail; per-student data export and deletion on request; institutional data-processing agreement |
| Lecturers see it as surveillance | the lecturer owns the register and the window; no always-on tracking, location captured only at post time |
| Free competitors (Google Forms, QR) | they cannot prove presence, cannot lock records, and give the registrar nothing auditable |
| Single-file database | department-scale by design; Postgres migration path documented before multi-campus |

---

## 9. Roadmap

| Phase | Scope |
|---|---|
| **Now (hackathon build)** | verified posting, live lecturer feed, analytics, two APKs, BT-821C support |
| **Pilot (1 semester)** | SSO with institutional email, offline queue, beacon kit, registrar reports |
| **Scale (year 1)** | multi-campus tenancy, Postgres, ERP/timetable sync, lecturer workload exports |
| **Platform (year 2)** | API for third parties, CPD/training-provider edition, exam-eligibility automation |

---

## 10. The ask (for a hackathon or incubator panel)

- **Pilot funding:** KES 250,000 — 40 beacons, one semester of support, evaluation report.
- **Technical:** one Android engineer for offline sync; one designer for the registrar reports.
- **Access:** introductions to two registrars and one TVET principal for discovery interviews.

What the money buys is not code — the code is here — it buys **evidence from a real semester**.
