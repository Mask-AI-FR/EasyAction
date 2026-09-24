import type { DispatchOutcome, DispatchTarget } from "./dispatchContract.ts";
import type { WorkflowSummary } from "./githubTypes.ts";
import type { RepoRef, Selection } from "./selection.ts";

/**
 * Plan d'un lancement : ce qui partira réellement, avec tout ce que la confirmation doit montrer.
 * Pur et testé ; le serveur revalide la liste et le plafond de son côté.
 */
export interface DispatchPlanItem extends DispatchTarget {
  readonly workflowName: string;
  readonly workflowPath: string;
  /** Branche par défaut du dépôt : pour les dépôts MaskAI, un déploiement en production. */
  readonly isDefaultBranch: boolean;
}

export interface DispatchPlan {
  readonly items: readonly DispatchPlanItem[];
  readonly defaultBranchCount: number;
  /** Dépôts d'où partiront plusieurs workflows : un groupe de concurrence peut annuler les attentes. */
  readonly reposWithSeveral: readonly string[];
  /** Dépôts sélectionnés dont aucun workflow actif n'est à lancer. */
  readonly emptyRepos: readonly string[];
  /** Dépôts dont les workflows n'ont pas pu être lus : rien n'en partira (échec fermé). */
  readonly unreadableRepos: readonly string[];
  readonly overLimit: boolean;
}

/**
 * @param workflowsOf workflows d'un dépôt sur une branche ; `null` s'ils n'ont pas pu être lus.
 */
export function planDispatch(
  selection: Selection,
  workflowsOf: (repo: RepoRef, branch: string) => readonly WorkflowSummary[] | null,
  maxTargets: number,
): DispatchPlan {
  const items: DispatchPlanItem[] = [];
  const emptyRepos: string[] = [];
  const unreadableRepos: string[] = [];
  const reposWithSeveral: string[] = [];
  for (const { repo, branch, workflows } of selection.entries()) {
    const fullName = `${repo.owner}/${repo.name}`;
    const known = workflowsOf(repo, branch);
    if (known === null) {
      unreadableRepos.push(fullName);
      continue;
    }
    const chosen = known.filter(
      (workflow) =>
        workflow.state === "active" && (workflows === "all" || workflows.includes(workflow.id)),
    );
    if (chosen.length === 0) emptyRepos.push(fullName);
    if (chosen.length > 1) reposWithSeveral.push(fullName);
    for (const workflow of chosen) {
      items.push({
        owner: repo.owner,
        repo: repo.name,
        workflowId: workflow.id,
        ref: branch,
        workflowName: workflow.name,
        workflowPath: workflow.path,
        isDefaultBranch: branch === repo.defaultBranch,
      });
    }
  }
  return {
    items,
    defaultBranchCount: items.filter((item) => item.isDefaultBranch).length,
    reposWithSeveral,
    emptyRepos,
    unreadableRepos,
    overLimit: items.length > maxTargets,
  };
}

/** Nombre de cibles par issue, pour le résumé d'un lancement (« 5 dispatched · 1 rejected »). */
export type OutcomeCounts = Readonly<Record<DispatchOutcome["status"], number>>;

export function summarizeOutcomes(outcomes: readonly DispatchOutcome[]): OutcomeCounts {
  const counts = { dispatched: 0, rejected: 0, not_attempted: 0, unknown: 0 };
  for (const outcome of outcomes) counts[outcome.status] += 1;
  return counts;
}
