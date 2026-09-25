import type {
  DispatchOutcome,
  DispatchRejection,
  DispatchTarget,
} from "../../domain/dispatchContract.ts";
import type { StatsRun } from "../../domain/dashboardStats.ts";
import type {
  RunConclusion,
  RunStatus,
  RunSummary,
  WorkflowState,
  WorkflowSummary,
} from "../../domain/githubTypes.ts";
import type { GitHubSettings } from "../config/env.ts";
import {
  DispatchAccepted,
  GitHubMessage,
  RunsPage,
  WorkflowsPage,
} from "../schemas/github.schema.ts";
import { CreatedRunsPage } from "../schemas/githubStats.schema.ts";
import {
  failureOf,
  GitHubApiError,
  pages,
  parsed,
  request,
  send,
  type RepoPath,
} from "./githubApi.ts";

/**
 * GitHub Actions au nom de l'utilisateur : workflows, exécutions, déclenchement (`workflow_dispatch`).
 * Passe par la couche HTTP commune (`githubApi.ts`). Le déclenchement n'est JAMAIS relancé : un envoi
 * dont on ignore l'issue peut avoir créé une exécution, et un doublon déclencherait un deuxième
 * déploiement (tous les workflows MaskAI déploient).
 */
export type WorkflowDefinition = Omit<WorkflowSummary, "latestRun">;

export interface RunFilter {
  readonly branch?: string;
  readonly event?: string;
  /** Instant ISO 8601 : seulement les exécutions créées depuis. */
  readonly createdSince?: string;
}

const WORKFLOW_STATES: readonly WorkflowState[] = [
  "active",
  "deleted",
  "disabled_fork",
  "disabled_inactivity",
  "disabled_manually",
];
const RUN_STATUSES: readonly RunStatus[] = ["queued", "in_progress", "completed", "waiting", "requested", "pending"];
const RUN_CONCLUSIONS: readonly RunConclusion[] = [
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "neutral",
  "stale",
  "startup_failure",
];

