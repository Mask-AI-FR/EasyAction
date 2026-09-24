import type { DispatchOutcome, DispatchTarget } from "../../domain/dispatchContract.ts";

/** Déclenche une cible et rend son issue (sans lever pour un refus de GitHub). */
export type Dispatch = (target: DispatchTarget) => Promise<DispatchOutcome>;

/**
 * Lance des pipelines, `concurrency` à la fois, et rend une issue par cible distincte, dans l'ordre.
 *
 * - Doublons retirés : une même cible (dépôt, workflow, branche) ne part qu'une fois.
 * - ÉCHEC FERMÉ : dès qu'une cible revient « limite de débit » ou « session terminée », plus aucune
 *   n'est envoyée ; les suivantes sont `not_attempted`. Mieux vaut relancer plus tard que déclencher
 *   des déploiements en partie, à l'aveugle.
 * - Aucune reprise : chaque cible est envoyée au plus une fois.
 */
export async function runDispatches(
  targets: readonly DispatchTarget[],
  dispatch: Dispatch,
  concurrency: number,
): Promise<DispatchOutcome[]> {
  const unique = uniqueTargets(targets);
  const outcomes: DispatchOutcome[] = [];
  let next = 0;
  let halt: "rate_limited" | "unauthorized" | null = null;
  const worker = async (): Promise<void> => {
    while (next < unique.length) {
      const index = next++;
      const target = unique[index] as DispatchTarget;
      if (halt) {
        outcomes[index] = { status: "not_attempted", target, code: halt };
        continue;
      }
      const outcome = await dispatch(target);
      outcomes[index] = outcome;
      if (outcome.status === "not_attempted") halt ??= outcome.code;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, unique.length)) }, worker));
  return outcomes;
}

function uniqueTargets(targets: readonly DispatchTarget[]): DispatchTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.owner}/${target.repo}#${target.workflowId}@${target.ref}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
