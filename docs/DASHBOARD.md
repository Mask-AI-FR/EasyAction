# Dashboard — EasyActions (codename Pipliner)

The statistics of one organization: people who committed, successful and failed pipeline runs,
branches, durations and failures, compared with the previous period. Verified against the code on
25 September 2026, at the end of milestone **M8**. The overall design is in
[ARCHITECTURE.md](ARCHITECTURE.md); stored data and security in [SECURITY.md](SECURITY.md).

- Web app: `/orgs/:org/dashboard?days=7|30|90` (30 by default), the first tab of an organization; the
  organization cards open it. `app/pages/dashboard.ts`, components in `app/components/dashboard/`.
- API: `GET /api/orgs/:org/dashboard?days=7|30|90`, plus `&fresh=1` for the Refresh button
  (`domain/dashboardContract.ts`). Collection: `server/services/dashboardCollector.ts`; calculation:
  `domain/dashboardStats.ts` (pure, tested alone); GitHub reads: `server/adapters/githubActions.ts`,
  `githubRepos.ts`, `githubCommits.ts`.

## 1. What the page shows

1. The period filter (7 / 30 / 90 days), Refresh, the dates covered and the time of the calculation.
2. Six tiles: people who committed, successful runs, failed runs, success rate, average duration and
   branches. Each tile except Branches shows the change against the previous period.
3. Pipeline runs over time: stacked columns (successful, failed, other) per UTC day, or per week for 90 days.
4. By repository: runs (stacked), branches, people who committed, average duration. The 10 first
   repositories as bars; the table view lists every repository.
5. Top failing workflows (5), with a link to each one's latest failure; recent failures (10), with links.
6. What was read: repositories read, archived, beyond the limit, and every gap by name (§5).

## 2. Periods and comparison

- **7 and 30 days**: from midnight UTC, 6 or 29 days ago, until now. **90 days**: the last 13 ISO weeks
  (starting on Monday, UTC), the current week included, so 85 to 91 days.
- **The previous period has the same elapsed length, one period earlier**: an unfinished day or week is
  compared with the same portion before it, never with a whole one.
- **Change**: counts in percent (as a count when the previous value is 0); success rate in percentage
  points; duration as a signed duration. A tile shows "—" when there is nothing to compare: no value in
  the previous period, or data missing or capped (§5).

## 3. How each figure is computed

| Figure | Rule |
|---|---|
| Runs | `GET /repos/{owner}/{repo}/actions/runs?created=<from>..<to>`, once per period, every event (push, schedule, pull request, dispatch). Classified by `domain/runStatus.ts`: failed = `failure`, `timed_out`, `startup_failure`; other = cancelled, skipped, neutral, stale, action required, running or queued |
| Success rate | successful ÷ (successful + failed) |
| Average duration | mean of `updated_at − run_started_at` over completed successful and failed runs. Approximate: a re-run or a late update stretches it |
| Branches | the exact count GitHub gives today (GraphQL `refs.totalCount`); there is no history of branches, so no comparison |
| People who committed | distinct authors of commits on **all branches** (below) |
| Repositories | not archived, most recently pushed first, up to "Dashboard: repositories read" |

**Commits on all branches**, per repository:

1. The default branch: `history(since:)`, 100 commits per request.
2. Every other branch whose last commit falls in the two periods: `compare(headRef:)` from the default
   branch, which returns only the commits that branch **adds** (the 100 most recent). Reading each
   branch's whole history would repeat the default branch's commits (over 1,000 on one busy branch).
3. Each commit counted once (by commit id), in the period of its commit date (`committedDate`).

A **person** is a GitHub login; without a linked account, the e-mail in lowercase, and
`<id>+<login>@users.noreply.<host>` is read as that login. Bots (`…[bot]`) are not counted, nor
co-authors. A repository not pushed since the start of the previous period is skipped: no commit can
fall in the two periods.

## 4. Cost, limits and memory

- **Requests per repository**: 2 run lists (100 runs per page), 1 branch query per 100 branches, 1
  history query per 100 commits, 1 comparison query per 10 active branches. Each GraphQL query costs 1
  point, ten comparisons of 100 commits included (measured on the API on 25 September 2026). 4
  repositories are read at a time (12 requests in flight at most).
