import type { RunConclusion, RunStatus, RunSummary } from "./githubTypes.ts";

/**
 * Traduction d'une exécution GitHub en signal affichable. Le signal choisit la couleur (jetons
 * `signal-*` de MASKAI, côté interface) ; le libellé l'accompagne toujours, jamais la couleur seule.
 */
export type RunSignal = "success" | "failed" | "running" | "queued" | "attention" | "neutral" | "never";

export interface RunSignalView {
  readonly signal: RunSignal;
  readonly label: string;
}

type RunState = Pick<RunSummary, "status" | "conclusion">;

const WAITING_LABELS: Record<Exclude<RunStatus, "in_progress" | "completed">, RunSignalView> = {
  queued: { signal: "queued", label: "Queued" },
  requested: { signal: "queued", label: "Requested" },
  pending: { signal: "queued", label: "Pending" },
  // Un job avec `environment:` protégé attend une approbation humaine : c'est une action requise.
  waiting: { signal: "attention", label: "Waiting for approval" },
};

const CONCLUSION_LABELS: Record<RunConclusion, RunSignalView> = {
  success: { signal: "success", label: "Success" },
  failure: { signal: "failed", label: "Failed" },
  timed_out: { signal: "failed", label: "Timed out" },
  startup_failure: { signal: "failed", label: "Startup failure" },
  action_required: { signal: "attention", label: "Action required" },
  cancelled: { signal: "neutral", label: "Cancelled" },
  skipped: { signal: "neutral", label: "Skipped" },
  neutral: { signal: "neutral", label: "Neutral" },
  stale: { signal: "neutral", label: "Stale" },
};

export function runSignalOf(run: RunState | null): RunSignalView {
  if (!run) return { signal: "never", label: "No runs" };
  if (run.status === "in_progress") return { signal: "running", label: "In progress" };
  if (run.status !== "completed") return WAITING_LABELS[run.status];
  return run.conclusion ? CONCLUSION_LABELS[run.conclusion] : { signal: "neutral", label: "Completed" };
}

/** Une exécution terminée n'évoluera plus : on peut cesser de la suivre. */
export function isFinished(run: RunState): boolean {
  return run.status === "completed";
}

/**
 * Dernière exécution de chaque workflow. GitHub rend les exécutions de la plus récente à la plus
 * ancienne : la première rencontrée pour un workflow est la sienne.
 */
export function latestRunByWorkflow(runs: readonly RunSummary[]): Map<number, RunSummary> {
  const latest = new Map<number, RunSummary>();
  for (const run of runs) if (!latest.has(run.workflowId)) latest.set(run.workflowId, run);
  return latest;
}
