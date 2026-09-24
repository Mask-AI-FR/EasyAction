import { describe, expect, test } from "bun:test";
import { Selection, type RepoRef } from "../../domain/selection.ts";

const front: RepoRef = { owner: "Mask-AI-FR", name: "MaskAI-Frontend", defaultBranch: "main" };
const org: RepoRef = { owner: "Mask-AI-FR", name: "MaskAI-Org_service", defaultBranch: "main" };
const auth: RepoRef = { owner: "Mask-AI-FR", name: "MaskAI-Auth", defaultBranch: "main" };

describe("sélection des pipelines", () => {
  test("cocher un dépôt prend tous ses workflows actifs, sur la branche choisie", () => {
    const selection = Selection.empty.toggleRepo(front, "V0-1-1");
    expect(selection.entries()).toEqual([{ repo: front, branch: "V0-1-1", workflows: "all" }]);
    expect(selection.repoState(front, null)).toBe("all");
    expect(selection.isWorkflowPicked(front, 12)).toBe(true);
  });

  test("décocher un dépôt le retire entièrement", () => {
    expect(Selection.empty.toggleRepo(front, "main").toggleRepo(front, "main").repoCount).toBe(0);
  });

  test("décocher un workflow d'un dépôt entier : la case du dépôt devient partielle", () => {
    const selection = Selection.empty.toggleRepo(front, "main").toggleWorkflow(front, "main", 2, [1, 2, 3]);
    expect(selection.entries()[0]?.workflows).toEqual([1, 3]);
    expect(selection.repoState(front, [1, 2, 3])).toBe("some");
    expect(selection.isWorkflowPicked(front, 2)).toBe(false);
  });

  test("recocher tous les workflows un par un : la case du dépôt redevient pleine", () => {
    const selection = Selection.empty
      .toggleWorkflow(front, "main", 1, [1, 2])
      .toggleWorkflow(front, "main", 2, [1, 2]);
    expect(selection.repoState(front, [1, 2])).toBe("all");
  });

  test("décocher le dernier workflow retire le dépôt", () => {
    const selection = Selection.empty.toggleWorkflow(front, "main", 1, [1]).toggleWorkflow(front, "main", 1, [1]);
    expect(selection.repoCount).toBe(0);
  });

  test("changer de branche ne touche que les dépôts déjà sélectionnés", () => {
    const selection = Selection.empty.toggleRepo(front, "main");
    expect(selection.withBranch(front, "V0-1-1").branchOf(front)).toBe("V0-1-1");
    expect(selection.withBranch(org, "V0-1-1").branchOf(org)).toBeUndefined();
  });

  test("tout sélectionner garde les choix déjà faits, et prend la branche par défaut des autres", () => {
    const picked = Selection.empty.toggleWorkflow(front, "V0-1-1", 7, [7, 8]);
    const all = picked.addRepos([front, org, auth]);
    expect(all.repoCount).toBe(3);
    expect(all.branchOf(front)).toBe("V0-1-1");
    expect(all.entries().find((entry) => entry.repo === front)?.workflows).toEqual([7]);
    expect(all.branchOf(org)).toBe("main");
  });

  test("état de la case de page : aucune, partielle, pleine", () => {
    const page = [front, org];
    expect(Selection.empty.pageState(page)).toBe("none");
    expect(Selection.empty.toggleRepo(front, "main").pageState(page)).toBe("some");
    expect(Selection.empty.addRepos(page).pageState(page)).toBe("all");
    expect(Selection.empty.addRepos(page).removeRepos(page).pageState(page)).toBe("none");
  });

  test("une sélection n'est jamais modifiée en place", () => {
    const before = Selection.empty.toggleRepo(front, "main");
    before.toggleRepo(org, "main");
    before.withBranch(front, "V0-1-1");
    expect(before.repoCount).toBe(1);
    expect(before.branchOf(front)).toBe("main");
  });
});
