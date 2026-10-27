# Muster

[![Release](https://img.shields.io/github/v/release/SolidGeeks/muster)](https://github.com/SolidGeeks/muster/releases) [![Licence AGPL-3.0](https://raw.githubusercontent.com/SolidGeeks/.github/main/assets/badges/license-agpl.svg)](LICENSE) [![Signed releases](https://raw.githubusercontent.com/SolidGeeks/.github/main/assets/badges/signed-releases.svg)](#verify-the-image) [![Tests](https://github.com/SolidGeeks/muster/actions/workflows/ci.yml/badge.svg)](https://github.com/SolidGeeks/muster/actions/workflows/ci.yml)

Incident response playbooks for security teams: draw them as diagrams, version them, run them step by step during an incident or an exercise, and produce the incident report as a PDF.

## Try it in two minutes

**With Docker** (nothing else to install):

```bash
docker compose pull && docker compose up   # prebuilt, signed image from GitHub
# or build it here:
docker compose up --build
```

**With Node.js 22.13 or later:**

```bash
npm install
npm run demo
```

Then open <http://localhost:8080> and click one of the demo accounts on the sign-in page.

| Account | Password | Can |
|---|---|---|
| `admin` | `muster-admin` | everything, plus users and the audit log |
| `editor` | `muster-editor` | edit and publish playbooks, edit report templates |
| `analyst` | `muster-analyst` | declare incidents, run them, write reports |
| `viewer` | `muster-viewer` | read everything |

Demo mode also loads a closed incident with its report (IR-2026-041) and a tabletop exercise in progress, so every screen has content. Demo data is disposable: when a new version of Muster changes it, a demo-mode server replaces the old demo database on start (a real install, `DEMO_MODE=false`, is never touched). To start the demo from scratch at any time: `docker compose down -v`, or delete the `data-demo` folder.

### A short tour

1. **Playbooks** — ten ready-made playbooks. Open *Ransomware*: it has three published versions and an unpublished change.
2. In the editor, select a step and press **A** to add an action after it, **D** for a decision. Drag the orange handle under a step onto another step to connect them. Drafts save automatically.
3. **History** compares any two versions on the diagram and lists every change.
4. **Incidents → Declare an incident**, choose *Exercise* and a clock speed of ×60 to see SLAs tick in minutes per second. Tick tasks, answer decisions, close the incident.
5. **Create incident report**, edit the executive summary and your notes, then **Download PDF**.
6. **Reports → Templates**: upload your logo, change the colour, the report ID pattern (`IR-{YYYY}-{SEQ}`, `{PB}-REG-{YYMMDD}-{SEQ}`…), rename, hide or reorder sections. The preview updates as you type.

Open the app in two browsers with two accounts: incident progress, playbook changes and new reports appear live for everyone.

## Default playbooks

| Code | Playbook | Category |
|---|---|---|
| PB-001 | Ransomware | Malware |
| PB-002 | Phishing email | Phishing |
| PB-003 | Compromised account | Identity |
| PB-004 | CEO fraud and payment diversion | Fraud |
| PB-005 | Personal data breach (GDPR, 72-hour notification) | Data protection |
| PB-006 | Malware on an endpoint | Malware |
| PB-007 | DDoS attack | Availability |
| PB-008 | Lost or stolen device | Device |
| PB-009 | Insider threat | Insider |
| PB-010 | Exploited critical vulnerability | Vulnerability |

They follow the NIST incident response phases and are a starting point: review owners, SLAs and escalation contacts with your team before relying on them.

## Running it for real

Set `DEMO_MODE=false`. On first start Muster creates one `admin` account; set `ADMIN_PASSWORD` or read the generated password in the logs, then add your team in **Admin**.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `./data` (`/data` in Docker) | where the SQLite database lives — back this folder up |
| `DEMO_MODE` | `false` (`true` in `docker-compose.yml`) | demo accounts and sample data on first start |
| `ADMIN_PASSWORD` | random | password of the first admin when demo mode is off |
| `COOKIE_SECURE` | `false` | set to `true` when served over HTTPS |
| `TRUST_PROXY` | `false` | set to `true` behind a reverse proxy, to log real client IPs |

Put Muster behind a reverse proxy that terminates TLS (nginx, Caddy, Traefik). Server-sent events are used for live updates, so disable response buffering for `/api/events` if your proxy buffers.

Back up with a copy of `DATA_DIR` (stop the container first, or use `sqlite3 muster.db ".backup backup.db"`).

### Verify the image

Every published image is signed: an attestation proves it was built by this repository's `Release` workflow, from the code of the tag. Check it before deploying (needs the [GitHub CLI](https://cli.github.com/)):

```bash
gh attestation verify oci://ghcr.io/solidgeeks/muster:1.0.1 --owner SolidGeeks
```

It must print `Verification succeeded!`. If it fails, do not run the image, and report it (see [SECURITY.md](SECURITY.md)).

## Working with Strata

[Strata](https://github.com/SolidGeeks/strata) maps your information systems. Linked to Muster, a response runs on the map: the assets hit, who to call, the flows to cut, what depends on them.

1. In Muster, create an account for Strata with the **analyst** role (**Admin › Users**).
2. In Strata, set `MUSTER_URL` (how the Strata server reaches Muster), `MUSTER_USER` and `MUSTER_PASSWORD`.
3. Declare an incident and open **Link to Strata**: the Strata IS id, the assets hit (names or Strata ids) and, for the *Exploited critical vulnerability* playbook, the CVE.

Strata lists the incident in the incident sheet of that IS. Opened there, it marks the assets, and each step shows what it acts on: the step's **Strata targets** (`affected`, `flows:affected`, `vuln:{cve}`, `role:backup`, `type:dc`, `reach:…`, `consumers:…`, `business:…`, `contacts:…`), set in the editor. Answering a decision in either app moves the response in both; a decision can also mark assets in Strata (`effects`, shipped on PB-003, PB-006 and PB-010). What Strata does (assets marked, flows cut) goes to the timeline, the incident page shows the assets and their state, and the report gets an **Assets hit (Strata)** section (shown only for linked incidents; templates saved before it get it too, and can hide or rename it). A decision answered in Muster marks the assets in Strata as soon as someone allowed to change the incident has that IS open in Strata: nothing is lost in between. The shipped Ransomware, Compromised account, Malware and Exploited critical vulnerability playbooks already carry their targets; the YAML export includes them.

## How it is built

```
packages/core   Shared TypeScript: types, the 10 playbooks, validation, diffs, incident engine, report data
apps/api        Node.js HTTP API: SQLite storage, accounts and roles, live updates, PDF generation
apps/web        React interface
scripts/        Build (esbuild) and demo launcher
tests/          API tests (node:test) and a browser walk-through (Playwright)
```

- **No framework, few dependencies.** The API uses Node's built-in `http` and `node:sqlite`; the only runtime dependency is `pdf-lib`, bundled into `dist/server.js`. The Docker image needs no `node_modules`.
- **Storage** is isolated in `apps/api/src/db.ts` and `repo.ts`. Moving to PostgreSQL means rewriting those two files.
- **Security:** scrypt password hashing, HttpOnly SameSite session cookies, a required `X-Muster` header on every write (CSRF protection), login rate limiting, strict Content-Security-Policy, role checks on every endpoint, and an audit log.
- **Versioning:** each playbook has one shared draft (with conflict detection when two editors save at once) and immutable published versions. Every incident stores a frozen copy of the version it runs on.
- **PDF** reports are generated on the server from the same data and template as the on-screen preview.

### Development

```bash
npm run dev          # rebuilds on change; run `npm start` in another terminal
npm test             # API tests
npm run test:e2e     # browser walk-through, screenshots in tests/screens (run `npx playwright install chromium` once)
npm run typecheck
```

## Online version (Claude artifact)

`npm run build:online` produces `dist-online/muster.html`, a single page that runs the same interface without a server: data lives in the page's shared storage in Claude, people sign in with their Claude account, and the share menu sets roles (Editor = edits playbooks and templates, Contributor = runs incidents and writes reports, Viewer = reads). `npm run test:online` checks it in a browser against a stand-in for that runtime. The data layer for this version is `apps/web/src/backend/artifact.ts`.

## Project site

`site/` is a static GitHub Pages site (landing page with the hero film, and full documentation). `.github/workflows/pages.yml` publishes it on every push to `main` that touches `site/`; in the repository settings set **Pages → Source** to *GitHub Actions*. `node scripts/check-site.mjs` loads both pages at desktop and phone widths and checks links, images, the video and overflow.

The hero film is made from code in `hero-film/`: `capture.mjs` takes real screenshots of the app in demo mode, `film.js` animates them (every frame is a pure function of time), `audio/score.py` synthesizes the score. `docs/shotlist.md` and `docs/critique.md` record the plan and the review rounds.

## Known limits

- Accounts are local. SSO (OIDC/SAML) is not built in yet.
- SQLite suits a single server and a team-sized load. For high availability, move the storage layer to PostgreSQL.
- PDF text uses the standard Helvetica and Courier fonts, which cover Western European languages. Other scripts are dropped from the PDF (the on-screen report shows them).

## License and contributing

Muster is free software under the [GNU AGPL v3 or later](LICENSE): if you offer a modified version to users over a network, you must give them its source code.

Contributions follow the [Solid standard](https://github.com/SolidGeeks/.github/blob/main/CONTRIBUTING.md): sign off every commit with `git commit -s` (DCO), no CLA. To report a vulnerability, see [SECURITY.md](SECURITY.md).
