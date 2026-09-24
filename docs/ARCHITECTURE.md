# Architecture — EasyActions (codename Pipliner)

How the app is built today and why. Its product name is **EasyActions** (maintainer's decision,
24 September 2026); **Pipliner** remains the codename in the code, the repository, the cookies, `/health`
and the logs, so that renaming broke nothing and signed nobody out. Verified against the code on
24 September 2026, at the end of milestone **M4** and the EasyActions rebrand. Everything under
[§12](#12-planned-not-implemented) is planned, not built.

## 1. Purpose

A dashboard for MaskAI engineers: pick a GitHub organization, see every repository with its branches
and GitHub Actions workflows (live status), trigger `workflow_dispatch` runs in bulk, and read pipeline
statistics (`vstatistique`), styled with the MASKAI design system.

At M4: sign in with a GitHub App, choose an organization where the app is installed, and browse its
repositories (search, visibility, language, archived, sort, pages — all kept in the address). Opening a
repository row shows its branches and its workflows with the status of their latest run on the chosen
branch. Repositories and workflows can be selected and run in bulk (`workflow_dispatch`) after a
confirmation, then followed live. Statistics arrive in M5.

Each repository row has its own branch list (`app/components/repos/branch-select.ts`): every branch,
whether or not a pipeline ever ran on it — default first, then active, then stale. The lists of the
visible rows load in the background, 4 GitHub requests at a time, cached 60 seconds; the workflows of a
row are read only when it is opened. A branch where nothing ever ran says so, and stays runnable.

## 2. Runtime and stack

All versions are pinned exactly (`bunfig.toml`: `exact = true`, `peer = false`).

| Layer | Choice |
|---|---|
| Runtime | Bun 1.3.11 (local); MaskAI images use `oven/bun:1.4.2` — deployment is not set up yet |
| HTTP | Hono 4.13.9, one app built by `server/app.ts` |
| Validation | zod 4.6.5, at every edge |
| Sessions | jose 6.2.12 — encrypted cookies (JWE `dir` + `A256GCM`) |
| Web app | TiniJS `@tinijs/core` 0.21.1, `@tinijs/router` 0.21.0, `@tinijs/store` 0.21.0 on Lit 3.3.3 |
| Styling | Tailwind CSS 4.2.1 through `bun-plugin-tailwind` 0.1.2, `tw-animate-css` 1.4.0, the MASKAI tokens (§9) |
| Language | TypeScript 5.9.3, strict; two programs: `tsconfig.json` (server, domain, scripts, tests) and `app/tsconfig.json` (browser) |
| Tests | `bun test`; GitHub is faked by a real local HTTP server (`tests/support/fakeGithub.ts`) |

## 3. Components

```
Browser ── same origin ──▶ one Bun process
                            ├─ /health, /auth/*, /api/*  → Hono app (server/app.ts)
                            │     ├─ server/adapters/githubOAuth.ts   → GitHub sign-in: authorize, token, revoke
                            │     ├─ server/adapters/githubRepos.ts   → installations, repositories, branches (GraphQL)
                            │     ├─ server/adapters/githubActions.ts → workflows, runs, workflow_dispatch
                            │     └─ both through server/adapters/githubApi.ts (shared HTTP layer, user's token)
                            └─ any other path            → the web app (app/)
                                 dev:  server/dev.ts  — Bun bundles app/index.html on the fly (hot reload)
                                 prod: server/index.ts — Hono serves dist/app, built by scripts/buildApp.ts
```

- `domain/` holds framework-free code shared by both sides; `domain/apiContract.ts` is the single
  owner of every HTTP payload type. `app/` never imports `server/` (checked by a test).
- The adapters are the only modules that talk to GitHub. Every call has a timeout
  (`GITHUB_TIMEOUT_MS`) and **no automatic retry**; responses are validated by zod; GitHub's messages
  and bodies never leave the adapter (only a stable failure code does).
- **Bulk runs (M4).** `app/components/repos/bulk-action-bar.ts` owns the flow: read the workflows of
  every selected repository (4 at a time, 60-second browser cache) → `domain/dispatchPlan.ts` (active
  workflows only, one branch per repository, cap, default-branch count) → confirmation dialog listing
  every repository, workflow, file path and branch → **one** `POST /api/dispatches` → a toast with the
  per-target outcome → live tracking. The server re-validates everything and dispatches
  `DISPATCH_CONCURRENCY` at a time (`server/services/dispatchRunner.ts`); a dispatch is never sent
  twice, even after a timeout or a 5xx, because every MaskAI workflow deploys.
- **Live status.** `app/services/run-poller.ts` asks `GET /api/repos/:owner/:repo/runs` once per
  repository per check (one GitHub call, filtered on the tracked run ids —
  `server/services/runTracker.ts`). The interval comes from `domain/pollingPolicy.ts`: at least
  `RUN_POLL_MIN_SECONDS`, longer with more repositories, doubled after each failure, at most ten times
  the minimum; no check while the tab is hidden. Tracking stops when every run is finished, after three
  failures in a row, or after `RUN_TRACK_MAX_MINUTES`; unfinished runs then show "Status unknown" and
  their GitHub link, never an assumed result.
- **Desktop app.** `bun run desktop` (`scripts/desktop.ts`) opens EasyActions in its own window: if
  nothing answers on `APP_ORIGIN/health` with `service: "pipliner"`, it builds, starts
  `bun server/index.ts` detached from the terminal (output in `desktop-server.log`, git-ignored; it
  prints the PID to stop it), waits up to 20 s — then fails closed rather than opening a window on no
  server — and starts the first Chromium browser found (Brave first) with `--app=<origin>/orgs`. The app
  can also be installed from a Chromium browser (Brave, Chrome, Edge) as a
  window of its own, through a web app manifest (`app/public/manifest.webmanifest`: opens on `/orgs`,
  `display: standalone`, fixed `id: "/"`). There is **no service worker**, on purpose: Chromium 112+
  installs from its menu without one, and a cache could show an old app after an update or keep data
  of a closed session — Pipliner needs the network for everything anyway. The cost: no automatic install
  prompt, and offline the window shows the browser's error page. The installed app is only a window onto
  the Pipliner server: `bun run dev` or `bun run start` must be running. Its identity is the origin
  (`APP_ORIGIN`): another port or an HTTPS deployment means installing it again. Firefox cannot install
  web apps on Linux (as of September 2026).
- **Why the icons have fixed addresses.** Bun's HTML bundler copies a relatively linked manifest under
  a hashed name (`/manifest-<hash>.webmanifest`) but does not rewrite the paths written inside it, and an
  absolute `href` in `index.html` fails the build ("Could not resolve"). So the manifest's icons live at
  `/icons/…`: `scripts/buildApp.ts` copies `app/public/icons/` into `dist/app/icons/`, and in development
  `server/dev.ts` serves the files of that folder (only those present at start).
- **Latest status of a workflow** = its most recent run among the 100 most recent runs of the chosen
  branch (pull-request runs excluded). A workflow that has not run recently on a busy branch shows
  "No runs"; its link on GitHub remains the reference.
- **Why two entry points.** Bun's HTML-import routes cannot carry custom response headers, and
  `frame-ancestors` cannot be set from a `<meta>` CSP. In production Hono serves the pre-built app, so
  the page itself gets the security headers (§8). In development the page has none; it is only ever
  served on 127.0.0.1.
- Bun route precedence in dev: exact > parameter > wildcard (`/api/*`) > catch-all (`/*`).
- **Production files** (`serveBuiltApp` in `server/app.ts`): assets are referenced from the root
  (`publicPath: "/"` in `scripts/buildApp.ts`) — with Bun's default relative paths, a deep link opened
  directly (`/orgs/Mask-AI-FR`) looked for `/orgs/chunk-….js` and the app never started (found by the
  M2 browser run; `tests/unit/buildApp.test.ts` guards it). The entry page is sent with
  `Cache-Control: no-cache`, hashed `chunk-*.js|css` files with `public, max-age=31536000, immutable`:
  a browser keeping an old entry page after a deploy would otherwise ask for chunks that no longer exist.

## 4. Public interfaces (implemented)

| Route | Answer |
|---|---|
| `GET /health` | `200 {"status":"ok","service":"pipliner"}` — same contract as the MaskAI services |
| `GET /auth/login?returnTo=/path` | `302` to GitHub's authorize page (`state` + PKCE S256); sets the short-lived flow cookie |
| `GET /auth/callback` | checks the flow, exchanges the code, opens the session, `303` to `returnTo`; on failure `303 /login?error=<code>` |
| `POST /auth/logout` | clears the session, revokes the GitHub token, `204`; needs the app's `Origin` |
| `GET /api/session` | `200 {"user":{"login","avatarUrl"},"expiresAt","limits":{"dispatchMaxTargets","runPollMinSeconds","runTrackMaxMinutes"}}` or `401`; never the token |
| `GET /api/orgs` | organizations where the app is installed and the user has access (personal accounts excluded), and the app's install link |
| `GET /api/orgs/:org/repos` | the repositories the app sees in that organization, up to `REPOS_MAX` (`truncated` above it); `400` for an invalid name, `404` when the app is not installed there |
| `GET /api/repos/:owner/:repo/branches` | `{defaultBranch, branches: [{name, committedAt, active}], truncated}`: default branch first, then by last commit; up to `BRANCHES_MAX`; `active` = commit within `ACTIVE_BRANCH_DAYS` |
| `GET /api/repos/:owner/:repo/workflows?branch=` | `{branch, workflows: [{id, name, path, state, htmlUrl, latestRun}]}`; `400` without a valid branch |
| `GET /api/repos/:owner/:repo/runs?ids=1,2&since=<ISO 8601>` | `{runs}`: the current state of up to 100 tracked `workflow_dispatch` runs created since `since` |
| `POST /api/dispatches` | body `{targets: [{owner, repo, workflowId, ref}]}` (1 to `DISPATCH_MAX_TARGETS`, else `400`); needs the app's `Origin`; `200 {outcomes}` in request order, duplicates removed: `dispatched {runId, htmlUrl}` · `rejected {code}` · `not_attempted {code}` · `unknown {code}` (`domain/dispatchContract.ts`) |
| unknown `/api/*` | `401` without a session, else `404` |
| unknown `/auth/*` | `404` |
| `GET /icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png` | the desktop app's icons (fixed addresses, named by the manifest) |
| `GET /manifest-<hash>.webmanifest`, `/favicon-<hash>.svg` | the manifest and the tab icon, hashed by the build (`application/manifest+json`, `image/svg+xml`) |
| any other path | the web app (`index.html`); its router shows the page, or its 404 page |

Every error body is `{ detail: { code, message } }` (`domain/apiContract.ts`). `message` is always our
own text. GitHub failures map to `401 unauthorized` (token revoked or expired: the app sends the user
back to sign-in), `403 forbidden`, `403 sso_required` (+ `ssoUrl`), `404 not_found`, `429 rate_limited`
(+ `retryAfterSeconds` and `Retry-After`), `422 unprocessable`, `502 upstream`. Sign-in failures use the
codes `expired`, `denied`, `github`, `config`, `unavailable`, `ended`, shown as English messages by the
sign-in page. Web app routes: `/` and `/login` (sign-in), `/orgs` (organization picker),
`/orgs/:org?q=&visibility=&language=&archived=1&sort=name&page=` (repositories), `**` (404).

## 5. Data ownership

Pipliner owns no table and no store. The only place that holds data is the **session cookie**, in the
user's own browser, encrypted: GitHub user id, login, avatar URL, GitHub access token, expiry. It is
erased by sign-out (and the token revoked) or by expiry (8 hours, the token's own lifetime). Nothing
is kept on the server. The web app keeps its selection, the runs it follows and a 60-second read cache
in memory only: a reload clears them, and sign-out reloads the page (`app/layouts/dashboard.ts`), so
no timer keeps polling for a session that has ended.

## 6. Configuration

Declared in `.env.example`; Bun loads a local `.env` automatically. Every variable is required:
`server/config/env.ts` stops the boot and lists every missing, placeholder (`<TO_PROVIDE>`) or invalid
**name** — never a value.

| Variable | Purpose |
|---|---|
| `HOST` | Interface to bind. `127.0.0.1` outside a container, never `0.0.0.0` from a host |
| `PORT` | Port serving both the app and its API |
| `APP_ORIGIN` | Exact public origin; builds the GitHub callback URL and is the only accepted `Origin` on POST. https, or http on loopback |
| `SESSION_SECRET` | ≥ 32 characters; the cookie encryption key is its SHA-256 (`openssl rand -base64 32`) |
| `GITHUB_WEB_URL` / `GITHUB_API_URL` | github.com and api.github.com, or a GitHub Enterprise Server. https (http on loopback only, for tests) |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | the Pipliner GitHub App's credentials (secret) |
| `GITHUB_TIMEOUT_MS` | timeout of every GitHub call, 1000–60000 |
| `REPOS_MAX` | repositories read at most per organization (pages of 100), 1–10000 |
| `BRANCHES_MAX` | branches read at most per repository (pages of 100), 1–1000 |
| `ACTIVE_BRANCH_DAYS` | a branch without a commit for longer is listed under "Stale", 1–3650 |
| `DISPATCH_MAX_TARGETS` | pipelines one run may start (checked by the dialog and again by the server), 1–200 |
| `DISPATCH_CONCURRENCY` | dispatches sent to GitHub at the same time, 1–10 |
| `RUN_POLL_MIN_SECONDS` | minimum interval between two live-status checks, 2–300 |
| `RUN_TRACK_MAX_MINUTES` | how long started runs are followed, 1–720 |

## 7. Failure directions (implemented)

| Failure | Direction | Where |
|---|---|---|
| Required variable missing, placeholder or invalid | **Closed at boot**, all names listed | `server/config/env.ts` |
| `dist/app/index.html` missing in production | **Closed at boot** (`bun run build` first) | `server/index.ts` |
| Unexpected error in a handler | **Closed**: generic 500; logged by `errName`/`errCode` only | `server/exceptions/errorHandler.ts` |
| Session cookie missing, tampered, expired, or a flow cookie offered as a session | **Closed**: `401` / redirect to sign-in | `server/auth/sessionCookie.ts`, `server/middleware/session.ts` |
| Callback without flow cookie, without code, or with a different `state` | **Closed**: no token exchange is attempted | `server/routers/auth.ts` |
| GitHub refuses or fails the exchange (incl. HTTP 200 + `error`), or `/user` fails | **Closed**: no session; the token, if any, is revoked | `server/routers/auth.ts` |
| GitHub App issues a non-expiring token | **Closed**: token revoked, `/login?error=config` | `server/routers/auth.ts` |
| POST without the app's exact `Origin` (missing included) | **Closed**: `403` | `server/middleware/originGuard.ts` |
| Token revocation fails at sign-out | **Open**: cookie already cleared, logged; the token expires within 8 h | `server/routers/auth.ts` |
| GitHub rejects the token (401) during a request | **Closed**: our `401`; the app goes to sign-in (`error=ended`) and comes back | `server/exceptions/errorHandler.ts`, `app/services/api-client.ts` |
| GitHub rate limit, SSO, refusal, outage or malformed answer | **Closed**: a stable error code; the page shows an explanation, "Try again", and the SSO link when there is one — never stale or partial data | `server/adapters/githubApi.ts`, `app/components/empty-state.ts` |
| A `Link` "next page" pointing to another host | **Closed**: not followed (the token never leaves our GitHub) | `server/adapters/githubApi.ts` |
| Organization list fails in the header switcher | **Open**: the switcher shows the current organization only; `/orgs` shows the error | `app/layouts/dashboard.ts` |
| Browser cannot check the session (server down) on a signed-in page | **Closed**: to sign-in with `error=unavailable` | `app/layouts/dashboard.ts` |
| Same, on the sign-in page itself | **Open**: the sign-in page is shown (it grants nothing) | `app/pages/login.ts` |
| Sign-out request fails | **Closed**: stays signed in, shows "Sign-out failed" | `app/layouts/dashboard.ts` |
| A stylesheet fails to load in the browser | **Closed**: the app does not start (an unstyled UI must not trigger deploys) | `app/styles/shared-sheet.ts` |
| Branches or workflows of one repository cannot be read | **Open** for the page: the row shows the reason and "Try again"; the current branch stays selected | `app/components/repos/branch-select.ts`, `workflow-list.ts`, `repo-row.ts` |
| Workflows of a selected repository cannot be read when preparing a run | **Closed** for that repository: nothing starts there, and the confirmation names it | `app/components/repos/bulk-action-bar.ts`, `domain/dispatchPlan.ts` |
| Dispatch body invalid, or more than `DISPATCH_MAX_TARGETS` targets | **Closed**: `400`, nothing is dispatched | `server/routers/api.ts` |
| Rate limit or ended session during a batch | **Closed**: nothing more is sent; the rest is `not_attempted` | `server/services/dispatchRunner.ts` |
| Timeout, network error or 5xx on one dispatch | **Closed**: never retried (a duplicate would deploy twice); outcome `unknown`, "check GitHub" | `server/adapters/githubActions.ts` |
| The dispatch request itself gets no answer (network, 5xx) | **Closed**: no retry; the toast says the result is unknown and to check GitHub first | `app/components/repos/bulk-action-bar.ts` |
| A live-status check fails | **Open** (read-only): the previous state stays; after 3 failures in a row, "Status unknown" + GitHub link | `app/services/run-poller.ts`, `domain/pollingPolicy.ts` |

## 8. Security

- **Sign-in**: GitHub App web flow with a random `state` (constant-time comparison) and PKCE S256;
  both live in an encrypted, HttpOnly, 10-minute flow cookie. `returnTo` must be a path of our own
  origin (single leading `/`, no `//`, no backslash), otherwise `/orgs` — no open redirect.
- **Session**: encrypted JWE cookie, `HttpOnly`, `SameSite=Lax`, `Path=/`, lifetime = the GitHub
  token's (8 h); `Secure` and the `__Host-` prefix whenever `APP_ORIGIN` is https. The browser never
  sees the GitHub token; `/api/session` returns login and avatar only. The refresh token GitHub sends
  is never stored: after 8 h the user goes through GitHub again (one redirect, the app is already
  authorized). The app must have "Expire user authorization tokens" enabled, else sign-in is refused.
- **Sign-out** revokes the token with `DELETE /applications/{client_id}/token`, authenticated with the
  app's client ID and secret (Basic) — the historical documented behaviour; GitHub's current page no
  longer states it, so a failure is only logged (`auth.revoke_failed`). To confirm on the first real use.
- **CSRF**: every POST must carry the app's exact `Origin` (`server/middleware/originGuard.ts`), plus
  `SameSite=Lax` cookies. `/api` responses are `Cache-Control: no-store`.
- **Bulk runs**: the confirmation dialog lists every target; when any target is on its repository's
  default branch (production for MaskAI), the Run button stays disabled until the organization's name
  is typed. The dialog is only a convenience: the server re-validates names, branch, workflow id, cap,
  session and `Origin`. The browser selects repositories and workflows, never raw GitHub URLs.
- **Headers** (`hono/secure-headers`, `server/app.ts`), on every Hono response including the
  production page: CSP `default-src 'self'; base-uri 'none'; font-src 'self' data:; form-action 'self';
  frame-ancestors 'none'; img-src 'self' <GitHub avatars>; object-src 'none'`, `X-Frame-Options: DENY`,
  `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`. A "Run pipelines" button must
  never be framable (clickjacking). Avatars come from `https://avatars.githubusercontent.com`, or from
  the GitHub Enterprise Server's origin / `avatars.<host>`.
- `font-src data:` exists because Bun's CSS bundler inlines small `url()` assets (the fonts) as `data:`
  URLs and has no option to stop it; the data comes from our own CSS bundle.
- **Logging** (`server/config/logger.ts`): one JSON line per event, allow-list of fields copied one by
  one (`route`, `method`, `status`, `durationMs`, `requestId`, `upstream`, `errName`, `errCode`). No
  error object, body, header, upstream URL, token, login or other personal data. `console.*` is banned
  outside it (checked by a test).

## 9. Design system — written exception to CLAUDE.md §6.1

MaskAI-Frontend owns the MASKAI tokens; they are not published as a package. On 24 September 2026 the
maintainer accepted copying them here:

- `app/styles/globals.css` = a provenance header + `MaskAI-Frontend/app/globals.css` **verbatim**
  (commit `40f75a965409dad9fd25da187aaf90e74fa2133d`) + one appended, marked block of `@font-face`
  rules. It is over the 400-line limit on purpose, so drift stays visible:
  `diff <(sed -n '7,1973p' app/styles/globals.css) ../maskai/MaskAI-Frontend/app/globals.css`
- The fonts are declared by hand because Bun 1.3.11's CSS bundler rewrites the `@fontsource` packages'
  `format('woff2-variations')` into invalid CSS and the browser silently drops them (same finding as
  `MaskAILawyer-AnalyzerAudioService/test-app/src/fonts.css`).
- The shadcn/React primitives cannot run in Lit, so their class recipes are **ported** with a source
  note: `app/ui/class-names.ts` (`cn`), `app/ui/button-classes.ts`, `app/ui/shield-loader.ts`,
  `app/ui/field-classes.ts` (input, select, checkbox, badge on native elements),
  `app/ui/table-classes.ts` (the table recipe on an ARIA grid of `div`s, because every repository row
  is a component and a `<table>` does not accept custom elements between its rows),
  `app/components/empty-state.ts`. Deliberate difference: `dark:` variants are removed (see §10).
- Follow-up (not scheduled): publish the design system as a package owned by MaskAI-Frontend.
- **App icons are not MASKAI tokens.** The desktop icons and the tab icon come from the EasyActions logo
  pack supplied by the maintainer (`EasyActions-Logo-Pack.zip`), redrawn on 24 September 2026 as
  `EasyActions-Logo-Pack-v2.zip` (exact 10-tooth gear, rounded arrow, a simplified drawing for 16–32 px,
  maskable version; its README lists the changes). They keep that pack's own green palette. The
  manifest's two colours are copied from the MASKAI light tokens (`--background` `#f2f5f9`, `--surface`
  `#ffffff`) because a manifest cannot read CSS variables: update them if those tokens change.
- **EasyActions brand layer.** `app/styles/theme-easyactions.css`, loaded right after `globals.css`,
  replaces only MASKAI's brand tokens with the logo's greens, in light and dark: `--primary`,
  `--primary-hover`, `--primary-soft`, `--primary-text`, `--text-link`, `--text-brand`, `--border-focus`,
  `--ring`, the CTA shadows and the dark-mode selection. Surfaces, neutral text, borders, signals, radii
  and density stay MASKAI's, and components keep using the same semantic classes. Buttons use the
  logo's deep emerald (`#047857`), not its bright green: white text on `#22C55E` is 2.28:1, under AA.
  "In progress" badges stay blue through `--run-text`, a token of this layer, so that a running pipeline
  never reads as "Success". `tests/unit/theme.test.ts` checks every pair against WCAG AA in both themes.
  The logo drawn in the header and on the sign-in page is `app/ui/brand-mark.ts` (paths copied from the
  v2 pack; the 16–32 px drawing below 33 px).

## 10. TiniJS — containment and known quirks

TiniJS has had no release since July 2024 and its website is gone; the maintainer chose it knowingly.
Only three runtime packages are used — `@tinijs/core`, `@tinijs/router`, `@tinijs/store`. Its CLI, Vite
builder, server and UI packages are not used; Bun bundles the app.

- **Shadow DOM is mandatory.** `TiniElement.createRenderRoot()` always attaches a shadow root, and
  `TiniComponent.firstUpdated()` reads `this.shadowRoot` without a check. So the global CSS cannot
  reach components directly: `app/styles/shared-sheet.ts` copies the compiled document stylesheets
  (minus `@font-face`) into one constructable sheet, and every component declares
  `static override styles = [sharedSheet]`. Tokens (`:root`, `html.dark`, `html[data-density]`) stay
  on the document and inherit into shadow trees; verified in Firefox 156 for light, dark and compact.
- **Rules enforced by `tests/unit/designRules.test.ts`:** no `dark:` variant (it cannot see
  `html.dark` from a shadow root — tokens carry the theme), no `createRenderRoot` override, no
  `@Subscribe`, every TiniJS class adopts the shared sheet, no stock Tailwind palette colours, no
  `rounded-control`/`rounded-card` (they do not exist: use `rounded-md` / `rounded-lg`), no
  dynamically built class names.
- **Stores**: `@tinijs/store`'s `@Subscribe` keeps its unsubscribe list on the class prototype, so
  disconnecting one instance unsubscribed them all. Components subscribe through
  `app/stores/store-controller.ts` (a Lit reactive controller, one subscription per instance).
- **Native `<dialog>`** (`app/components/confirm-dialog.ts`): `showModal()` inside a shadow root gives
  the focus trap, Esc and the top layer. Its layout class is `open:grid`: a plain `grid` would override
  the closed dialog's `display: none`. `::backdrop` inherits the tokens (verified in Firefox 156).
- **Checkbox bindings use Lit's `live()`**: the browser flips a checkbox before the store answers, and a
  plain binding would not re-apply a value it believes unchanged. A component method must not reuse a
  `LitElement` member name (`renderOptions` is one; TypeScript reports it).
- **Decorators** are TypeScript legacy ones: `app/tsconfig.json` sets `experimentalDecorators` and
  `useDefineForClassFields: false`.
- **`process.env.NODE_ENV`** is read in the browser by `@tinijs/core`; `scripts/buildApp.ts` defines it.
- **Router:** navigating `/orgs/a` → `/orgs/b` keeps the same page element, so pages reload their data
  on the window event `tini:route-change` (`app/pages/repos.ts`, `app/layouts/dashboard.ts`); the event
  still fires while leaving a page, so handlers ignore it when their route parameter is gone.
- **Router cache:** `match()` caches its result by **path only** (`router.js`), so `getQuery()`,
  `@UseQuery()` and the event's `detail.query` return the query of the first visit to that path. The app
  reads query parameters from `location.search` instead; `designRules.test.ts` bans `getQuery`/`@UseQuery`.
  Found by the M2 browser run (the search box changed the address but not the list). A layout's `onBeforeEnter` guard runs only when the
  layout changes; an expiry in the middle of a visit surfaces as a `401` from the API. Links to server
  routes (`/auth/login`) carry `router-ignore` so the router does not intercept them.

## 11. How to run and check

The command blocks below contain no comments on purpose: zsh does not treat `#` as a comment when
commands are pasted at an interactive prompt, so a trailing comment becomes extra arguments.

**1. A GitHub App for development** (once, on github.com: Settings › Developer settings › GitHub Apps ›
New GitHub App — or under the organization's settings):

- Homepage URL `http://127.0.0.1:8094`; Callback URL `http://127.0.0.1:8094/auth/callback`.
- "Expire user authorization tokens": **checked**. "Request user authorization (OAuth) during
  installation": unchecked. Webhook: **Active unchecked**.
- Repository permissions: **Actions: Read and write**, **Contents: Read-only**, **Metadata: Read-only**.
  Nothing else.
- Create it, note its **Client ID**, click **Generate a new client secret**, and install the app on
  the organization (Install App).

**2. Local configuration** — create `.env` from the template (Bun loads it at start; it is git-ignored,
never commit it), then open it in an editor and replace every `<TO_PROVIDE>`: `SESSION_SECRET` with
the output of `openssl rand -base64 32`, `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` with the
app's values.

```bash
bun install --frozen-lockfile
cp .env.example .env
openssl rand -base64 32
```

**3. Development server** — http://127.0.0.1:8094 with hot reload. After editing `.env`, stop it with
Ctrl+C and start it again: `.env` is read only at start.

```bash
bun run dev
```

**Open as a desktop app** — one command, from the repository root. It reuses a running server (for
example `bun run dev`) or builds and starts one in the background, then opens EasyActions in its own
Brave window:

```bash
bun run desktop
```

To also get it in the app menu, install it once from that window or from Brave: the install icon at the
right of the address bar, or the browser menu. Keep the server running while you use it.

Production mode — stop the dev server first (same port), and run from the repository root:

```bash
bun run build
bun run start
```

Check gate (all must pass before a change is done):

```bash
bun install --frozen-lockfile && bun run typecheck && bun test && bun run build && bun audit --audit-level=high
```

## 12. Planned (not implemented)

Delivered milestone by milestone, each stopping for review: M5 `vstatistique` (statistics). Decisions
already taken:
GitHub App with organization scope only, one branch per repository per run, plain `fetch` adapters
instead of Octokit (no hidden retries of non-idempotent dispatches), code comments and test names in
French, UI and documentation in English.
