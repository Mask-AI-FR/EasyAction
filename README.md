<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="EasyActions-Logo-Pack-v2/svg/easyactions-logo-horizontal-dark.svg">
    <img src="EasyActions-Logo-Pack-v2/svg/easyactions-logo-horizontal.svg" alt="EasyActions — Repository Pipeline Automation" width="560">
  </picture>
</p>

<p align="center">
  <strong>Run GitHub Actions across a whole organization — safely, in bulk, and live.</strong>
</p>

<p align="center">
  <a href="https://github.com/Mask-AI-FR/EasyAction/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Mask-AI-FR/EasyAction/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/Mask-AI-FR/EasyAction/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Mask-AI-FR/EasyAction?color=047857"></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-16A34A"></a>
</p>

<p align="center">
  <img alt="Bun 1.3.11" src="https://img.shields.io/badge/Bun-1.3.11-052E1C?logo=bun&logoColor=white">
  <img alt="TypeScript 5.9.3" src="https://img.shields.io/badge/TypeScript-5.9.3-047857?logo=typescript&logoColor=white">
  <img alt="Hono 4.13.9" src="https://img.shields.io/badge/Hono-4.13.9-16A34A?logo=hono&logoColor=white">
  <img alt="Lit 3.3.3" src="https://img.shields.io/badge/Lit-3.3.3-22C55E?logo=lit&logoColor=white">
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#security">Security</a> ·
  <a href="#development">Development</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
</p>

---

**EasyActions** is a web dashboard for GitHub Actions. You pick a GitHub organization and see every
repository with its branches and workflows, plus the live status of each one. You can start
`workflow_dispatch` runs on many repositories at once, then watch them finish, all from one screen.

> EasyActions is the product name. **Pipliner** is the codename: you will still see it in the code, the
> cookies, the `/health` answer and the logs.

## Features

- **Sign in with GitHub, stay signed in.** It uses a GitHub App with a PKCE flow. You stay signed in
  for up to 30 days (configurable): your GitHub tokens are kept encrypted on the server and renewed
  automatically. The browser never sees them.
- **Daily code.** Once a day, each browser asks for the 6-digit code of an authenticator app (Google
  Authenticator, Authy, 2FAS, 1Password…), set up with a QR code at your first sign-in. Ten one-time
  recovery codes cover a lost phone.
- **Your account.** See every browser where you are signed in, sign the others out, make new recovery
  codes, change your authenticator app, download your data or delete it. Sign-ins and security actions
  are kept in a history.
- **Settings in the website, for admins.** Enter the GitHub connection (addresses, GitHub App client
  ID and secret) on a setup page the first time, then change it and the limits without editing files.
  Manage users: roles, authenticator reset, sign-out, deletion. Read the security history. Sensitive
  changes ask for a current 6-digit code.
- **Statistics dashboard.** Each organization opens on its dashboard: people who committed on any
  branch, successful and failed runs, success rate, average duration and branches, compared with the
  previous period; runs over time, rankings by repository, top failing workflows and recent failures.
  7, 30 or 90 days. Every chart has a table view, and the page names anything it could not read.
- **Sidebar, organization already chosen.** The navigation sits on the left (a drawer on a phone): your
  organization with its dashboard and repositories, the admin pages, and your account card with its
  sign-out button. The organization you opened last in this browser is selected for you (otherwise the
  first of your list); switch to another from the card at the top. While anything loads, the
  EasyActions gear turns.
- **Organization overview.** See every repository the app can access. Search and filter them by
  visibility, language and archived state, and sort them. The filters are saved in the address, so
  you can share a link to a filtered view.
- **Branches and workflows per repository.** Branches are listed in this order: the default branch,
  then active branches, then stale ones. Each workflow shows the status of its latest run on the
  branch you chose.
- **Bulk runs.** Select repositories and workflows, look over the full list of targets in a
  confirmation dialog, and start them all with one request.
- **Guard for production branches.** If any target is on a repository's default branch, the Run button
  stays locked until you type the organization's name.
- **Live tracking.** Started runs are checked with an adaptive polling interval. If their state can't be
  confirmed, they show "Status unknown" and a link to GitHub. The app never guesses a result.
- **Desktop window.** `bun run desktop` opens EasyActions in its own window. You can also install it
  from Brave, Chrome or Edge.
- **GitHub Enterprise Server** and GHE.com are supported through two settings.

## How it works

One Bun process serves both the web app and its API from the same origin.

```
Browser ── same origin ──▶ Bun + Hono
                            ├─ /health, /auth/*, /api/*  → server/  (GitHub adapters: OAuth, repos, Actions)
                            └─ any other path            → app/     (TiniJS + Lit web app)
```

