import type {
  DashboardBody,
  DashboardCoverage,
  DashboardDays,
  DashboardKpis,
  FailingWorkflow,
  KpiValue,
  RecentFailure,
  RepositoryStats,
  RunsBucket,
} from "./dashboardContract.ts";
import type { RunConclusion, RunStatus } from "./githubTypes.ts";
import { runSignalOf } from "./runStatus.ts";

/**
 * Calcul du tableau de bord à partir de ce qui a été lu chez GitHub : logique pure, sans réseau ni
 * horloge (le serveur passe `now`), testée seule. Les identités des personnes n'existent qu'ici, le
 * temps d'un calcul : seuls des comptes en sortent.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** Tailles d'affichage (une carte d'écran), pas des limites d'exploitation. */
const TOP_FAILING_WORKFLOWS = 5;
const RECENT_FAILURES = 10;

/** Une exécution lue pour les statistiques (adaptateur `githubActions.ts`). */
export interface StatsRun {
  readonly workflowId: number;
  readonly workflowName: string;
  readonly workflowPath: string;
  readonly branch: string | null;
  readonly event: string;
  readonly status: RunStatus;
  readonly conclusion: RunConclusion | null;
  readonly htmlUrl: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly updatedAt: string;
}

/** Un commit lu pour les statistiques ; `person` vient de `personOf` (`null` : robot, ou personne). */
export interface StatsCommit {
  readonly oid: string;
  readonly committedAt: string;
  readonly person: string | null;
}

/** Ce qui a été lu pour un dépôt (service `dashboardCollector.ts`), plafonds atteints compris. */
export interface RepositoryCollection {
  readonly name: string;
  readonly htmlUrl: string;
  readonly runs: { readonly current: readonly StatsRun[]; readonly previous: readonly StatsRun[]; readonly capped: boolean };
  readonly branches: { readonly total: number; readonly capped: boolean };
  readonly commits: { readonly items: readonly StatsCommit[]; readonly capped: boolean };
}

/** Bornes des deux périodes, en millisecondes depuis l'époque Unix (UTC). */
export interface DashboardWindow {
  readonly days: DashboardDays;
  readonly bucket: "day" | "week";
  readonly from: number;
  readonly to: number;
  readonly previousFrom: number;
  readonly previousTo: number;
  readonly bucketStarts: readonly number[];
}

/**
 * La période en cours commence à minuit UTC (7 et 30 jours) ou un lundi à minuit UTC (90 : 13 semaines
 * ISO) et finit maintenant. La précédente a la MÊME durée écoulée, une période plus tôt : un jour ou une
 * semaine en cours, incomplets, se comparent à la même portion d'avant, jamais à une période entière.
 */
export function windowOf(days: DashboardDays, now: number): DashboardWindow {
  const midnight = Math.floor(now / DAY_MS) * DAY_MS;
  const weekly = days === 90;
  const step = weekly ? WEEK_MS : DAY_MS;
  const count = weekly ? 13 : days;
  const daysSinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  const lastStart = weekly ? midnight - daysSinceMonday * DAY_MS : midnight;
  const from = lastStart - (count - 1) * step;
  const length = count * step;
  return {
    days,
    bucket: weekly ? "week" : "day",
    from,
    to: now,
    previousFrom: from - length,
    previousTo: now - length,
    bucketStarts: Array.from({ length: count }, (_, index) => from + index * step),
  };
}

/**
 * Une personne = son login GitHub ; sans compte lié, son e-mail en minuscules, et l'adresse
 * `<id>+<login>@users.noreply.<hôte>` redonne le login. Les robots (`…[bot]`) ne comptent pas, les
 * co-auteurs non plus (seul l'auteur du commit). `null` quand il n'y a personne à compter.
 */
export function personOf(author: { readonly login: string | null; readonly email: string | null }): string | null {
  const email = author.email?.trim().toLowerCase() || null;
  const noreplyLogin = email ? (/^(?:\d+\+)?([^@]+)@users\.noreply\./.exec(email)?.[1] ?? null) : null;
  const login = (author.login ?? noreplyLogin)?.toLowerCase() ?? null;
  if (login) return login.endsWith("[bot]") ? null : login;
  return email;
}

