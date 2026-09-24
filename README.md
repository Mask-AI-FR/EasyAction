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
  <img alt="Bun 1.3.11" src="https://img.shields.io/badge/Bun-1.3.11-052E1C?logo=bun&logoColor=white">
  <img alt="TypeScript 5.9.3" src="https://img.shields.io/badge/TypeScript-5.9.3-047857?logo=typescript&logoColor=white">
  <img alt="Hono 4.13.9" src="https://img.shields.io/badge/Hono-4.13.9-16A34A?logo=hono&logoColor=white">
  <img alt="Lit 3.3.3" src="https://img.shields.io/badge/Lit-3.3.3-22C55E?logo=lit&logoColor=white">
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#security">Security</a> ·
  <a href="#development">Development</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
</p>

---

**EasyActions** is a web dashboard for GitHub Actions. You pick a GitHub organization and see every
repository with its branches and workflows, plus the live status of each one. You can start
`workflow_dispatch` runs on many repositories at once, then watch them finish, all from one screen.

> EasyActions is the product name. **Pipliner** is the codename: you will still see it in the code, the
> cookies, the `/health` answer and the logs.

## Features

- **Sign in with GitHub.** It uses a GitHub App with a PKCE flow. Your GitHub token stays on the
  server, inside an encrypted cookie. The browser never sees it.
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
- **GitHub Enterprise Server** is supported through two settings.

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
| `server/` | The Hono server: auth, API routes, GitHub adapters, config, logging |
| `domain/` | Framework-free logic and types shared by both sides (API contract, dispatch plan, polling policy) |
| `scripts/` | Production build and the desktop launcher |
| `tests/` | Unit and integration tests. GitHub is replaced by a real local fake HTTP server |

Every design choice, the full list of routes, and the behaviour on each kind of failure are described
in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

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
```

Open `.env` and replace every `<TO_PROVIDE>`:

- `SESSION_SECRET`: the output of the `openssl` command
- `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`: your app's values

`.env` is git-ignored. Never commit it.

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

## Configuration

Every variable is **required**. If one is missing, still set to `<TO_PROVIDE>`, or invalid, the server
does not start and lists the names of the problem variables (never their values). `.env.example`
documents each one.

| Variable | Purpose | Default in template |
|---|---|---|
| `HOST` | Interface to bind (never `0.0.0.0` on a host) | `127.0.0.1` |
| `PORT` | Port for the app and its API | `8094` |
| `APP_ORIGIN` | Exact public origin: builds the callback URL and is checked on every POST | `http://127.0.0.1:8094` |
| `SESSION_SECRET` | Cookie encryption secret, at least 32 characters | — |
| `GITHUB_WEB_URL` / `GITHUB_API_URL` | github.com, or your GitHub Enterprise Server | github.com |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | GitHub App credentials | — |
| `GITHUB_TIMEOUT_MS` | Timeout for every GitHub call (1000–60000) | `10000` |
| `REPOS_MAX` | Max repositories read per organization | `1000` |
| `BRANCHES_MAX` | Max branches read per repository | `300` |
| `ACTIVE_BRANCH_DAYS` | Branches with no commit for longer than this are listed as "Stale" | `90` |
| `DISPATCH_MAX_TARGETS` | Max pipelines one bulk run may start | `50` |
| `DISPATCH_CONCURRENCY` | Dispatches sent to GitHub at the same time | `3` |
| `RUN_POLL_MIN_SECONDS` | Minimum interval between two live-status checks | `10` |
| `RUN_TRACK_MAX_MINUTES` | How long started runs are followed | `30` |

## Security

- **No server-side storage.** The only data kept is in an encrypted session cookie in your own browser.
  Signing out clears it and revokes the GitHub token. Otherwise it expires after 8 hours.
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
| `bun run typecheck` | Strict TypeScript for the server and the app |
| `bun test` | Unit and integration tests |

Project conventions:

- Every dependency is pinned to an exact version.
- `app/` never imports from `server/`.
- Every error body has the shape `{ detail: { code, message } }`.
- Logs go only through `server/config/logger.ts`.
- Components use shadow DOM and only MASKAI semantic classes.

The tests check the design rules. The full rules are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Roadmap

- **M5: statistics** (`vstatistique`), pipeline statistics per organization. Planned, not built yet.

## Brand

The logos, app icons and favicons are in [`EasyActions-Logo-Pack-v2/`](EasyActions-Logo-Pack-v2/). Its
[README](EasyActions-Logo-Pack-v2/README.txt) covers colours, typeface, sizes and clear-space rules.
