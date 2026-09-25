import type { DashboardBody, DashboardDays } from "../../domain/dashboardContract.ts";
import {
  buildDashboard,
  personOf,
  windowOf,
  type DashboardWindow,
  type RepositoryCollection,
  type StatsCommit,
  type StatsRun,
} from "../../domain/dashboardStats.ts";
import type { RepoSummary } from "../../domain/githubTypes.ts";
import { runsCreatedBetween } from "../adapters/githubActions.ts";
import { GitHubApiError, type GitHubFailure, type RepoPath } from "../adapters/githubApi.ts";
import { branchOnlyCommits, BRANCHES_PER_COMPARISON, defaultBranchHistory, type AuthoredCommit } from "../adapters/githubCommits.ts";
import { listBranches, listInstallationRepos, type OrgInstallation, type RepoBranches } from "../adapters/githubRepos.ts";
import type { GitHubSettings, Limits } from "../config/env.ts";
import { logger } from "../config/logger.ts";

/**
 * Collecte du tableau de bord d'une organisation chez GitHub, au nom de l'utilisateur.
 * - Dépôts non archivés, les plus récemment poussés d'abord, jusqu'à `statsMaxRepos`, lus
 *   `REPOSITORIES_AT_ONCE` à la fois, avant une échéance (`deadline`) ; ceux qui restent sont
 *   « pas lus », nommés sous le tableau de bord.
 * - ÉCHEC FERMÉ sur une limite de débit ou un jeton refusé : tout s'arrête, l'erreur remonte, rien
 *   n'est gardé. ÉCHEC OUVERT pour un dépôt illisible : il est nommé, les autres sont comptés
 *   (exception écrite au principe « jamais de données partielles » : chaque manque est affiché).
 * - Un résultat est resservi `statsCacheSeconds` secondes à la même personne (clé : personne,
 *   organisation, période) ; une seule collecte à la fois par session, organisation et période.
 *   Un processus Bun unique (docs/ARCHITECTURE.md) : cette mémoire n'est pas partagée.
 */

/**
 * Dépôts lus en même temps ; chacun lance jusqu'à trois lectures à la fois, soit 12 requêtes en vol au
 * plus — loin des limites secondaires de GitHub sur les requêtes simultanées.
 */
const REPOSITORIES_AT_ONCE = 4;

/** Échecs qui arrêtent toute la collecte : les suivantes échoueraient de même. */
const STOPS_EVERYTHING: ReadonlySet<GitHubFailure> = new Set(["rate_limited", "unauthorized"]);

export interface DashboardRequest {
  readonly session: { readonly idHash: string; readonly userId: number };
  readonly installation: OrgInstallation;
  readonly days: DashboardDays;
  /** « Refresh » : relire GitHub même si un résultat récent est en mémoire. */
  readonly fresh: boolean;
  readonly github: GitHubSettings;
  readonly token: string;
  readonly limits: Limits;
  /** Instant (ms, époque Unix) après lequel plus aucune lecture n'est lancée. */
  readonly deadline: number;
}

interface CachedDashboard {
  readonly expiresAt: number;
  readonly body: DashboardBody;
}

export class DashboardCollector {
  private readonly cache = new Map<string, CachedDashboard>();
  private readonly running = new Map<string, Promise<DashboardBody>>();
  /** Incrémentés à chaque effacement : une collecte commencée avant n'est pas gardée en mémoire après. */
  private generation = 0;
  private readonly userGenerations = new Map<number, number>();

  dashboard(request: DashboardRequest): Promise<DashboardBody> {
    const scope = `${request.installation.org.login.toLowerCase()}:${request.days}`;
    const cacheKey = `${request.session.userId}:${scope}`;
    const hit = this.cache.get(cacheKey);
    if (!request.fresh && hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.body);
    const runKey = `${request.session.idHash}:${scope}`;
    const running = this.running.get(runKey);
    if (running) return running;
    const started = this.generationOf(request.session.userId);
    const collection = collectDashboard(request)
      .then((body) => {
        if (started === this.generationOf(request.session.userId)) this.remember(cacheKey, body, request.limits);
        return body;
      })
      .finally(() => this.running.delete(runKey));
    this.running.set(runKey, collection);
    return collection;
  }

  /** Déconnexion ou effacement de la personne : ses résultats ne sont plus resservis. */
  forgetUser(userId: number): void {
    this.userGenerations.set(userId, (this.userGenerations.get(userId) ?? 0) + 1);
    for (const key of this.cache.keys()) if (key.startsWith(`${userId}:`)) this.cache.delete(key);
  }