export interface DashboardInput {
  readonly org: string;
  readonly window: DashboardWindow;
  readonly generatedAt: number;
  readonly repositories: readonly RepositoryCollection[];
  /** Couverture connue du collecteur ; le reste (lus, plafonds atteints) se déduit des dépôts lus. */
  readonly coverage: Omit<DashboardCoverage, "read" | "runsCapped" | "commitsCapped" | "branchesCapped">;
}

export function buildDashboard(input: DashboardInput): DashboardBody {
  const { window, repositories } = input;
  const namesWhere = (test: (repository: RepositoryCollection) => boolean) =>
    repositories.filter(test).map((repository) => repository.name);
  const coverage: DashboardCoverage = {
    ...input.coverage,
    read: repositories.length,
    runsCapped: namesWhere((repository) => repository.runs.capped),
    commitsCapped: namesWhere((repository) => repository.commits.capped),
    branchesCapped: namesWhere((repository) => repository.branches.capped),
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    org: input.org,
    days: window.days,
    bucket: window.bucket,
    period: { from: iso(window.from), to: iso(window.to) },
    previousPeriod: { from: iso(window.previousFrom), to: iso(window.previousTo) },
    generatedAt: iso(input.generatedAt),
    kpis: kpisOf(repositories, window, coverage),
    timeline: timelineOf(window, repositories.flatMap((repository) => repository.runs.current)),
    repositories: repositories.map((repository) => repositoryStatsOf(repository, window)),
    failingWorkflows: failingWorkflowsOf(repositories),
    recentFailures: recentFailuresOf(repositories),
    coverage,
  };
}

type RunClass = "success" | "failed" | "other";

/** Réussie, échouée (échec, délai dépassé, échec au démarrage), ou autre (annulée, en cours…). */
function classOf(run: StatsRun): RunClass {
  const { signal } = runSignalOf(run);
  return signal === "success" || signal === "failed" ? signal : "other";
}

interface RunTotals {
  success: number;
  failed: number;
  other: number;
  durationSeconds: number;
  timedRuns: number;
}

function totalsOf(runs: readonly StatsRun[]): RunTotals {
  const totals: RunTotals = { success: 0, failed: 0, other: 0, durationSeconds: 0, timedRuns: 0 };
  for (const run of runs) {
    const kind = classOf(run);
    totals[kind] += 1;
    const seconds = kind === "other" ? null : durationOf(run);
    if (seconds !== null) {
      totals.durationSeconds += seconds;
      totals.timedRuns += 1;
    }
  }
  return totals;
}