| Folder | Contents |
|---|---|
| `app/` | The web app: TiniJS on Lit, Tailwind CSS v4, MASKAI design tokens with an EasyActions brand layer |
| `server/` | The Hono server: auth, sessions, API routes, GitHub adapters, SQLite database (schema, repositories), config, logging |
| `domain/` | Framework-free logic and types shared by both sides (API contract, dispatch plan, polling policy, dashboard statistics) |
| `scripts/` | Production build, database, settings and user commands, and the desktop launcher |
| `tests/` | Unit and integration tests. GitHub is replaced by a real local fake HTTP server |

Every design choice, the full list of routes, and the behaviour on each kind of failure are described
in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**; what is stored and how it is protected, in
**[docs/SECURITY.md](docs/SECURITY.md)**.

## Installation

Every [release](https://github.com/Mask-AI-FR/EasyAction/releases/latest) ships ready-made Linux x64
builds, so you do not need Bun. Each user gets their own database in `~/.local/share/easyactions` and
their own settings in `~/.config/easyactions`. The two secrets are generated on the first run.

Whichever build you choose, you still need a GitHub App first: see
[step 1 below](#1-create-a-github-app).

| Build | For |
|---|---|
| `easyactions_<version>_amd64.deb` | Debian, Ubuntu and derivatives |
| `easyactions-<version>-linux-x64.tar.gz` | Any distribution. No root needed |
| `PKGBUILD`, `easyactions-system`, `easyactions.service` | Arch Linux and derivatives |
| `SHA256SUMS` | Checksums for all of the above |

Download the files you need from the release page, then check them:

```bash
sha256sum --check --ignore-missing SHA256SUMS
```

**Debian / Ubuntu**

```bash
sudo apt install ./easyactions_<version>_amd64.deb
```

**Any distribution (portable archive)**

```bash
tar -xzf easyactions-<version>-linux-x64.tar.gz
cd easyactions-<version>-linux-x64
./install.sh            # links `easyactions` into ~/.local/bin; `./install.sh --uninstall` undoes it
```

**Arch Linux.** Put `PKGBUILD`, `easyactions-system` and `easyactions.service` in one folder, then:

```bash
makepkg -si
```

**Then, as your normal user (not root):**

```bash
easyactions                                   # start the server and open the app in its own window
easyactions settings:setup-code               # one-time code for the /setup page (30 minutes)
easyactions users:promote <your-github-login> # make yourself an admin (sign in once first)
```

`easyactions help` lists every command. With the `.deb` or Arch package, keep the server running
across reboots with `systemctl --user enable --now easyactions`.

To run from source instead, follow the steps below.

## Getting started

### Prerequisites

- [Bun](https://bun.sh) 1.3.11
- A GitHub organization where you can install a GitHub App
- Optional: a Chromium-based browser (Brave, Chromium, Chrome, Edge) for the desktop window

### 1. Create a GitHub App

On GitHub, go to **Settings › Developer settings › GitHub Apps › New GitHub App** (or do the same in
your organization's settings), then set:

| Setting | Value |
|---|---|
| Homepage URL | `http://127.0.0.1:8094` |
| Callback URL | `http://127.0.0.1:8094/auth/callback` |
| Expire user authorization tokens | **Checked** (required: without it, sign-in is refused) |
| Request user authorization (OAuth) during installation | Unchecked |
| Webhook → Active | Unchecked |
| Repository permissions | **Actions:** Read and write · **Contents:** Read-only · **Metadata:** Read-only |

Create the app. Note its **Client ID**, generate a **client secret**, and install the app on your
organization.

### 2. Configure

```bash
bun install --frozen-lockfile
cp .env.example .env
openssl rand -base64 32
openssl rand -base64 32
```

Open `.env` and replace every `<TO_PROVIDE>`:

- `SESSION_SECRET`: the first output of the `openssl` command
- `DATA_ENCRYPTION_KEY`: the second output (a different value; keep it safe — losing it signs
  everybody out)

`.env` is git-ignored. Never commit it. The GitHub App's client ID and secret never go in it: you
type them on the website (step 4).

Then create the database (run it again after every upgrade, with the server stopped):

```bash
bun run db:migrate
```

### 3. Run

Development mode, with hot reload, on http://127.0.0.1:8094:

```bash
bun run dev
```

Production mode (stop the dev server first, because both use the same port):

```bash
bun run build
bun run start
```

Desktop window. This reuses a running server, or builds and starts one in the background:

```bash
bun run desktop
```

### 4. Connect your GitHub App

The first time, the server starts in **setup mode**: open http://127.0.0.1:8094 and it shows the
setup page. In the repository folder, get a one-time setup code (it works for 30 minutes):

```bash
bun run settings:setup-code
```

On the setup page, type that code, the GitHub address (the API address fills itself in), your app's
**Client ID** and **client secret**, then **Test connection** and **Save and finish**. The secret is
stored encrypted in the database and never shown again.

### 5. Become the first admin

Sign in with GitHub (and set up your authenticator app), then run this in the repository folder, with
your GitHub login instead of `your-github-login`:

```bash
bun run users:promote your-github-login
```

Reload the page: an **Administration** section (Settings, Users, History) appears in the sidebar.
Other admins can then be made from the Users page.

## Configuration

Configuration has two places:

- **`.env`, for the server and security.** Every variable in the table below is **required**. If one
  is missing, still set to `<TO_PROVIDE>`, or invalid, the server does not start and lists the names
  of the problem variables (never their values). `.env.example` documents each one.
- **The website, for the website settings** (GitHub connection and limits, second table). They are
  stored in the database: the GitHub connection is entered once on the setup page, then admins change
  everything on the Settings page. Limits start at the defaults below.

| Variable | Purpose | Default in template |
|---|---|---|
| `HOST` | Interface to bind (never `0.0.0.0` on a host) | `127.0.0.1` |
| `PORT` | Port for the app and its API | `8094` |
| `APP_ORIGIN` | Exact public origin: builds the callback URL and is checked on every POST | `http://127.0.0.1:8094` |
| `SESSION_SECRET` | Encrypts the short sign-in cookie, at least 32 characters | — |
| `DATA_ENCRYPTION_KEY` | Encrypts the GitHub tokens in the database, at least 32 characters | — |
| `DATABASE_PATH` | SQLite file, created by `bun run db:migrate` | `./data/pipliner.sqlite` |
| `HTTP_IDLE_TIMEOUT_SECONDS` | Seconds a connection may stay silent (30–255) | `240` |
| `SESSION_MAX_DAYS` | Days a browser stays signed in (1–180) | `30` |
| `SESSIONS_PER_USER_MAX` | Browsers one person can be signed in on (1–10) | `5` |
| `AUDIT_RETENTION_DAYS` | Days the sign-in and security history is kept (30–3650) | `365` |
| `TWO_FACTOR_EVERY_HOURS` | Hours an accepted 6-digit code stays valid for a browser (1–168) | `24` |
| `TWO_FACTOR_MAX_ATTEMPTS` | Wrong codes before a lock (3–20) | `5` |
| `TWO_FACTOR_LOCK_MINUTES` | First lock, doubled at each next one, 24 h at most (1–1440) | `15` |

Website settings (setup page, then Settings page):

| Setting | Purpose | Default |
|---|---|---|
| GitHub web and API addresses | github.com, GHE.com or your GitHub Enterprise Server; the API address must match the web address | — |
| GitHub App client ID and secret | The app EasyActions signs in with; the secret is stored encrypted and never shown | — |
| GitHub timeout | Timeout for every GitHub call (1000–60000 ms) | `10000` |
| Repositories read per organization | Above it, the list says it is truncated | `1000` |
| Branches read per repository | Max branches listed | `300` |
| Days before a branch is stale | Older branches are listed as "Stale" | `90` |
| Pipelines per bulk run | Max pipelines one bulk run may start | `50` |
| Dispatches sent at the same time | Parallel requests to GitHub | `3` |
| Live status: minimum seconds between checks | Polling floor | `10` |
| Live status: minutes runs are followed | Then "Status unknown" | `30` |
| Dashboard: repositories read | The most recently pushed first (1–500) | `50` |
| Dashboard: runs read per repository and period | GitHub lists 1,000 at most (100–1000) | `500` |
| Dashboard: commits read per repository | All branches, both periods (100–10000) | `2000` |
| Dashboard: seconds a result is reused | `0` reads GitHub at every visit (0–3600) | `300` |
| Dashboard: seconds allowed to read GitHub | Repositories not read in time are named (10–200) | `60` |

Changing the GitHub address or client ID signs everybody out. If a wrong value locks everybody out,
run `bun run settings:setup-code --reset`: it clears the connection (signing everybody out), puts the
server back in setup mode and prints a new setup code.

## Security

- **Sessions in a local database.** The cookie holds only a random id; the session and its GitHub
  tokens live in the SQLite file, the tokens encrypted (AES-256-GCM). Signing out closes the session
  and revokes the token; the Account page signs out other browsers, exports or deletes your data.
  Details: [docs/SECURITY.md](docs/SECURITY.md).
- **Admins are checked by the server.** Every admin route answers `403` to other users. Changing the
  GitHub connection, a role, someone's authenticator app or deleting someone needs a current 6-digit
  code, and the history records who did it.
- **Setup needs the server.** Until a GitHub connection is saved, only the setup page answers, and only
  with a one-time code printed by `bun run settings:setup-code` on the server. Once set up, the setup
  page is closed for good (`--reset` reopens it, from the server only).
- **CSRF protection.** Every POST must carry the app's exact `Origin`, and cookies are `SameSite=Lax`.
- **Strict headers.** Every response sets a CSP and `frame-ancestors 'none'`, so the "Run" button
  cannot be embedded in another site (clickjacking).
- **No duplicate deploys.** A dispatch is **never retried**. If a dispatch times out or GitHub answers
  with a server error, the result is reported as "unknown" and you are asked to check GitHub. A retry
  could start the same deployment twice.
- **Privacy-safe logs.** Logs are JSON lines built from a fixed list of allowed fields. They never
  contain tokens, request bodies, headers or personal data.

> **Warning:** a `workflow_dispatch` run usually deploys something. Test with a sandbox repository
> that has a no-op workflow, never with production workflows.

### Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/Mask-AI-FR/EasyAction/security/advisories/new)
instead.

## Development

Check gate. All of these must pass before a change is considered done:

```bash
bun install --frozen-lockfile && bun run typecheck && bun test && bun run build && bun audit --audit-level=high
```

| Script | What it does |
|---|---|
| `bun run dev` | Dev server with hot reload (`server/dev.ts`) |
| `bun run build` | Builds the web app into `dist/app` (`scripts/buildApp.ts`) |
| `bun run start` | Production server (`server/index.ts`) |
| `bun run desktop` | Opens EasyActions in its own window (`scripts/desktop.ts`) |
| `bun run db:migrate` | Creates or upgrades the SQLite database (server stopped) |
| `bun run db:status` | Tells whether the database is ready |
| `bun run db:rollback` | Removes the last migration (`--yes` when it deletes data) |
| `bun run settings:setup-code` | Prints a one-time code for the setup page (30 minutes); `--reset` first clears the GitHub connection |
| `bun run users:promote <login>` | Makes someone an admin (they must have signed in once) |
| `bun run users:demote <login>` | Removes the admin role (never from the last admin) |
| `bun run users:reset-two-factor <login>` | Removes someone's authenticator app (lost phone); `--all` for everybody |
| `bun run typecheck` | Strict TypeScript for the server and the app |
| `bun test` | Unit and integration tests |

Project conventions:

- Every dependency is pinned to an exact version.
- `app/` never imports from `server/`.
- Every error body has the shape `{ detail: { code, message } }`.
- Logs go only through `server/config/logger.ts`.
- Components use shadow DOM and only MASKAI semantic classes.

The tests check the design rules. The full rules are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contributing

Contributions are welcome: bug reports, fixes and improvements.

1. For a bug, [open an issue](https://github.com/Mask-AI-FR/EasyAction/issues) with the steps to
   reproduce it. Leave out tokens, cookies and personal data.
2. For a larger change, open an issue first so the approach can be agreed before you write code.
3. Fork the repository and branch from `main`.
4. Keep the change focused. Add a test that fails without it, and update the docs it affects.
5. Run the [check gate](#development). CI runs the same command on every pull request to `main`.
6. Open a pull request that explains what changed and why.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before your first change. It explains the reasons
behind the rules the tests enforce. By contributing, you agree that your contribution is licensed
under the [Apache License 2.0](LICENSE).

## Roadmap

The planned milestones (M0–M8) are delivered. How the dashboard counts is described in
**[docs/DASHBOARD.md](docs/DASHBOARD.md)**.

## Brand

The logos, app icons and favicons are in [`EasyActions-Logo-Pack-v2/`](EasyActions-Logo-Pack-v2/). Its
[README](EasyActions-Logo-Pack-v2/README.txt) covers colours, typeface, sizes and clear-space rules.

## License

EasyActions is released under the **Apache License 2.0** (`SPDX-License-Identifier: Apache-2.0`). The
full text is in [LICENSE](LICENSE), and every package ships a copy. You may use, modify and
redistribute it, including commercially, as long as you keep the copyright and licence notices and
state the changes you made to any file you redistribute.

The licence covers the **code only**. The EasyActions name and the logos, app icons and favicons in
[`EasyActions-Logo-Pack-v2/`](EasyActions-Logo-Pack-v2/) are not granted with it: a fork may use the
code, not the brand.
