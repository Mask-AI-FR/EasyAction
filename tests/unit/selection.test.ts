import { describe, expect, test } from "bun:test";
import type { WorkflowState, WorkflowSummary } from "../../domain/githubTypes.ts";
import { chosenPipelineOf, Selection, type RepoRef } from "../../domain/selection.ts";
import { parsePipelineChoices } from "../../app/stores/pipeline-choice.ts";

const front: RepoRef = { owner: "Mask-AI-FR", name: "MaskAI-Frontend", defaultBranch: "main" };
const org: RepoRef = { owner: "Mask-AI-FR", name: "MaskAI-Org_service", defaultBranch: "main" };
const auth: RepoRef = { owner: "Mask-AI-FR", name: "MaskAI-Auth", defaultBranch: "main" };

describe("sélection des pipelines", () => {
  test("cocher un dépôt prend son pipeline choisi, et lui seul, sur la branche choisie", () => {
    const selection = Selection.empty.toggleRepo(front, "V0-1-1");
    expect(selection.entries()).toEqual([{ repo: front, branch: "V0-1-1", workflows: "chosen" }]);
    expect(selection.repoState(front, null)).toBe("all");
    expect(selection.isWorkflowPicked(front, 12, 12)).toBe(true);
    expect(selection.isWorkflowPicked(front, 13, 12)).toBe(false);
  });

  test("décocher un dépôt le retire entièrement", () => {
    expect(Selection.empty.toggleRepo(front, "main").toggleRepo(front, "main").repoCount).toBe(0);
  });

  test("cocher un autre workflow d'un dépôt coché : son pipeline choisi reste, la case devient partielle", () => {
    const selection = Selection.empty.toggleRepo(front, "main").toggleWorkflow(front, "main", 3, 2);
    expect(selection.entries()[0]?.workflows).toEqual([2, 3]);
    expect(selection.repoState(front, [1, 2, 3])).toBe("some");
    expect(selection.isWorkflowPicked(front, 3, 2)).toBe(true);
    expect(selection.isWorkflowPicked(front, 1, 2)).toBe(false);
  });

  test("cocher un workflow d'un dépôt coché sans pipeline choisi ne prend que ce workflow", () => {
    const selection = Selection.empty.toggleRepo(front, "main").toggleWorkflow(front, "main", 3, null);
    expect(selection.entries()[0]?.workflows).toEqual([3]);
  });

  test("recocher tous les workflows un par un : la case du dépôt redevient pleine", () => {
    const selection = Selection.empty
      .toggleWorkflow(front, "main", 1, null)
      .toggleWorkflow(front, "main", 2, null);
    expect(selection.repoState(front, [1, 2])).toBe("all");
  });

  test("décocher le pipeline choisi d'un dépôt coché retire le dépôt", () => {
    const selection = Selection.empty.toggleRepo(front, "main").toggleWorkflow(front, "main", 1, 1);
    expect(selection.repoCount).toBe(0);
  });

  test("choisir un autre pipeline : un dépôt coché ne lance plus que lui ; sans effet s'il n'est pas coché", () => {
    const picked = Selection.empty.toggleWorkflow(front, "main", 1, null).toggleWorkflow(front, "main", 2, null);
    expect(picked.withChosenPipeline(front).entries()[0]?.workflows).toBe("chosen");
    expect(picked.withChosenPipeline(org)).toBe(picked);
  });

  test("changer de branche ne touche que les dépôts déjà sélectionnés", () => {
    const selection = Selection.empty.toggleRepo(front, "main");
    expect(selection.withBranch(front, "V0-1-1").branchOf(front)).toBe("V0-1-1");
    expect(selection.withBranch(org, "V0-1-1").branchOf(org)).toBeUndefined();
  });

  test("tout sélectionner garde les choix déjà faits, et prend la branche par défaut des autres", () => {
    const picked = Selection.empty.toggleWorkflow(front, "V0-1-1", 7, null);
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

const workflow = (id: number, state: WorkflowState = "active"): WorkflowSummary => ({
  id,
  name: "CI/CD",
  path: `.github/workflows/w${id}.yml`,
  state,
  htmlUrl: `https://github.com/Mask-AI-FR/x/actions/workflows/w${id}.yml`,
  latestRun: null,
});

describe("pipeline choisi d'un dépôt", () => {
  test("un seul workflow actif : il est choisi d'office, même sans choix retenu", () => {
    expect(chosenPipelineOf([workflow(1), workflow(2, "disabled_manually")], null)).toBe(1);
  });

  test("plusieurs workflows actifs : le choix retenu, sinon aucun", () => {
    expect(chosenPipelineOf([workflow(1), workflow(2)], 2)).toBe(2);
    expect(chosenPipelineOf([workflow(1), workflow(2)], null)).toBeNull();
  });

  test("un choix retenu qui n'existe plus ou est désactivé ne compte pas", () => {
    expect(chosenPipelineOf([workflow(1), workflow(2)], 9)).toBeNull();
    expect(chosenPipelineOf([workflow(1), workflow(2, "disabled_manually")], 2)).toBe(1);
  });

  test("aucun workflow actif : aucun pipeline", () => {
    expect(chosenPipelineOf([workflow(1, "disabled_manually")], 1)).toBeNull();
  });
});

describe("pipelines retenus par le navigateur", () => {
  test("relit les couples dépôt → identifiant", () => {
    const raw = JSON.stringify({ "Mask-AI-FR/MaskAI-Frontend": 12, "Mask-AI-FR/infra": 7 });
    expect([...parsePipelineChoices(raw)]).toEqual([
      ["Mask-AI-FR/MaskAI-Frontend", 12],
      ["Mask-AI-FR/infra", 7],
    ]);
  });

  test("une valeur absente, illisible ou d'une autre forme donne une mémoire vide", () => {
    expect(parsePipelineChoices(null).size).toBe(0);
    expect(parsePipelineChoices("{pas du json").size).toBe(0);
    expect(parsePipelineChoices("[12]").size).toBe(0);
    expect(parsePipelineChoices("null").size).toBe(0);
  });

  test("écarte les identifiants qui ne sont pas des entiers positifs", () => {
    const raw = JSON.stringify({ a: "12", b: -1, c: 1.5, d: null, e: 4 });
    expect([...parsePipelineChoices(raw)]).toEqual([["e", 4]]);
  });
});
