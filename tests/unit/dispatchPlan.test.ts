import { describe, expect, test } from "bun:test";
import type { WorkflowState, WorkflowSummary } from "../../domain/githubTypes.ts";
import { planDispatch, summarizeOutcomes } from "../../domain/dispatchPlan.ts";
import type { DispatchTarget } from "../../domain/dispatchContract.ts";
import { Selection, type RepoRef } from "../../domain/selection.ts";

const front: RepoRef = { owner: "Mask-AI-FR", name: "MaskAI-Frontend", defaultBranch: "main" };
const org: RepoRef = { owner: "Mask-AI-FR", name: "MaskAI-Org_service", defaultBranch: "main" };
const infra: RepoRef = { owner: "Mask-AI-FR", name: "infra", defaultBranch: "main" };

const workflow = (id: number, state: WorkflowState = "active"): WorkflowSummary => ({
  id,
  name: "CI/CD",
  path: `.github/workflows/w${id}.yml`,
  state,
  htmlUrl: `https://github.com/Mask-AI-FR/x/actions/workflows/w${id}.yml`,
  latestRun: null,
});

const catalog: Record<string, WorkflowSummary[] | null> = {
  "MaskAI-Frontend": [workflow(1), workflow(2, "disabled_manually")],
  "MaskAI-Org_service": [workflow(3), workflow(4)],
  infra: null,
};
const workflowsOf = (repo: RepoRef) => catalog[repo.name] ?? null;

describe("plan de lancement", () => {
  test("« tous les workflows » ne prend que les actifs, sur la branche choisie", () => {
    const plan = planDispatch(Selection.empty.toggleRepo(front, "V0-1-1"), workflowsOf, 50);
    expect(plan.items).toEqual([
      {
        owner: "Mask-AI-FR",
        repo: "MaskAI-Frontend",
        workflowId: 1,
        ref: "V0-1-1",
        workflowName: "CI/CD",
        workflowPath: ".github/workflows/w1.yml",
        isDefaultBranch: false,
      },
    ]);
    expect(plan.defaultBranchCount).toBe(0);
  });

  test("compte les lancements sur la branche par défaut (production pour MaskAI)", () => {
    const plan = planDispatch(Selection.empty.toggleRepo(org, "main"), workflowsOf, 50);
    expect(plan.items).toHaveLength(2);
    expect(plan.defaultBranchCount).toBe(2);
    expect(plan.reposWithSeveral).toEqual(["Mask-AI-FR/MaskAI-Org_service"]);
  });

  test("un workflow choisi mais désactivé ne part pas ; un dépôt sans rien à lancer est signalé", () => {
    const selection = Selection.empty.toggleWorkflow(front, "main", 2, [1]);
    const plan = planDispatch(selection, workflowsOf, 50);
    expect(plan.items).toHaveLength(0);
    expect(plan.emptyRepos).toEqual(["Mask-AI-FR/MaskAI-Frontend"]);
  });

  test("un dépôt dont les workflows n'ont pas pu être lus ne lance rien (échec fermé)", () => {
    const plan = planDispatch(Selection.empty.toggleRepo(infra, "main"), workflowsOf, 50);
    expect(plan.items).toHaveLength(0);
    expect(plan.unreadableRepos).toEqual(["Mask-AI-FR/infra"]);
  });

  test("au-delà du plafond, le plan est marqué hors limite", () => {
    const selection = Selection.empty.toggleRepo(front, "main").toggleRepo(org, "main");
    expect(planDispatch(selection, workflowsOf, 3).overLimit).toBe(false);
    expect(planDispatch(selection, workflowsOf, 2).overLimit).toBe(true);
  });
});

describe("résumé d'un lancement", () => {
  const target: DispatchTarget = { owner: "Mask-AI-FR", repo: "sandbox", workflowId: 1, ref: "main" };

  test("compte chaque issue, zéro compris", () => {
    expect(
      summarizeOutcomes([
        { status: "dispatched", target, runId: 10, htmlUrl: "https://github.com/Mask-AI-FR/sandbox/actions/runs/10" },
        { status: "dispatched", target, runId: null, htmlUrl: null },
        { status: "rejected", target, code: "no_dispatch_trigger" },
        { status: "unknown", target, code: "timeout" },
      ]),
    ).toEqual({ dispatched: 2, rejected: 1, not_attempted: 0, unknown: 1 });
  });
});
