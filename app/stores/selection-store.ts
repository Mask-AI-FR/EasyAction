import { createStore } from "@tinijs/store";
import { Selection, type CheckState, type RepoRef } from "../../domain/selection.ts";

interface SelectionState {
  selection: Selection;
  /** Branche choisie pour un dépôt (clé `owner/name`), coché ou non ; à défaut, sa branche par défaut. */
  branches: ReadonlyMap<string, string>;
}

/**
 * Pipelines choisis sur la page des dépôts. Les règles sont celles, testées, de `domain/selection.ts` ;
 * le magasin les conserve et prévient les composants abonnés (lignes, en-tête, barre d'action).
 */
export const selectionStore = createStore<SelectionState>({
  selection: Selection.empty,
  branches: new Map(),
});

const keyOf = (repo: RepoRef): string => `${repo.owner}/${repo.name}`;

export function branchFor(repo: RepoRef): string {
  return selectionStore.branches.get(keyOf(repo)) ?? repo.defaultBranch;
}

/** Change la branche d'un dépôt ; s'il est coché, ses pipelines partiront de la nouvelle branche. */
export function chooseBranch(repo: RepoRef, branch: string): void {
  selectionStore.commit("branches", new Map(selectionStore.branches).set(keyOf(repo), branch));
  selectionStore.commit("selection", selectionStore.selection.withBranch(repo, branch));
}

/** Case d'un dépôt : cochée → décochée ; vide ou partielle → tous ses workflows actifs. */
export function toggleRepo(repo: RepoRef, state: CheckState): void {
  const without = selectionStore.selection.removeRepos([repo]);
  selectionStore.commit("selection", state === "all" ? without : without.toggleRepo(repo, branchFor(repo)));
}

export function toggleWorkflow(repo: RepoRef, workflowId: number, activeIds: readonly number[]): void {
  selectionStore.commit(
    "selection",
    selectionStore.selection.toggleWorkflow(repo, branchFor(repo), workflowId, activeIds),
  );
}

/** Coche des dépôts entiers (la page, ou tous ceux qui correspondent) ; les choix déjà faits restent. */
export function selectRepos(repos: readonly RepoRef[]): void {
  let next = selectionStore.selection.addRepos(repos);
  for (const repo of repos) next = next.withBranch(repo, branchFor(repo));
  selectionStore.commit("selection", next);
}

export function deselectRepos(repos: readonly RepoRef[]): void {
  selectionStore.commit("selection", selectionStore.selection.removeRepos(repos));
}

/** Après un lancement : plus rien n'est coché ; les branches choisies restent affichées. */
export function clearSelection(): void {
  selectionStore.commit("selection", Selection.empty);
}

/** Changement d'organisation : on repart de zéro, un lancement ne mélange jamais deux organisations. */
export function resetSelection(): void {
  selectionStore.commit("selection", Selection.empty);
  selectionStore.commit("branches", new Map());
}
