# Changelog

All notable changes to Muster. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Built with TypeScript 7 and esbuild 0.28. The app's code is the same; the next image is assembled by the new tools, checked by the browser walk-through and the image test.

### Added
- Tests for restoring a playbook version and for the password change (wrong current password, strength, other sessions signed out), by [@man-singh-dev](https://github.com/man-singh-dev) ([#12](https://github.com/SolidGeeks/muster/pull/12), [#13](https://github.com/SolidGeeks/muster/pull/13)). Thanks, and welcome!
- Tests for stopping an incident early (roles, conflicts, the report status) and for the exercise speed and the incident details (limits, live incidents, roles), by [@am-official](https://github.com/am-official) ([#18](https://github.com/SolidGeeks/muster/pull/18), [#19](https://github.com/SolidGeeks/muster/pull/19)). Thanks, and welcome!
- CI runs the browser walk-through and builds and starts the Docker image on every pull request.

### Fixed
- The browser walk-through no longer fails on Windows when removing its data folder.

## [1.0.1] - 2026-10-25

### Security
- **Markdown export of incident reports** (*Download → Markdown*, and the plain-text part of *Copy formatted*): text typed by users could break out of its table cell or its line, so someone able to edit a playbook, a template or an incident could alter the tables of an exported report (for example show *Met* next to a breached SLA). Backslashes are now escaped before pipes, every user value in a table goes through the same escaping, and line breaks are removed from headings and list items. The PDF, the on-screen report and the formatted (HTML) copy were not affected. Found by CodeQL (`js/incomplete-sanitization`).

### Added
- Test: every row of every table in the Markdown export keeps the number of cells of its header, with hostile playbook, role and incident names.

## [1.0.0] - 2026-10-25

First release.

### Added
- **Playbooks** drawn as diagrams: actions, decisions, owners and SLAs, with keyboard shortcuts (**A** action, **D** decision) and drafts saved automatically. Ten ready-made playbooks following the NIST phases: ransomware, phishing, compromised account, CEO fraud, personal data breach (GDPR 72 h), endpoint malware, DDoS, lost device, insider threat, exploited vulnerability.
- **Versioning**: one shared draft per playbook with conflict detection, immutable published versions, and a diagram diff between any two versions.
- **Incidents and exercises** run step by step on a frozen copy of the playbook: tasks, decisions, live SLAs, and an accelerated clock for tabletop exercises.
- **Incident reports** written from the run, previewed on screen and downloaded as PDF; templates with logo, colour, ID pattern (`IR-{YYYY}-{SEQ}`…) and sections.
- **Accounts and roles** (admin, editor, analyst, viewer), audit log, live updates for everyone through server-sent events.
- **Online version**: a single page running the same interface in a Claude artifact (`npm run build:online`).
- Docker image, signed: every release carries a Sigstore build provenance attestation. Check one with `gh attestation verify oci://ghcr.io/solidgeeks/muster:1.0.0 --owner SolidGeeks`.

### Security
- scrypt password hashing, HttpOnly SameSite session cookies, a required `X-Muster` header on every write (CSRF protection), login rate limiting, strict Content-Security-Policy, role checks on every endpoint.

### Project
- Licensed AGPL-3.0-or-later, with SPDX headers in every source file; `SECURITY.md`.
- CI runs the type check and the API tests on every push and pull request; the Release workflow runs them again and publishes nothing if they fail.
- The Docker build installs exactly the dependencies pinned in `package-lock.json` (`npm ci`).

[Unreleased]: https://github.com/SolidGeeks/muster/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/SolidGeeks/muster/releases/tag/v1.0.1
[1.0.0]: https://github.com/SolidGeeks/muster/releases/tag/v1.0.0