  /** Réglages changés (connexion à GitHub, plafonds) : plus rien de l'ancien calcul n'est resservi. */
  clear(): void {
    this.generation += 1;
    this.cache.clear();
  }

  private generationOf(userId: number): string {
    return `${this.generation}:${this.userGenerations.get(userId) ?? 0}`;
  }

  private remember(key: string, body: DashboardBody, limits: Limits): void {
    const now = Date.now();
    for (const [stale, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(stale);
    if (limits.statsCacheSeconds > 0) this.cache.set(key, { expiresAt: now + limits.statsCacheSeconds * 1000, body });
  }
}

/** L'échéance de la collecte est passée : le dépôt en cours et les suivants sont « pas lus ». */
class DeadlineReached extends Error {
  constructor() {
    super("Dashboard collection deadline reached");
    this.name = "DeadlineReached";
  }
}

interface CollectionContext {
  readonly github: GitHubSettings;
  readonly token: string;
  readonly limits: Limits;
  readonly window: DashboardWindow;
  readonly deadline: number;
}

type RepositoryOutcome =
  | { readonly status: "read"; readonly collection: RepositoryCollection }
  | { readonly status: "unreadable" | "not_collected"; readonly name: string };

const iso = (ms: number): string => new Date(ms).toISOString();

function ensureTimeLeft(context: CollectionContext): void {
  if (Date.now() >= context.deadline) throw new DeadlineReached();
}

async function collectDashboard(request: DashboardRequest): Promise<DashboardBody> {
  const startedAt = Date.now();
  const context: CollectionContext = { ...request, window: windowOf(request.days, startedAt) };
  const listed = await listInstallationRepos(request.github, request.token, request.installation.id, request.limits.reposMax);
  const active = listed.repos.filter((repo) => !repo.archived);
  const chosen = [...active]
    .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""))
    .slice(0, request.limits.statsMaxRepos);
  const outcomes = await forEachRepository(chosen, (repo) => collectRepository(context, repo));
  const namesOf = (status: "unreadable" | "not_collected") =>
    outcomes.flatMap((outcome) => (outcome.status === status ? [outcome.name] : []));
  const body = buildDashboard({
    org: request.installation.org.login,
    window: context.window,
    generatedAt: Date.now(),
    repositories: outcomes.flatMap((outcome) => (outcome.status === "read" ? [outcome.collection] : [])),
    coverage: {
      repositories: listed.totalCount,
      archived: listed.repos.length - active.length,
      beyondLimit: listed.totalCount - listed.repos.length + (active.length - chosen.length),
      unreadable: namesOf("unreadable"),
      notCollected: namesOf("not_collected"),
    },
  });
  logger.info("dashboard.collected", { route: "/api/orgs/:org/dashboard", method: "GET", durationMs: Date.now() - startedAt });
  return body;
}

/**
 * Lit les dépôts `REPOSITORIES_AT_ONCE` à la fois, dans l'ordre donné. Au premier échec qui arrête tout,
 * plus aucun dépôt n'est lancé ; ceux en cours finissent, puis l'échec remonte.
 */
async function forEachRepository(
  repos: readonly RepoSummary[],
  collect: (repo: RepoSummary) => Promise<RepositoryOutcome>,
): Promise<RepositoryOutcome[]> {
  const outcomes: RepositoryOutcome[] = new Array<RepositoryOutcome>(repos.length);
  const state: { next: number; failure: { readonly error: unknown } | null } = { next: 0, failure: null };
  const worker = async (): Promise<void> => {
    while (state.failure === null && state.next < repos.length) {
      const index = state.next++;
      const repo = repos[index];
      if (!repo) return;
      try {
        outcomes[index] = await collect(repo);
      } catch (error) {
        state.failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(REPOSITORIES_AT_ONCE, repos.length) }, worker));
  if (state.failure) throw state.failure.error;
  return outcomes;
}

/** ÉCHEC OUVERT pour ce dépôt seul (illisible, ou pas lu à temps) ; limite de débit et jeton refusé remontent. */
async function collectRepository(context: CollectionContext, repo: RepoSummary): Promise<RepositoryOutcome> {
  const path: RepoPath = { owner: repo.owner, repo: repo.name };
  const { window } = context;
  try {
    ensureTimeLeft(context);
    const [current, previous, branches] = await Promise.all([
      readRuns(context, path, { from: window.from, to: window.to }),
      readRuns(context, path, { from: window.previousFrom, to: window.previousTo }),
      listBranches(context.github, context.token, path, { max: context.limits.branchesMax, activeDays: context.limits.activeBranchDays }),
    ]);
    const commits = await readCommits(context, repo, branches);
    return {
      status: "read",
      collection: {
        name: repo.name,
        htmlUrl: repo.htmlUrl,
        runs: { current: current.runs, previous: previous.runs, capped: current.capped || previous.capped },
        branches: { total: branches.totalCount, capped: branches.truncated },
        commits,
      },
    };
  } catch (err) {
    if (err instanceof DeadlineReached) return { status: "not_collected", name: repo.name };
    if (err instanceof GitHubApiError && !STOPS_EVERYTHING.has(err.code)) return { status: "unreadable", name: repo.name };
    throw err;
  }
}

