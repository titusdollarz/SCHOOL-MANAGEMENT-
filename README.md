# School Management Platform (Multi-Tenant, Cloud-Ready)

One system that hosts **many schools**. Each school signs up with its own email, and every school's data is fully isolated. Works from **any phone or computer with internet**. Mobile-friendly. No npm install needed — pure Node.js.

## Design System: Navy / Gold

The UI uses a consistent navy/gold design system with inline SVG icons, no external dependencies, and a self-contained `styles.css`.

### Palette tokens (CSS variables)

| Token | Value | Usage |
|---|---|---|
| `--navy` | `#083D93` | Primary brand, links, primary buttons, active nav |
| `--navy-dark` | `#05285a` | Header, sidebar top, footer |
| `--navy-2` | `#1047b3` | Hover / active states |
| `--gold` | `#f5b301` | Accent, secondary buttons, highlights, stat cards |
| `--gold-2` | `#ffd23f` | Buttons text, borders, focus rings |
| `--slate` | `#2b3a4a` | Body text |
| `--muted` | `#6b7a8c` | Secondary labels, placeholders, footers |
| `--bg` | `#f5f7fa` | Page background |
| `--card` | `#ffffff` | Cards, app shell background |
| `--paper` | `#f1f5f9` | Separators, subtle accents |
| `--ok` | `#0f7b3e` | Success states |
| `--err` | `#c0392b` | Error states |
| `--cream` | `#fff8e1` | A11y / attention backgrounds |

Key component classes: `.pill`, `.rolebanner`, `.stat`, `.quick-action`, `.badge`, `.avatar`, `.sidefoot`, `.mainhead`, `.schoolpill`, `.rolepick`, `.role`, `.authsplit`, `.authright`, `.authfoot`, `.sidebar`, `.sidenav`, `.main`, `.searchbox`.

### Icons
Inline `<svg>` icons (feather-style, no emojis) defined in `ICONS` in `app.js` and reused. SVGs are self-contained so the app is offline-ready.

## Multi-tenant: how it works
- **System Admin** (platform level) — full control over all school accounts: create, suspend, activate, delete schools, and reset a school's head-teacher password. `system@school.com` / `system123`.
- **School registration** — a school creates its own account using its email (name, email, password + head-teacher name/password). The registrant becomes the Head Teacher of that school.
- **Head Teacher** (per school) — creates the accounts for their own school's users only: teachers, bursars, parents and learners. They never see another school's data.
- **Data isolation** — each school's records live in `data/schools/<id>.json`. A suspended school blocks all of its logins. Deleting a school removes its data.
- The original demo school ("Little Dreamers Junior School") is migrated automatically on first run, so nothing is lost.

## The 10 Features
1. **Automatic Report Generation** — one-click termly report cards (print-ready)
2. **Teachers Upload Marks Remotely** — teacher login, anywhere/anytime
3. **School Performance Monitoring** — real-time averages, top students, per-class/subject charts
4. **Improved Communication** — SMS centre (logged + ready for Africa's Talking / Twilio)
5. **Students Data Management** — all records in one secure place
6. **Fees & Payments Tracking** — balances instantly
7. **Attendance Management** — staff & students, daily
8. **Timetable & Class Management** — easy allocation
9. **Parent Portal Access** — parents view results/fees online
10. **Secure & Reliable** — token login, role access, JSON DB + one-command cloud backup, 24/7 ready

## Run it
```powershell
node server.js
```
Then open http://localhost:3000 on phone or computer.

## Demo logins
| Role | Email | Password |
|---|---|---|
| System Admin (all schools) | system@school.com | system123 |
| Admin (Little Dreamers) | admin@school.com | admin123 |
| Head Teacher (Little Dreamers) | ht@school.com | head123 |
| Teacher | teacher@school.com | teach123 |
| Parent | parent@school.com | parent123 |
| Bursar | bursar@school.com | bursar123 |

New schools: click **"Register your school with your email"** on the login screen.

## Deploy online (24/7 access)
- Render / Railway / VPS: upload this folder, set start command `node server.js`, open the URL on any phone.
- Data stored in `data/system.json` (school registry) and `data/schools/<id>.json` (one file per school). Backup with `node backup.js`.
- For real SMS: add your Africa's Talking / Twilio key in `sms.js` (currently logs to DB so you can demo without paying).

## Structure
- `server.js` — HTTP server + REST API (no dependencies)
- `db.js` — JSON database layer
- `sms.js` — SMS centre (mock log + provider hook)
- `backup.js` — one-command backup
- `public/` — mobile-friendly web app (parent/teacher/admin portals)
  - `index.html` — split-screen login + responsive sidebar + top-header app shell
  - `styles.css` — design system + components
  - `app.js` — frontend wiring
