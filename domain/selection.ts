import type { WorkflowSummary } from "./githubTypes.ts";

/**
 * Sélection des pipelines à lancer : valeur immuable (chaque opération rend une nouvelle sélection),
 * testée sans navigateur. Par dépôt : la branche choisie (une seule, décision du 2026-09-24) et soit
 * « son pipeline choisi » (liste déroulante de la ligne, décision du 2026-09-29), soit une liste précise.
 */

/** Ce qu'il faut savoir d'un dépôt pour le sélectionner. */
export interface RepoRef {
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
}

export interface RepoSelection {
  readonly repo: RepoRef;
  readonly branch: string;
  /** `"chosen"` : le pipeline choisi du dépôt, résolu au lancement ; sinon des identifiants cochés. */
  readonly workflows: "chosen" | readonly number[];
}

export type CheckState = "none" | "some" | "all";

const keyOf = (repo: Pick<RepoRef, "owner" | "name">): string => `${repo.owner}/${repo.name}`;

/**
 * Le pipeline choisi d'un dépôt : celui retenu par l'utilisateur s'il est encore actif, sinon le seul
 * workflow actif ; `null` s'il y en a plusieurs sans choix (rien ne part : échec fermé) ou aucun.
 */
export function chosenPipelineOf(workflows: readonly WorkflowSummary[], remembered: number | null): number | null {
  const active = workflows.filter((workflow) => workflow.state === "active");
  if (active.some((workflow) => workflow.id === remembered)) return remembered;
  return active.length === 1 ? (active[0]?.id ?? null) : null;
}

export class Selection {
  static readonly empty = new Selection(new Map());

  private constructor(private readonly byRepo: ReadonlyMap<string, RepoSelection>) {}

  get repoCount(): number {
    return this.byRepo.size;
  }

  entries(): RepoSelection[] {
    return [...this.byRepo.values()];
  }

  branchOf(repo: RepoRef): string | undefined {
    return this.byRepo.get(keyOf(repo))?.branch;
  }

  /** Coche ou décoche un dépôt (son pipeline choisi, sur `branch`). */
  toggleRepo(repo: RepoRef, branch: string): Selection {
    const next = new Map(this.byRepo);
    if (next.has(keyOf(repo))) next.delete(keyOf(repo));
    else next.set(keyOf(repo), { repo, branch, workflows: "chosen" });
    return new Selection(next);
  }

  /** Ajoute des dépôts (leur pipeline choisi) ; un dépôt déjà sélectionné garde ses choix. */
  addRepos(repos: readonly RepoRef[]): Selection {
    const next = new Map(this.byRepo);
    for (const repo of repos) {
      if (!next.has(keyOf(repo))) {
        next.set(keyOf(repo), { repo, branch: repo.defaultBranch, workflows: "chosen" });
      }
    }
    return new Selection(next);
  }

  removeRepos(repos: readonly RepoRef[]): Selection {
    const next = new Map(this.byRepo);
    for (const repo of repos) next.delete(keyOf(repo));
    return new Selection(next);
  }

  /**
   * Coche ou décoche un workflow. `chosenId` : le pipeline choisi du dépôt, pour passer de « le
   * pipeline choisi » à une liste explicite. Un dépôt dont la liste devient vide sort de la sélection.
   */
  toggleWorkflow(repo: RepoRef, branch: string, workflowId: number, chosenId: number | null): Selection {
    const current = this.byRepo.get(keyOf(repo));
    const fromChosen = chosenId === null ? [] : [chosenId];
    const picked = !current ? [] : current.workflows === "chosen" ? fromChosen : [...current.workflows];
    const updated = picked.includes(workflowId)
      ? picked.filter((id) => id !== workflowId)
      : [...picked, workflowId];
    const next = new Map(this.byRepo);
    if (updated.length === 0) next.delete(keyOf(repo));
    else next.set(keyOf(repo), { repo, branch: current?.branch ?? branch, workflows: updated });
    return new Selection(next);
  }

  /** Change la branche d'un dépôt déjà sélectionné (sans effet sinon). */
  withBranch(repo: RepoRef, branch: string): Selection {
    const current = this.byRepo.get(keyOf(repo));
    if (!current || current.branch === branch) return this;
    return new Selection(new Map(this.byRepo).set(keyOf(repo), { ...current, branch }));
  }

  /**
   * Un nouveau pipeline vient d'être choisi dans la liste déroulante : un dépôt coché lance désormais
   * celui-là seul, même si des workflows y avaient été cochés un par un (sans effet s'il n'est pas coché).
   */
  withChosenPipeline(repo: RepoRef): Selection {
    const current = this.byRepo.get(keyOf(repo));
    if (!current || current.workflows === "chosen") return this;
    return new Selection(new Map(this.byRepo).set(keyOf(repo), { ...current, workflows: "chosen" }));
  }

  isWorkflowPicked(repo: RepoRef, workflowId: number, chosenId: number | null): boolean {
    const current = this.byRepo.get(keyOf(repo));
    if (!current) return false;
    if (current.workflows === "chosen") return workflowId === chosenId;
    return current.workflows.includes(workflowId);
  }

  /** État de la case d'un dépôt. `activeIds` : ses workflows actifs, ou `null` s'ils ne sont pas chargés. */
  repoState(repo: RepoRef, activeIds: readonly number[] | null): CheckState {
    const current = this.byRepo.get(keyOf(repo));
    if (!current) return "none";
    const picked = current.workflows;
    if (picked === "chosen") return "all";
    const covers = activeIds !== null && activeIds.every((id) => picked.includes(id));
    return covers ? "all" : "some";
  }

  /** État de la case « tout sélectionner » pour une liste de dépôts (la page affichée). */
  pageState(repos: readonly RepoRef[]): CheckState {
    const selected = repos.filter((repo) => this.byRepo.has(keyOf(repo))).length;
    if (selected === 0) return "none";
    return selected === repos.length ? "all" : "some";
  }
}