async function readRuns(
  context: CollectionContext,
  repo: RepoPath,
  range: { readonly from: number; readonly to: number },
): Promise<{ readonly runs: StatsRun[]; readonly capped: boolean }> {
  const max = context.limits.statsMaxRunsPerRepo;
  const runs: StatsRun[] = [];
  let total = 0;
  for await (const page of runsCreatedBetween(context.github, context.token, repo, { from: iso(range.from), to: iso(range.to) })) {
    runs.push(...page.runs);
    total = page.totalCount;
    if (runs.length >= max) break;
    ensureTimeLeft(context);
  }
  const kept = runs.slice(0, max);
  return { runs: kept, capped: total > kept.length };
}

/**
 * Commits des deux périodes : la branche par défaut, puis ce que les autres branches actives ont en plus.
 * Un dépôt sans push depuis le début de la période précédente n'a aucun commit à lire : aucun appel.
 */
async function readCommits(
  context: CollectionContext,
  repo: RepoSummary,
  branches: RepoBranches,
): Promise<RepositoryCollection["commits"]> {
  const since = context.window.previousFrom;
  if (!repo.pushedAt || Date.parse(repo.pushedAt) < since || branches.defaultBranch === "") {
    return { items: [], capped: false };
  }
  const path: RepoPath = { owner: repo.owner, repo: repo.name };
  const found = new Map<string, StatsCommit>();
  await readDefaultBranchCommits(context, path, found);
  const missedOlder = await readBranchOnlyCommits(context, path, movedBranchesOf(branches, since), found);
  const max = context.limits.statsMaxCommitsPerRepo;
  return { items: [...found.values()].slice(0, max), capped: found.size >= max || missedOlder };
}

async function readDefaultBranchCommits(context: CollectionContext, path: RepoPath, found: Map<string, StatsCommit>): Promise<void> {
  const since = context.window.previousFrom;
  for await (const page of defaultBranchHistory(context.github, context.token, path, iso(since))) {
    addCommits(found, page.commits, since);
    if (found.size >= context.limits.statsMaxCommitsPerRepo) return;
    ensureTimeLeft(context);
  }
}

/** Branches autres que celle par défaut dont le dernier commit tombe dans les deux périodes. */
function movedBranchesOf(branches: RepoBranches, since: number): string[] {
  return branches.branches
    .filter((branch) => branch.name !== branches.defaultBranch && branch.committedAt !== null && Date.parse(branch.committedAt) >= since)
    .map((branch) => branch.name);
}

/** Rend vrai si des commits de la période ont pu manquer (plus de 100 commits propres à une branche). */
async function readBranchOnlyCommits(
  context: CollectionContext,
  path: RepoPath,
  moved: readonly string[],
  found: Map<string, StatsCommit>,
): Promise<boolean> {
  const since = context.window.previousFrom;
  let missedOlder = false;
  for (let start = 0; start < moved.length && found.size < context.limits.statsMaxCommitsPerRepo; start += BRANCHES_PER_COMPARISON) {
    ensureTimeLeft(context);
    const batch = moved.slice(start, start + BRANCHES_PER_COMPARISON);
    for (const compared of await branchOnlyCommits(context.github, context.token, path, batch)) {
      addCommits(found, compared.commits, since);
      // Rendus du plus ancien au plus récent : si le plus ancien est encore dans la période, d'autres manquent.
      const oldest = compared.commits[0];
      if (!compared.complete && oldest && Date.parse(oldest.committedAt) >= since) missedOlder = true;
    }
  }
  return missedOlder;
}

/** Ajoute les commits de la période (une fois chacun, par `oid`), l'auteur réduit à une identité à compter. */
function addCommits(found: Map<string, StatsCommit>, commits: readonly AuthoredCommit[], since: number): void {
  for (const commit of commits) {
    if (found.has(commit.oid) || Date.parse(commit.committedAt) < since) continue;
    found.set(commit.oid, { oid: commit.oid, committedAt: commit.committedAt, person: personOf(commit) });
  }
}
