# Security and data — EasyActions (codename Pipliner)

What EasyActions stores, how sign-in and sessions work, and what happens on each security-relevant
failure. Verified against the code on 25 September 2026, at the end of milestone **M8** (statistics
dashboard).
The overall design is in [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. What EasyActions stores

Since M5, Pipliner owns one SQLite database (`DATABASE_PATH`, through `bun:sqlite`, built into Bun).
Every query lives in `server/repositories/` (one module per table).

| Table | Holds | Personal data | Erased by |
|---|---|---|---|
| `users` | GitHub numeric id, login, avatar URL, role, first and last sign-in | login, avatar | "Delete my data" |
| `sessions` | one row per signed-in browser: SHA-256 of the cookie, dates, **encrypted** GitHub access and refresh tokens, token generation | the tokens (encrypted) | cascade with the user; expiry; sign-out |
| `audit_events` | the history: time, action, actor id, target id | the two ids | ids set to `NULL` when the user is erased; rows deleted after `AUDIT_RETENTION_DAYS` |
| `second_factors` (M6) | the authenticator app's secret (**encrypted**), a pending secret during a setup or change, last accepted time step, wrong-code counters and lock | the secret (encrypted) | cascade with the user; reset by an admin (Users page) or the CLI |
| `recovery_codes` (M6) | one-time recovery codes, **HMAC-hashed**, and when each was used | — | cascade with the user; replaced when new codes are made |
| `settings` (M7) | the website settings: GitHub addresses, the GitHub App's client ID and **encrypted** client secret, limits; when each changed and by whom | who changed it (id) | the id is set to `NULL` when that user is erased |

- Times are seconds since the Unix epoch, UTC.
- The browser holds the session cookie (a random id), during a sign-in the 10-minute flow cookie, and
  one preference in its local storage: `easyactions.lastOrg`, the login of the last organization opened,
  so it is selected by default. It is an organization's name, not personal data (only organizations are
  listed, `server/adapters/githubRepos.ts`), and it does not outlive the session: deleted at sign-out
  and "Delete my data" (`forgetSession`), and whenever the sign-in page opens without a session (ended
  or expired, `app/pages/login.ts`), so the next person on a shared browser never sees it. The web app
  keeps its selection, the runs it follows and a 60-second read cache in memory.