- **Limits** — on the Settings page, the settings named "Dashboard: …": repositories read (1–500, 50),
  runs read per repository and period (100–1,000, 500; GitHub lists 1,000 at most), commits read per
  repository (100–10,000, 2,000), seconds a result is reused (0–3,600, 300), seconds allowed to read
  GitHub (10–200, 60). Also used: "Branches read per repository" and "Repositories read per
  organization".
- **Time budget**: the "seconds allowed" setting, but never more than `HTTP_IDLE_TIMEOUT_SECONDS` − 5 s −
  the GitHub timeout, so the answer always arrives before Bun closes an idle connection. The GitHub
  token is asked to stay valid for the budget plus 60 s (a refresh during the collection would kill it).
- **Memory**: a result is reused for "seconds a result is reused", per person, organization and period;
  Refresh reads GitHub again. One collection at a time per browser session, organization and period.
  The memory is cleared when the person signs out (any browser), signs out everywhere, erases their
  data, or is signed out or removed by an admin, and at every settings change. Access to the
  organization is checked at GitHub on **every** call, even when the result comes from memory. The
  memory lives in the one Bun process (see ARCHITECTURE.md): a restart empties it.

## 5. Partial data — a written exception

Everywhere else EasyActions never shows partial data. Here, one unreadable repository must not hide a
whole organization, so:

| Failure | Direction |
|---|---|
| The repository list cannot be read | **Closed**: error panel, nothing shown |
| GitHub rate limit, or the token refused, on any repository | **Closed**: everything stops, `429` (with the wait) or sign-in again; nothing kept in memory |
| One repository refused or failed (not found, forbidden, timeout, error) | **Open**: named under "Could not be read", the others counted |
| Time budget reached | **Open**: the remaining repositories named under "Not read in time" |
| A limit reached (runs, commits, branches) | **Open**: named, with the setting to raise |
| A branch deleted while it is read | **Open**: skipped |
| Refresh fails while figures are on screen | **Open**: the previous figures stay, dated, with the reason |

Whenever something is missing or capped, the comparison with the previous period is not given ("—"): a
trend is never computed on incomplete data.

## 6. Personal data

Commit authors' logins and e-mails exist only in server memory, during one collection. The answer and
the memory hold counts, repository, workflow and branch names, and run links — no identity. Nothing
from the dashboard is written to the database, and the log line `dashboard.collected` holds only the
route and the duration. A test checks that no login or e-mail appears in the answer.

## 7. Display

- **Chart.js 4.5.1**, bar charts only (the rest of Chart.js is not bundled): `app/components/dashboard/bar-chart.ts`.
- **Colours** (`app/services/chart-theme.ts`), checked with the dataviz validator on 25 September 2026:
  successful `--chart-series-in` (blue), failed `--chart-series-out` (orange), other `--text-tertiary`
  (gray). Blue and orange, not the green and red of the status badges: red and green are the pair most
  confused by colour-blind readers. Separation: ΔE 24.7 (light) and 26.8 (dark) between successful and
  failed; 13.1 and 15.5 between failed and other; contrast of at least 3:1 on both surfaces. The gray
  fails the validator's chroma floor on purpose: "Other" is meant to be neutral. Single-measure charts
  use `--chart-series-in`.
- **Never colour alone**: legends carry an icon (✓ ✕ −) and the totals; every chart has a Table view;
  tooltips list every series at the point, value first.
- Bars of 24 px at most with a 4 px rounded end and a square base, 2 px of surface between stacked
  segments, fine gridlines; no animation under `prefers-reduced-motion`; charts redraw when the theme
  changes (`html.dark`, `data-theme`, density).
- **Chart heights are set through the CSSOM**, never a `style` attribute: the CSP blocks style
  attributes (Lit's `styleMap` writes one on first render — found by the browser test, now banned by
  `tests/unit/designRules.test.ts`).
- The tile is ported from MaskAI-Frontend `components/admin/KPICard.tsx:120-183` (commit `12b962f`),
  with proportional figures for its large value and without the count-up animation or sparkline.
