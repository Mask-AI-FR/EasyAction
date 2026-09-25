# Pipliner — working rules

These rules apply on top of `~/.claude/CLAUDE.md`. The architecture and its reasons live in
`docs/ARCHITECTURE.md`, stored data and security in `docs/SECURITY.md`; read them before changing
anything.

## Stack and checks

- Bun, Hono, zod, TypeScript 5.9.3; web app = TiniJS (`@tinijs/core`, `@tinijs/router`,
  `@tinijs/store`) on Lit; Tailwind v4 via `bun-plugin-tailwind`. Check `package.json` before assuming a
  library exists. Every version is pinned exactly; never add a dependency without approval.
- Check gate, all must pass:
  `bun install --frozen-lockfile && bun run typecheck && bun test && bun run build && bun audit --audit-level=high`
- Never run a bare `bun install` once `bun.lock` exists unless a dependency change was approved.

## Conventions

- Code comments and test names in **French**; UI copy, docs and this file in **English**; log event
  names in dotted English (`http.unhandled_error`).
- Env (server and security values only): declare in `server/schemas/env.schema.ts`, read in
  `server/config/env.ts`, document in `.env.example`. A missing variable stops the boot; no fallback
  value pointing at a real machine.
- Website settings (GitHub connection, limits) are owned by `domain/settingsCatalog.ts`, stored in the
  `settings` table and read on every request through `deps.settings()`; never cache them, never put
  them back in env. Their `.env` names serve only `bun run settings:import-env`.
- Admin routes live under `/api/admin/*` (behind `requireAdmin`); a sensitive admin write also calls
  `checkStepUpCode` and records its history action in the same transaction.
- Errors: `{ detail: { code, message } }`, types owned by `domain/apiContract.ts`. Never send an
  upstream (GitHub) message or body to the browser.
- Logging only through `server/config/logger.ts` (allow-listed fields). No `console.*` anywhere else.

## Data (SQLite)

- `bun:sqlite` only. Schema changes only through a new `server/db/migrations/000N_*.ts` with a tested
  `down`, added to the ordered list in `server/db/migrator.ts`; applied by `bun run db:migrate`, never
  at boot (the server only checks the version). SQL lives only in `server/repositories/`, one module
  per table.
- Secrets stored in the database go through `server/security/dataCipher.ts` (AAD = purpose + row).
- Every table holding personal data is reachable by the Account page's export and erasure; history
  actions are owned by `domain/auditActions.ts` and written in the same transaction as the action.
- Tests use `tests/support/testDatabase.ts` (in memory) and `tests/support/sessions.ts`; never the
  `DATABASE_PATH` file. `signInDirectly` gives a session that already gave today's code.
- Every `/api` route needs today's 6-digit code except the exact list in
  `server/middleware/secondFactor.ts`; widening that list is a security decision (a test pins it).
- `app/` never imports `server/`; shared types and pure logic go in `domain/`.

## TiniJS and the design system

- Components use shadow DOM: every `@App`/`@Layout`/`@Page`/`@Component` class declares
  `static override styles = [sharedSheet]`. Never override `createRenderRoot`; never use `@Subscribe`.
- Only MASKAI semantic classes (`bg-surface`, `text-text-primary`, `border-border-control`,
  `shadow-card`…). No stock palette (`bg-white`, `text-gray-*`…), no `dark:` variants, no
  `rounded-control`/`rounded-card` (use `rounded-md`/`rounded-lg`), no class names built at runtime.
  Row density: `h-(--row-height)`, `py-(--row-padding-y)`, `px-(--row-padding-x)`.
- `app/styles/globals.css` is a verbatim copy of MaskAI-Frontend's: do not edit it; only its header
  and the marked font block at the end are ours.
- No `style` attribute and no Lit `styleMap` (the CSP blocks style attributes; a test bans them): set
  sizes through the CSSOM (`element.style.height = …`) or with classes.
- Charts only through `app/components/dashboard/bar-chart.ts` (Chart.js 4.5.1, bars registered);
  colours only from `app/services/chart-theme.ts`, which reads the MASKAI tokens. How each dashboard
  figure is computed: `docs/DASHBOARD.md` — keep it true when the collector or the calculation changes.
- The product name is EasyActions (codename Pipliner in code, cookies, `/health`, logs). Brand colours
  live only in `app/styles/theme-easyactions.css` (overrides of MASKAI brand tokens, contrast-tested by
  `tests/unit/theme.test.ts`); never write a brand colour in a component. The logo is `app/ui/brand-mark.ts`.

## Safety

- Every MaskAI workflow deploys when dispatched (`main` = production). Never dispatch one during
  development or tests; use a sandbox repository with a no-op `workflow_dispatch` workflow.
- Never write, print or log a secret, token or cookie value. Use `<TO_PROVIDE>` placeholders and ask.
- Work milestone by milestone; stop after each with the check output for the maintainer's review.