/** Durée approximative d'une exécution terminée : `updated_at − run_started_at`, en secondes. */
function durationOf(run: StatsRun): number | null {
  if (run.status !== "completed" || !run.startedAt) return null;
  const seconds = (Date.parse(run.updatedAt) - Date.parse(run.startedAt)) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

const averageOf = (totals: RunTotals): number | null =>
  totals.timedRuns > 0 ? totals.durationSeconds / totals.timedRuns : null;

const successRateOf = (totals: RunTotals): number | null =>
  totals.success + totals.failed > 0 ? totals.success / (totals.success + totals.failed) : null;

function peopleIn(commits: readonly StatsCommit[], from: number, to: number): Set<string> {
  const people = new Set<string>();
  for (const commit of commits) {
    const at = Date.parse(commit.committedAt);
    if (commit.person && at >= from && at <= to) people.add(commit.person);
  }
  return people;
}

/**
 * Une comparaison n'est donnée que si les deux périodes sont lues en entier : un dépôt illisible ou
 * pas lu à temps, un plafond atteint, et l'écart ne dirait plus rien de vrai.
 */
function kpisOf(repositories: readonly RepositoryCollection[], window: DashboardWindow, coverage: DashboardCoverage): DashboardKpis {
  const current = totalsOf(repositories.flatMap((repository) => repository.runs.current));
  const previous = totalsOf(repositories.flatMap((repository) => repository.runs.previous));
  const commits = repositories.flatMap((repository) => repository.commits.items);
  const complete = coverage.unreadable.length === 0 && coverage.notCollected.length === 0;
  const runsComparable = complete && coverage.runsCapped.length === 0;
  const commitsComparable = complete && coverage.commitsCapped.length === 0 && coverage.branchesCapped.length === 0;
  const pair = (now: number | null, before: number | null, comparable: boolean): KpiValue => ({
    current: now,
    previous: comparable ? before : null,
  });
  return {
    committers: pair(
      peopleIn(commits, window.from, window.to).size,
      peopleIn(commits, window.previousFrom, window.previousTo).size,
      commitsComparable,
    ),
    successfulRuns: pair(current.success, previous.success, runsComparable),
    failedRuns: pair(current.failed, previous.failed, runsComparable),
    successRate: pair(successRateOf(current), successRateOf(previous), runsComparable),
    averageDurationSeconds: pair(averageOf(current), averageOf(previous), runsComparable),
    branches: repositories.reduce((sum, repository) => sum + repository.branches.total, 0),
  };
}

function timelineOf(window: DashboardWindow, runs: readonly StatsRun[]): RunsBucket[] {
  const step = window.bucket === "week" ? WEEK_MS : DAY_MS;
  const buckets = window.bucketStarts.map((start) => ({ start: new Date(start).toISOString(), success: 0, failed: 0, other: 0 }));
  for (const run of runs) {
    const bucket = buckets[Math.floor((Date.parse(run.createdAt) - window.from) / step)];
    if (bucket) bucket[classOf(run)] += 1;
  }
  return buckets;
}

function repositoryStatsOf(repository: RepositoryCollection, window: DashboardWindow): RepositoryStats {
  const totals = totalsOf(repository.runs.current);
  return {
    name: repository.name,
    htmlUrl: repository.htmlUrl,
    success: totals.success,
    failed: totals.failed,
    other: totals.other,
    branches: repository.branches.total,
    committers: peopleIn(repository.commits.items, window.from, window.to).size,
    averageDurationSeconds: averageOf(totals),
  };
}

/** Les workflows qui échouent le plus sur la période ; à égalité, la plus forte proportion d'échecs. */
function failingWorkflowsOf(repositories: readonly RepositoryCollection[]): FailingWorkflow[] {
  const byWorkflow = new Map<string, FailingWorkflow & { latestAt: string }>();
  for (const repository of repositories) {
    for (const run of repository.runs.current) {
      const key = `${repository.name}\n${run.workflowId}`;
      const entry = byWorkflow.get(key) ?? {
        repository: repository.name,
        workflow: run.workflowName,
        path: run.workflowPath,
        failed: 0,
        runs: 0,
        latestFailureUrl: "",
        latestAt: "",
      };
      const failed = classOf(run) === "failed";
      const latest = failed && run.createdAt > entry.latestAt;
      byWorkflow.set(key, {
        ...entry,
        runs: entry.runs + 1,
        failed: entry.failed + (failed ? 1 : 0),
        latestAt: latest ? run.createdAt : entry.latestAt,
        latestFailureUrl: latest ? run.htmlUrl : entry.latestFailureUrl,
      });
    }
  }
  return [...byWorkflow.values()]
    .filter((entry) => entry.failed > 0)
    .sort((a, b) => b.failed - a.failed || b.failed / b.runs - a.failed / a.runs || a.repository.localeCompare(b.repository))
    .slice(0, TOP_FAILING_WORKFLOWS)
    .map(({ latestAt: _latestAt, ...entry }) => entry);
}

function recentFailuresOf(repositories: readonly RepositoryCollection[]): RecentFailure[] {
  return repositories
    .flatMap((repository) =>
      repository.runs.current.filter((run) => classOf(run) === "failed").map((run) => ({ repository: repository.name, run })),
    )
    .sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt))
    .slice(0, RECENT_FAILURES)
    .map(({ repository, run }) => ({
      repository,
      workflow: run.workflowName,
      branch: run.branch,
      event: run.event,
      label: runSignalOf(run).label,
      at: run.createdAt,
      htmlUrl: run.htmlUrl,
    }));
}
