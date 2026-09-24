import { createStore } from "@tinijs/store";
import type { SessionBody } from "../../domain/apiContract.ts";
import type { DispatchOutcome, DispatchTarget } from "../../domain/dispatchContract.ts";
import type { RunSummary } from "../../domain/githubTypes.ts";
import { keepTracking, nextPollSeconds } from "../../domain/pollingPolicy.ts";
import { isFinished, runSignalOf, type RunSignalView } from "../../domain/runStatus.ts";
import { api, ApiError } from "./api-client.ts";

/** Une exécution lancée depuis Pipliner, suivie en direct. */
export interface TrackedRun {
  readonly target: DispatchTarget;
  readonly runId: number;
  readonly htmlUrl: string | null;
  /** Dernier état relevé ; `null` tant que GitHub ne l'a pas encore listée. */
  readonly run: RunSummary | null;
  /** Suivi arrêté avant la fin (échecs répétés, durée maximale) : l'état est à voir sur GitHub. */
  readonly lost: boolean;
}

type PollLimits = Pick<SessionBody["limits"], "runPollMinSeconds" | "runTrackMaxMinutes">;

interface RepoGroup {
  readonly repo: { readonly owner: string; readonly name: string };
  readonly ids: number[];
}

/** Exécutions suivies, par identifiant : les lignes de dépôts et le détail d'un lancement s'y abonnent. */
export const liveRunsStore = createStore<{ runs: ReadonlyMap<number, TrackedRun> }>({ runs: new Map() });

/** Marge sous l'heure du lancement pour `since` : l'horloge du navigateur n'est pas celle de GitHub. */
const SINCE_MARGIN_MS = 10 * 60_000;
/** Plafond du serveur (`RunsQuery`) : 100 identifiants par relevé et par dépôt. */
const MAX_IDS_PER_REQUEST = 100;

let limits: PollLimits | null = null;
let since = "";
let startedAt = 0;
let failures = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
let watchingVisibility = false;

/**
 * Commence (ou prolonge) le suivi des exécutions créées par un lancement. Le rythme vient de
 * `domain/pollingPolicy.ts` : une requête par dépôt et par relevé, jamais plus souvent que
 * `RUN_POLL_MIN_SECONDS`, en pause quand l'onglet est caché.
 */
export function trackDispatched(outcomes: readonly DispatchOutcome[], pollLimits: PollLimits): void {
  const fresh: TrackedRun[] = outcomes.flatMap((outcome) =>
    outcome.status === "dispatched" && outcome.runId !== null
      ? [{ target: outcome.target, runId: outcome.runId, htmlUrl: outcome.htmlUrl, run: null, lost: false }]
      : [],
  );
  if (fresh.length === 0) return;
  const now = Date.now();
  // Des exécutions plus anciennes encore suivies gardent la borne `since` la plus ancienne.
  if (unfinished().length === 0) since = new Date(now - SINCE_MARGIN_MS).toISOString();
  const runs = new Map(liveRunsStore.runs);
  for (const tracked of fresh) runs.set(tracked.runId, tracked);
  liveRunsStore.commit("runs", runs);
  limits = pollLimits;
  startedAt = now;
  failures = 0;
  watchVisibility();
  schedule();
}

/** Ce qu'affiche une exécution suivie : son état relevé, « Dispatched » avant le premier relevé. */
export function trackedRunView(tracked: TrackedRun): RunSignalView {
  if (tracked.run && isFinished(tracked.run)) return runSignalOf(tracked.run);
  if (tracked.lost) return { signal: "attention", label: "Status unknown" };
  return tracked.run ? runSignalOf(tracked.run) : { signal: "queued", label: "Dispatched" };
}