const repoBase = (repo: RepoPath): string =>
  `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;

/** Statut et conclusion connus de Pipliner : un statut inconnu devient `pending`, une conclusion inconnue `neutral`. */
function stateOf(run: { readonly status: string | null; readonly conclusion: string | null }): Pick<RunSummary, "status" | "conclusion"> {
  return {
    status: RUN_STATUSES.find((status) => status === run.status) ?? "pending",
    conclusion:
      run.conclusion === null ? null : (RUN_CONCLUSIONS.find((known) => known === run.conclusion) ?? "neutral"),
  };
}

/** Tous les workflows du dépôt (pages de 100). Un état inconnu compte comme désactivé. */
export async function listWorkflows(
  github: GitHubSettings,
  token: string,
  repo: RepoPath,
): Promise<WorkflowDefinition[]> {
  const found: WorkflowDefinition[] = [];
  for await (const body of pages(github, token, `${repoBase(repo)}/actions/workflows?per_page=100`)) {
    for (const workflow of parsed(WorkflowsPage, body).workflows) {
      found.push({
        id: workflow.id,
        name: workflow.name || workflow.path,
        path: workflow.path,
        state: WORKFLOW_STATES.find((state) => state === workflow.state) ?? "disabled_manually",
        htmlUrl: workflow.html_url,
      });
    }
  }
  return found;
}

/** Les 100 exécutions les plus récentes répondant au filtre (une seule page : c'est un aperçu). */
export async function listRecentRuns(
  github: GitHubSettings,
  token: string,
  repo: RepoPath,
  filter: RunFilter,
): Promise<RunSummary[]> {
  const query = new URLSearchParams({ per_page: "100", exclude_pull_requests: "true" });
  if (filter.branch) query.set("branch", filter.branch);
  if (filter.event) query.set("event", filter.event);
  if (filter.createdSince) query.set("created", `>=${filter.createdSince}`);
  const response = await send(github, token, `${github.apiUrl}${repoBase(repo)}/actions/runs?${query}`);
  return parsed(RunsPage, await response.json().catch(() => null)).workflow_runs.map((run) => ({
    id: run.id,
    workflowId: run.workflow_id,
    branch: run.head_branch,
    event: run.event,
    ...stateOf(run),
    htmlUrl: run.html_url,
    createdAt: run.created_at,
    startedAt: run.run_started_at ?? null,
    updatedAt: run.updated_at,
  }));
}

/** Une page d'exécutions d'une période, avec le total annoncé par GitHub (pour savoir si tout a été lu). */
export interface CreatedRuns {
  readonly runs: StatsRun[];
  readonly totalCount: number;
}

/**
 * Exécutions créées entre deux instants ISO 8601 (inclus), page par page (100) : l'appelant s'arrête
 * quand il veut (plafond, limite de temps). GitHub ne rend pas plus de 1 000 exécutions d'une liste
 * filtrée. Toutes sont gardées (poussées, planifiées, demandes de fusion, lancements) ;
 * `exclude_pull_requests` n'allège que la réponse.
 */
export async function* runsCreatedBetween(
  github: GitHubSettings,
  token: string,
  repo: RepoPath,
  range: { readonly from: string; readonly to: string },
): AsyncGenerator<CreatedRuns> {
  // Syntaxe de recherche de GitHub : instants à la seconde, `<de>..<à>`.
  const stamp = (iso: string) => iso.replace(/\.\d{3}Z$/, "Z");
  const query = new URLSearchParams({
    per_page: "100",
    exclude_pull_requests: "true",
    created: `${stamp(range.from)}..${stamp(range.to)}`,
  });
  for await (const body of pages(github, token, `${repoBase(repo)}/actions/runs?${query}`)) {
    const page = parsed(CreatedRunsPage, body);
    yield {
      totalCount: page.total_count,
      runs: page.workflow_runs.map((run) => ({
        workflowId: run.workflow_id,
        workflowName: run.name || run.path || `Workflow ${run.workflow_id}`,
        workflowPath: run.path ?? "",
        branch: run.head_branch,
        event: run.event,
        ...stateOf(run),
        htmlUrl: run.html_url,
        createdAt: run.created_at,
        startedAt: run.run_started_at ?? null,
        updatedAt: run.updated_at,
      })),
    };
  }
}

/**
 * Déclenche un workflow sur une branche et rend son issue, sans jamais lever pour un refus de GitHub.
 * `return_run_details` fait renvoyer l'identifiant de l'exécution créée (200) ; une réponse 204 (sans
 * détails) reste un succès.
 */
export async function dispatchWorkflow(
  github: GitHubSettings,
  token: string,
  target: DispatchTarget,
): Promise<DispatchOutcome> {
  const url = `${github.apiUrl}${repoBase(target)}/actions/workflows/${target.workflowId}/dispatches`;
  let response: Response;
  try {
    response = await request(github, token, url, {
      method: "POST",
      body: { ref: target.ref, return_run_details: true },
    });
  } catch (err) {
    if (!(err instanceof GitHubApiError)) throw err;
    // Délai dépassé ou réseau coupé PENDANT l'envoi : GitHub a peut-être créé l'exécution.
    return { status: "unknown", target, code: err.code === "timeout" ? "timeout" : "upstream" };
  }
  if (response.status === 200 || response.status === 204) return dispatched(target, response);
  if (response.status === 422) return { status: "rejected", target, code: await rejectionOf(response) };
  return outcomeOfFailure(target, failureOf(response));
}

async function dispatched(target: DispatchTarget, response: Response): Promise<DispatchOutcome> {
  const details = DispatchAccepted.safeParse(await response.json().catch(() => null));
  return details.success
    ? { status: "dispatched", target, runId: details.data.workflow_run_id, htmlUrl: details.data.html_url }
    : { status: "dispatched", target, runId: null, htmlUrl: null };
}

/** Lit le message d'un 422 pour le classer ; le message lui-même ne sort jamais d'ici. */
async function rejectionOf(response: Response): Promise<DispatchRejection> {
  const body = GitHubMessage.safeParse(await response.json().catch(() => null));
  const message = body.success ? body.data.message : "";
  if (/workflow_dispatch/i.test(message)) return "no_dispatch_trigger";
  if (/no ref found|ref.*not.*found/i.test(message)) return "ref_not_found";
  if (/input/i.test(message)) return "missing_inputs";
  return "unprocessable";
}

function outcomeOfFailure(target: DispatchTarget, failure: GitHubApiError): DispatchOutcome {
  switch (failure.code) {
    case "rate_limited":
    case "unauthorized":
      return { status: "not_attempted", target, code: failure.code };
    case "not_found":
    case "forbidden":
    case "sso_required":
    case "unprocessable":
      return { status: "rejected", target, code: failure.code };
    case "timeout":
      return { status: "unknown", target, code: "timeout" };
    case "upstream":
      // Un 5xx sur un POST ne dit pas si l'exécution a été créée : issue inconnue, à vérifier.
      return { status: "unknown", target, code: "upstream" };
  }
}
