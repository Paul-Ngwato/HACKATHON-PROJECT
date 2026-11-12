# CLASSPREF3CT — Architecture

How the system is put together, and why each decision was made that way.

---

## 1. Shape of the system

```
┌────────────────────┐        ┌────────────────────┐
│  Student APK       │        │  Lecturer APK      │
│  Capacitor 8       │        │  Capacitor 8       │
│  portal UI (ESM)   │        │  portal UI (ESM)   │
│  GPS + BLE scan    │        │  GPS + BLE scan    │
└─────────┬──────────┘        └─────────┬──────────┘
          │  REST + SSE over Wi-Fi       │
          └──────────────┬───────────────┘
                         ▼
              ┌──────────────────────┐
              │  Node http server    │  :4173
              │  static + /api/*     │
              └──────────┬───────────┘
                         ▼
              ┌──────────────────────┐
              │  node:sqlite (WAL)   │  data/attendsmart.db
              │  single writer       │
              └──────────────────────┘
                         ▲
              ┌──────────┴───────────┐
              │  BT-821C bridge      │  :4190  (optional hardware GPS)
              └──────────────────────┘
```

- **No frameworks, no bundler.** The browser loads plain ES modules; the server is `http` + `fs`.
  This keeps the APK small and the whole system readable in an afternoon.
- **The server is authoritative.** Every rule that used to live in the browser moved into
  `server/domain.cjs`, so two phones and the lecturer cannot disagree.
- **SQLite via `node:sqlite`** — zero install, synchronous API, one file to back up.

---

## 2. Data model

| Table | Purpose | Key rules |
|---|---|---|
| `students` | 340 seeded students | `reg_no` unique |
| `lecturers` | teaching staff | `l1`–`l4` seeded |
| `courses` | units on the timetable | `lecturer_id`, `day`, `start`, `end`, `room`, `window_minutes`, `roster_finalized_at` |
| `enrollments` | final register | `(course_id, student_id)` primary key |
| `halls` | rooms with a captured fix | `lat`, `lng`, `radius` |
| `sessions` | one attendance window | `code` (4 digits), `ble_name`, `ends_at`, `status` |
| `attendance` | posted records | **`UNIQUE (session_id, student_id)`**, `distance_m`, `method`, `device_id` |
| `identity_locks` | one device ↔ one student | `device_id` primary key |
| `security_events` | audit trail | unregistered attempts, identity misuse |
| `meta` | revision counter, seed metadata | `revision` drives live refresh |

`data/attendsmart.db` is disposable: delete it (or reset) and the seed regenerates.

---

## 3. The four gates (`checkIn` in `server/domain.cjs`)

```
BEGIN IMMEDIATE
  session = open window for this code            → else "code not open"
  course, student, venue valid                   → else "invalid session"
  student is enrolled in the course              → else log security_event, refuse
  no record for this session                     → else "already posted at HH:MM"
  no record for this course today                → else "a class is recorded once"
  device not bound to another student            → else log, refuse
  coordinates valid (not 0,0 / NaN)               → else "enable location"
  haversine(distance) <= venue.radius             → else "you are N m away"
  INSERT attendance, lock device, bump revision
COMMIT
```

Everything happens inside one transaction, so a duplicate arriving in the same millisecond hits the
unique index rather than a race.

**Late** is not a rejection: a post more than 5 minutes after START is stored with `status: 'late'`.

---

## 4. Live updates

- `GET /api/events` is a Server-Sent Events stream carrying `{ revision }` only.
- Any mutation bumps `meta.revision` and schedules a broadcast.
- Broadcasts are **coalesced over 150 ms**: 85 simultaneous posts produce one frame, not 85.
- Each client debounces the frame into **one** `GET /api/state` pull (250 ms).
- A check-in response deliberately **does not** include the whole snapshot; the page refreshes from
  the live event. This is what keeps a whole class posting under 300 ms.

Measured: 85 concurrent check-ins → 252 ms wall, p95 224 ms, 337 posts/s, zero failures
(`tools/loadtest.cjs`).

---

## 5. Location

`assets/js/location.js` returns one fix and distinguishes three failures that used to share a single
message:

| Case | Detection | What the student sees |
|---|---|---|
| Insecure origin | `window.isSecureContext === false` | use the APK or https |
| Permission denied | `error.code === 1` | how to enable location for CLASSPREF3CT |
| Indoors / no satellites | first attempt times out | retries once with network location, then asks for a window |

A watchdog wraps each attempt, because Chromium can leave a geolocation promise pending forever
while the permission dialog is unanswered.

---

## 6. Bluetooth

- Beacon name per session: `<COURSE>_<DAY>_CLASS`, e.g. `DBM411_MONDAY_CLASS`, published in state.
- `assets/js/ble.js` picks a path: native plugin (`@capacitor-community/bluetooth-le`) inside the
  APK, Web Bluetooth in Chrome, nothing elsewhere — and always resolves with a readable reason.
- A match marks the post `method: "ble"`; no match posts as `code`.
- **Bluetooth never gates attendance.** Code + GPS decide; BLE is corroboration the lecturer can see
  on the card.

---

## 7. Interface layer

- `assets/js/app.js` owns routing, the portal shell and live refresh; views are plain functions
  returning `{ html, mount }`.
- `assets/js/views/login.js` is the portal sign-in; `assets/css/portal.css` holds the whole
  government-portal skin.
- The admin console keeps the original layout — only student and lecturer use the portal chrome.

---

## 8. API reference

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | liveness + revision |
| GET | `/api/state` | — | full snapshot for the client |
| GET | `/api/events` | — | SSE revision stream |
| GET | `/api/sessions/lookup?code=&studentId=` | — | is this code open for me? |
| POST | `/api/sessions/start` | `courseId, actorId, durationMin, lat, lng, accuracy, radius` | open a window |
| POST | `/api/sessions/end` | `sessionId, actorId` | close a window |
| POST | `/api/sessions/rotate` | `sessionId, actorId` | new code, same window |
| POST | `/api/checkin` | `code, studentId, deviceId, lat, lng, accuracy, method` | post attendance |
| POST | `/api/courses/create` | `name, code, room, start, end, lecturerId` | new unit |
| POST | `/api/courses/import` | `courseId, entries[]` | paste a class list |
| POST | `/api/courses/roster` | `courseId, studentIds[]` | set the register |
| POST | `/api/courses/finalize` | `courseId, actorId` | lock the semester register |
| POST | `/api/courses/venue` | `courseId, lat, lng, radius` | capture the room |
| POST | `/api/admin/reset` | `actorId: "a1"` | rebuild the seed |

Errors are `{ ok: false, error, step? }` with a 4xx/5xx status and a message written for a student,
not a developer.

---

## 9. Security posture

**Done**

- Server-side rules; no trust in the client.
- Device-to-student binding, permanently recorded.
- One post per class per day, enforced in the same transaction as the insert.
- Unregistered attempts are refused *and* logged for the lecturer.
- Static file server blocks `data/`, `server/`, `.git`, `.toolchain`, dotfiles.
- No secrets in the repo; the APK talks to a LAN address the user types in.

**Not done — say so before a judge asks**

- No login: demo accounts are the authentication. Production needs SSO (institutional email or ERP
  integration) and per-request authorisation.
- No rate limiting or CSRF protection — the API is unauthenticated by design for the demo.
- GPS and BLE can be spoofed by a determined attacker; this raises the cost of proxy attendance, it
  does not defeat a rooted phone.
- The database is a single file with no replication.