/** L'exécution suivie la plus récente d'un workflow sur une branche, s'il y en a une. */
export function latestTrackedRun(
  runs: ReadonlyMap<number, TrackedRun>,
  target: DispatchTarget,
): TrackedRun | undefined {
  let latest: TrackedRun | undefined;
  for (const tracked of runs.values()) {
    const { owner, repo, workflowId, ref } = tracked.target;
    const same =
      owner === target.owner && repo === target.repo && workflowId === target.workflowId && ref === target.ref;
    if (same && (!latest || tracked.runId > latest.runId)) latest = tracked;
  }
  return latest;
}

function unfinished(): TrackedRun[] {
  return [...liveRunsStore.runs.values()].filter(
    (tracked) => !tracked.lost && !(tracked.run && isFinished(tracked.run)),
  );
}

function groupByRepo(runs: readonly TrackedRun[]): Map<string, RepoGroup> {
  const groups = new Map<string, RepoGroup>();
  for (const { target, runId } of runs) {
    const key = `${target.owner}/${target.repo}`;
    const group = groups.get(key) ?? { repo: { owner: target.owner, name: target.repo }, ids: [] };
    group.ids.push(runId);
    groups.set(key, group);
  }
  return groups;
}

function schedule(): void {
  clearTimeout(timer);
  timer = undefined;
  if (!limits || document.visibilityState === "hidden") return;
  const repoCount = groupByRepo(unfinished()).size;
  const seconds = nextPollSeconds(limits.runPollMinSeconds, repoCount, failures);
  timer = setTimeout(() => void poll(), seconds * 1000);
}

async function poll(): Promise<void> {
  if (polling || !limits) return;
  polling = true;
  timer = undefined;
  try {
    const results = await Promise.all([...groupByRepo(unfinished()).values()].map(readRuns));
    failures = results.includes(null) ? failures + 1 : 0;
    applyRuns(results.flatMap((runs) => runs ?? []));
  } finally {
    polling = false;
  }
  const state = { startedAt, now: Date.now(), consecutiveFailures: failures };
  if (limits && keepTracking({ ...state, maxMinutes: limits.runTrackMaxMinutes, unfinished: unfinished().length })) {
    schedule();
  } else {
    stopTracking();
  }
}

/**
 * ÉCHEC OUVERT : lecture seule. Un relevé manqué garde l'état précédent ; après trois échecs de suite
 * (`MAX_CONSECUTIVE_FAILURES`), le suivi s'arrête et affiche « Status unknown » avec le lien GitHub.
 */
async function readRuns(group: RepoGroup): Promise<readonly RunSummary[] | null> {
  try {
    return (await api.runs(group.repo, group.ids.slice(0, MAX_IDS_PER_REQUEST), since)).runs;
  } catch (err) {
    if (err instanceof ApiError || err instanceof TypeError) return null;
    throw err;
  }
}

function applyRuns(found: readonly RunSummary[]): void {
  if (found.length === 0) return;
  const runs = new Map(liveRunsStore.runs);
  for (const run of found) {
    const tracked = runs.get(run.id);
    if (!tracked) continue;
    runs.set(run.id, { ...tracked, run });
    // La dernière exécution de ce workflow a changé : la prochaine lecture de ses workflows sera fraîche.
    if (isFinished(run)) api.forgetWorkflows({ owner: tracked.target.owner, name: tracked.target.repo });
  }
  liveRunsStore.commit("runs", runs);
}

/** Fin du suivi : ce qui n'est pas terminé passe en « état inconnu », jamais en succès supposé. */
function stopTracking(): void {
  const runs = new Map(liveRunsStore.runs);
  for (const tracked of unfinished()) runs.set(tracked.runId, { ...tracked, lost: true });
  liveRunsStore.commit("runs", runs);
  limits = null;
}

/** Onglet caché : aucun relevé (quota GitHub partagé) ; au retour, un relevé immédiat. */
function watchVisibility(): void {
  if (watchingVisibility) return;
  watchingVisibility = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(timer);
      timer = undefined;
    } else if (limits && timer === undefined) {
      void poll();
    }
  });
}