- The logs hold no personal data at all (§9).
- **The dashboard (M8) stores nothing in the database.** Commit authors' logins and e-mails exist only
  in server memory during one collection; the result kept in memory for "Dashboard: seconds a result is
  reused" holds counts and repository, workflow and branch names — no identity — and is cleared at
  sign-out, erasure and every settings change ([DASHBOARD.md §4 and §6](DASHBOARD.md#6-personal-data)).

## 2. The database file

- **Schema changes only through migrations** (`server/db/migrations/`), applied by
  `bun run db:migrate` with the server stopped (bun:sqlite's lock wait would block the server). Each
  migration has a rollback (`bun run db:rollback`, which asks for `--yes` when it deletes data),
  tested by `tests/unit/migrations.test.ts`. The version lives in `PRAGMA user_version`, written in the
  migration's own transaction. The server never migrates: at boot it only checks the version and
  **refuses to start** when the file is missing or out of date (`server/db/database.ts`).
- **File permissions.** SQLite has no file-mode option, and `DATABASE_PATH` may point anywhere, so
  the server and the commands set the process mask to `077` (files `0600`), and `db:migrate` creates
  the folder `0700`. `PRAGMA secure_delete` overwrites deleted rows; an erasure ends with a WAL
  checkpoint (`TRUNCATE`).
- **Backups** of the file contain encrypted tokens and GitHub logins: keep them private (`0600`) and
  delete them on the same schedule as the history.
- **One Bun process only.** The coordination of token refreshes (§5) is in memory.

## 3. Sign-in and sessions ("stay signed in")

- **GitHub App web flow** with a random `state` (constant-time comparison) and PKCE S256, both in an
  encrypted, HttpOnly, 10-minute flow cookie (key derived from `SESSION_SECRET`). `returnTo` must be a
  path of our own origin, otherwise `/orgs` — no open redirect.
- The app must have "Expire user authorization tokens" enabled: GitHub then gives an 8-hour access
  token **and** a 6-month refresh token. A token without them is refused and revoked (`error=config`).
- **The callback opens the session** in one transaction (`server/services/sessions.ts`): the user is
  created or updated, this browser's previous session is closed, the new session is created (it ends
  after `SESSION_MAX_DAYS`, or earlier if GitHub's refresh token does), sessions beyond
  `SESSIONS_PER_USER_MAX` are closed from the oldest, and `session.create` is written to the history.
  The GitHub tokens of closed sessions are then revoked (fail open).
- **The cookie** holds 32 random bytes: `HttpOnly; SameSite=Lax; Path=/`, `Max-Age` = the session's
  lifetime, `Secure` and the `__Host-` prefix when `APP_ORIGIN` is https. The database keeps only its
  SHA-256: the table alone lets nobody impersonate anybody.
- **Loopback caveat.** On `http://127.0.0.1`, browsers do not separate cookies by port: any other web
  app served on 127.0.0.1 receives the EasyActions cookie. Do not run untrusted local web apps next
  to it; use https on a shared machine.
- **Each request** reads the session row (missing or expired → `401`); "last seen" is written at most
  once a minute.

## 4. The daily code (two-step verification, M6)

- **What it is.** Once a day (`TWO_FACTOR_EVERY_HOURS`), each browser must give the 6-digit code of an
  authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 2FAS, 1Password…). TOTP,
  RFC 6238, written in `server/auth/totp.ts` on `node:crypto` and checked against the RFC's official
  test vectors. Fixed settings: SHA-1, 6 digits, 30-second steps — Google Authenticator ignores any
  other value. Secrets are 160 bits, encrypted in the database.
- **The guard** (`server/middleware/secondFactor.ts`) sits after the session guard on every `/api`
  route: without a code accepted within `TWO_FACTOR_EVERY_HOURS` for *this* session, the answer is
  `403 second_factor_required` and the app opens `/two-factor`. Only five exact routes are open before
  the code — `GET /api/session` and the four setup/verify routes — and a test walks every registered
  route, so a new one cannot forget the guard. `POST /auth/logout` stays available.
- **Setup:** at the first sign-in the page shows a QR code (`uqr`, a plain SVG of rectangles served
  as a same-origin image, never cached) and the key as text; the first correct code confirms it and
  shows **10 recovery codes once** (10 characters each, HMAC-hashed with a key derived from
  `DATA_ENCRYPTION_KEY`). The first setup trusts the GitHub sign-in.
- **Changing the app** needs a session that already gave today's code **and** a current code: a stolen
  GitHub cookie alone cannot replace someone's phone. The old app keeps working until the new one is
  confirmed. New recovery codes also need a current code.
- **One checker** (`server/services/twoFactor.ts`) for the daily code, recovery codes and the admin
  confirmations (§7): a code is accepted once (the last accepted step is stored and the update is
  conditional), ±1 step of clock drift, constant-time comparison. So right after giving the daily
  code, a confirmation needs the *next* code; the dialog says so.
- **Lock-out:** after `TWO_FACTOR_MAX_ATTEMPTS` wrong codes, codes are locked for
  `TWO_FACTOR_LOCK_MINUTES` (`429 code_locked` with `Retry-After`); each following lock lasts twice as
  long, 24 hours at most; a correct code resets it.
- **A new session id after each accepted code:** the pre-code cookie stops working (no session
  fixation); the tokens are re-encrypted for the new row.
- **Rescue:** an admin removes someone's app on the Users page (§7), or on the server
  `bun run users:reset-two-factor <login>` (or `--all` after changing the data key); the app and the
  codes are removed and every session of that person must set up again.

| Failure | Direction |
|---|---|
| No code today / no app yet | **Closed**: `403 second_factor_required` |
| Wrong, reused or malformed code | **Closed**: `400 invalid_code`, counted |
| Too many wrong codes | **Closed**: `429 code_locked` until the lock ends |
| Change of app without today's code or a current code | **Closed**: `403` |
| Stored secret cannot be decrypted (key changed) | **Closed**: `403` "ask an administrator"; the CLI reset is the way out |
| Copying the codes to the clipboard is refused by the browser | **Open**: the list and the download stay available |

## 5. GitHub tokens

- **Encrypted at rest** (`server/security/dataCipher.ts`): AES-256-GCM, key = HKDF-SHA256 of
  `DATA_ENCRYPTION_KEY`, random 12-byte IV, associated data = purpose + session row, stored as
  `v1.<base64url>`. A value copied into another row or column does not decrypt.
- **Refresh** (`server/services/githubTokens.ts`). Refreshing a GitHub user token invalidates the old
  access token and the old refresh token at once. So:
  - one refresh at a time per session; requests arriving meanwhile wait for the same one;
  - an early refresh (under 30 minutes left) happens only when no other request of the session is
    running; below 2 minutes it is forced; an operation that needs more time asks for it (a bulk run
    asks for 10 minutes before its first dispatch);
  - the new tokens and `token_generation + 1` are saved in one conditional update.
- **GitHub answers 401 during a request** (`server/middleware/session.ts`): if the request used the
  session's current token, the session is closed and the app sends the user to sign in again; if the
  session was refreshed *during* the request, that 401 says nothing about the session, which stays
  open, and the request answers `502` ("try again").

| Refresh outcome | Direction |
|---|---|
| Refresh token refused (expired, reused, revoked) | **Closed**: session deleted, `401` |
| `incorrect_client_credentials` (the App's own secret is wrong) | **Closed** for the request (`502`); every session kept — a wrong secret must not sign everybody out |
| GitHub unreachable or too slow | **Closed** for the request (`502`); session kept |
| Answer without a new refresh token | **Closed**: session deleted, the token obtained revoked |
| Session closed while the refresh ran (sign-out) | **Closed**: `401`, the token obtained revoked |
| Stored token cannot be decrypted (key changed, tampering) | **Closed**: session deleted, `401` — never a `500` |

- **Changing `DATA_ENCRYPTION_KEY`** makes every stored token unreadable: everybody signs in again.
- **Revocation** uses `DELETE /applications/{client_id}/token` with the app's client ID and secret
  (Basic). It fails open (logged `auth.revoke_failed`): the session is already gone on our side and the
  access token expires within 8 hours. Whether it also revokes the refresh token is not documented by
  GitHub; our only copy is deleted anyway.

## 6. History

- Actions are owned by `domain/auditActions.ts`: `session.create`, `session.end`, `session.end_others`,
  `session.end_all`, `account.export`, `account.delete`, and since M6 `two_factor.enroll`,
  `two_factor.verify`, `two_factor.fail`, `two_factor.lock`, `two_factor.recovery_used`,
  `two_factor.recovery_regenerated`, `two_factor.reset` (the CLI writes it without an actor), since
  M7 `settings.update`, `settings.github_update`, `user.role_change`, `user.sign_out`, `user.remove`,
  and `settings.setup` (setup page) and `settings.reset` (`settings:setup-code --reset`), both without
  an actor. `settings.import` remains only for older rows (the removed `settings:import-env`). Admins
  read it on the History page (§7).
- Written in the **same transaction** as the action: if the history cannot be written, the action
  does not happen (fail closed).
- No personal data besides the actor and target ids; `detail` holds only the **names** of the
  settings a change touched — never a value, an id, a login or a secret — so nothing survives an
  erasure.
- Deleted after `AUDIT_RETENTION_DAYS`. The purge runs at start and at each sign-in (no timer:
  `bun --hot` would stack them). It fails open: logged as `db.purge_failed` and retried next time;
  expired sessions are refused on read in the meantime.

## 7. Settings and administration (M7)

- **Roles.** `users.role` is `member` or `admin`. The first admin is made on the server with
  `bun run users:promote <login>` (the person must have signed in once); `bun run users:demote <login>`
  undoes it. Admins get a **Settings** link to three pages: Settings, Users and History
  (`/settings`, `/settings/users`, `/settings/history`). Every `/api/admin/*` route sits behind the
  session, the daily code, and `requireAdmin` (`server/middleware/admin.ts`, `403` otherwise). The
  pages only show what the server allows.
- **What the website holds.** The GitHub connection (web address, API address, the GitHub App's
  client ID and secret) and the limits. `domain/settingsCatalog.ts` is their single owner: labels,
  ranges and defaults for the server's checks and for the forms. They live in the `settings` table and
  are **read on every request** (no copy in memory, so a server command is seen at once). The security
  values (sessions, daily code, history retention) stay in `.env`, where a website admin cannot weaken
  them.
- **First setup, in the browser — never in `.env`.** Without a readable GitHub connection (a new
  install, a cleared connection, or a secret unreadable after a `DATA_ENCRYPTION_KEY` change), the server
  starts in **setup mode** (`server/middleware/setupGate.ts`): every `/api` route answers
  `503 setup_required`, `/auth` sends to `/setup`, and only `/health` and three setup routes answer
  (`server/routers/setup.ts`, pinned by `tests/unit/secondFactorGate.test.ts`).
  - Testing and saving need a **setup code** from `bun run settings:setup-code`, run on the server. The
    code is its expiry plus an 80-bit HMAC-SHA256 tag (key derived from `DATA_ENCRYPTION_KEY` with its
    own HKDF label), checked in constant time, valid 30 minutes; nothing is stored. It is printed once on
    the operator's terminal, never logged. Without it, nobody can make the server call an address.
  - The setup page applies the same pairing, https and connection-test rules as below. Saving writes
    the connection (secret encrypted), history `settings.setup` with no actor, and closes any remaining
    session in the same transaction: its tokens could come from another app.
  - Once a connection works, the setup routes answer `404`: setup never overwrites a working
    connection. The first admin is still made on the server (`bun run users:promote`).
- **The GitHub connection decides where every user's token is sent.** Saving it therefore needs:
  - a current 6-digit code;
  - an API address that pairs with the web address (`domain/githubHosts.ts`): github.com →
    api.github.com, `<name>.ghe.com` → `api.<name>.ghe.com`, any other host → `<origin>/api/v3`.
    Loopback pairs only with loopback;
  - https (http only on loopback, for the local fake GitHub);
  - a passing connection test: `GET {api}/meta`, without any token, redirects not followed
    (`server/adapters/githubConnection.ts`);
  - the client secret, typed again every time. It is stored encrypted like the tokens and never sent
    back: the page only knows whether one is saved.

  Changing an address or the client ID **signs everybody out**, the admin included. The tokens are
  then revoked with the previous connection, the one that issued them (fail open). A new secret alone
  keeps the sessions.
- **Accepted risk:** an admin is trusted like the server's operator, since they can point EasyActions
  at another GitHub. The history records who did it, and everybody is signed out.
- **Recovery** when a wrong connection locks everybody out: `bun run settings:setup-code --reset` clears
  the connection and ends every session in one transaction (history `settings.reset`), without
  revocation (the cleared connection may be the broken one; the access tokens expire within 8 hours),
  then prints a setup code: the server is back in setup mode.
- **Users page:** role, daily code on or off, signed-in browsers, last sign-in. Making or removing an
  admin, removing someone's authenticator app, and deleting someone's data all need a current code.
  Signing someone out does not, since it only ends sessions. EasyActions always keeps one admin: the
  last one cannot be demoted or deleted. Deleting someone erases their EasyActions data like "Delete
  my data" (§8). GitHub still decides who has access (organization membership, the app's
  installation), so they can sign in again. Your own row has no sign-out or delete: the Account page
  does both.
- **History page:** newest first, 50 per page, filtered by action.

| Failure | Direction |
|---|---|
| Not an admin | **Closed**: `403` |
| Sensitive admin action with a wrong, reused or missing code | **Closed**: `400 invalid_code` (counted), `429 code_locked` |
| Invalid limit, addresses that do not pair, failed connection test | **Closed**: `400`, nothing saved |
| Demoting or deleting the last admin | **Closed**: `400` |
| No readable GitHub connection | **Closed** for every feature (setup mode): `503 setup_required`, `/auth` → `/setup` |
| Setup code wrong, expired or missing | **Closed**: `400 invalid_code`, nothing fetched, nothing saved |
| Setup attempted once a connection works | **Closed**: `404` |
| POST to the setup routes without the app's exact `Origin` | **Closed**: `403` |
| Settings unreadable while computing the CSP's image sources | **Closed**: no outside image |

## 8. Export and erasure — the Account page (`/account`)

- **Sessions:** every browser where you are signed in (signed in, last active, ends); "Sign out other
  sessions"; "Sign out everywhere". Closed sessions have their GitHub tokens revoked (fail open).
- **Download my data:** `GET /api/account/export` sends a JSON file with your profile, your sessions'
  dates and your history — no token, ciphertext or hash. It writes `account.export` to the history.
- **Delete my data:** after you retype your GitHub login, `account.delete` is written, then your
  sessions and your user row are deleted (your history entries lose their ids), the WAL is
  checkpointed, and your GitHub tokens are revoked (fail open). Your GitHub account and repositories
  are not touched; you may sign in again later — access itself is governed by GitHub (organization
  membership and the app's installation).

## 9. Other protections

- **CSRF:** every POST, PUT, PATCH and DELETE must carry the app's exact `Origin`
  (`server/middleware/originGuard.ts`), plus `SameSite=Lax` cookies. `/api` answers are
  `Cache-Control: no-store`.
- **Bulk runs:** the confirmation dialog lists every target; when any target is on its repository's
  default branch (production for MaskAI), the Run button stays disabled until the organization's name
  is typed. The dialog is only a convenience: the server re-validates names, branch, workflow id, cap,
  session and `Origin`. The browser selects repositories and workflows, never raw GitHub URLs. A
  dispatch is never retried.
- **Headers** (`hono/secure-headers`, `server/app.ts`), on every Hono response including the
  production page: CSP `default-src 'self'; base-uri 'none'; font-src 'self' data:; form-action 'self';
  frame-ancestors 'none'; img-src 'self' <GitHub avatars>; object-src 'none'`, `X-Frame-Options: DENY`,
  `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`. A "Run pipelines" button must
  never be framable. The avatar sources are computed on each response from the GitHub web address in
  the settings. `font-src data:` exists because Bun's CSS bundler inlines the fonts as `data:`
  URLs; they come from our own bundle.
- **Logging** (`server/config/logger.ts`): one JSON line per event, allow-list of fields copied one by
  one (`route`, `method`, `status`, `durationMs`, `requestId`, `upstream`, `errName`, `errCode`). No
  error object, body, header, upstream URL, token, login, user id or other personal data. `console.*`
  is banned outside it (checked by a test).
- **Slow requests:** `HTTP_IDLE_TIMEOUT_SECONDS` replaces Bun's 10-second idle timeout, which cut
  bulk runs waiting on GitHub (`listenOptions` in `server/app.ts`).
