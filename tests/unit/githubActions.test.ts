import "../support/testEnv.ts";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeGitHub } from "../support/fakeGithub.ts";
import type { DispatchRejection, DispatchTarget } from "../../domain/dispatchContract.ts";
import { dispatchWorkflow, listRecentRuns, listWorkflows } from "../../server/adapters/githubActions.ts";

const github = new FakeGitHub();
const settings = github.env().github;
const TOKEN = "ghu_not-a-real-token";
const repo = { owner: "Mask-AI-FR", repo: "sandbox" };
const target: DispatchTarget = { owner: "Mask-AI-FR", repo: "sandbox", workflowId: 11, ref: "main" };
const WORKFLOWS_PATH = "/repos/Mask-AI-FR/sandbox/actions/workflows";
const RUNS_PATH = "/repos/Mask-AI-FR/sandbox/actions/runs";
const DISPATCH_PATH = "/repos/Mask-AI-FR/sandbox/actions/workflows/11/dispatches";

afterAll(() => github.stop());
beforeEach(() => github.reset());

function apiRun(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    workflow_id: 11,
    head_branch: "main",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    html_url: `https://github.com/Mask-AI-FR/sandbox/actions/runs/${id}`,
    created_at: "2026-09-24T10:00:00Z",
    run_started_at: "2026-09-24T10:00:05Z",
    updated_at: "2026-09-24T10:01:00Z",
    ...extra,
  };
}

describe("workflows d'un dépôt", () => {
  test("suit les pages ; un nom vide prend le chemin ; un état inconnu compte comme désactivé", async () => {
    github.respond("GET", WORKFLOWS_PATH, (request) => {
      if (new URL(request.url).searchParams.get("page") === "2") {
        return Response.json({
          workflows: [{ id: 12, name: "", path: ".github/workflows/nightly.yml", state: "paused_someday", html_url: "https://github.com/w/12" }],
        });
      }
      return Response.json(
        { workflows: [{ id: 11, name: "CI/CD", path: ".github/workflows/main.yml", state: "active", html_url: "https://github.com/w/11" }] },
        { headers: { Link: `<${github.url}${WORKFLOWS_PATH}?per_page=100&page=2>; rel="next"` } },
      );
    });
    expect(await listWorkflows(settings, TOKEN, repo)).toEqual([
      { id: 11, name: "CI/CD", path: ".github/workflows/main.yml", state: "active", htmlUrl: "https://github.com/w/11" },
      {
        id: 12,
        name: ".github/workflows/nightly.yml",
        path: ".github/workflows/nightly.yml",
        state: "disabled_manually",
        htmlUrl: "https://github.com/w/12",
      },
    ]);
  });
});

describe("exécutions récentes", () => {
  test("le filtre part chez GitHub ; un statut ou une conclusion inconnus sont normalisés", async () => {
    let asked = new URLSearchParams();
    github.respond("GET", RUNS_PATH, (request) => {
      asked = new URL(request.url).searchParams;
      return Response.json({
        workflow_runs: [
          apiRun(1),
          apiRun(2, { status: "brand_new", conclusion: null, run_started_at: null }),
          apiRun(3, { conclusion: "someday_value" }),
        ],
      });
    });
    const runs = await listRecentRuns(settings, TOKEN, repo, {
      branch: "feat/x",
      event: "workflow_dispatch",
      createdSince: "2026-09-24T09:50:00.000Z",
    });
    expect(asked.get("branch")).toBe("feat/x");
    expect(asked.get("event")).toBe("workflow_dispatch");
    expect(asked.get("created")).toBe(">=2026-09-24T09:50:00.000Z");
    expect(asked.get("exclude_pull_requests")).toBe("true");
    expect(runs.map((run) => [run.id, run.status, run.conclusion, run.startedAt])).toEqual([
      [1, "completed", "success", "2026-09-24T10:00:05Z"],
      [2, "pending", null, null],
      [3, "completed", "neutral", "2026-09-24T10:00:05Z"],
    ]);
    expect(runs[0]).toEqual({
      id: 1,
      workflowId: 11,
      branch: "main",
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      htmlUrl: "https://github.com/Mask-AI-FR/sandbox/actions/runs/1",
      createdAt: "2026-09-24T10:00:00Z",
      startedAt: "2026-09-24T10:00:05Z",
      updatedAt: "2026-09-24T10:01:00Z",
    });
  });
});

describe("déclenchement (workflow_dispatch)", () => {
  function answer(status: number, body: unknown = null, headers: Record<string, string> = {}): void {
    github.respond("POST", DISPATCH_PATH, () =>
      body === null ? new Response(null, { status, headers }) : Response.json(body, { status, headers }),
    );
  }

  test("200 : l'exécution créée (identifiant, lien) ; GitHub reçoit la branche et return_run_details", async () => {
    answer(200, {
      workflow_run_id: 987,
      run_url: "https://api.github.com/repos/Mask-AI-FR/sandbox/actions/runs/987",
      html_url: "https://github.com/Mask-AI-FR/sandbox/actions/runs/987",
    });
    expect(await dispatchWorkflow(settings, TOKEN, target)).toEqual({
      status: "dispatched",
      target,
      runId: 987,
      htmlUrl: "https://github.com/Mask-AI-FR/sandbox/actions/runs/987",
    });
    const call = github.callsTo("POST", DISPATCH_PATH)[0];
    expect(JSON.parse(call?.body ?? "null")).toEqual({ ref: "main", return_run_details: true });
    expect(call?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  test("204 sans détails (GitHub Enterprise Server plus ancien) : parti, sans identifiant", async () => {
    answer(204);
    expect(await dispatchWorkflow(settings, TOKEN, target)).toEqual({
      status: "dispatched",
      target,
      runId: null,
      htmlUrl: null,
    });
  });

  test("422 : le message de GitHub est classé en code stable, jamais relayé", async () => {
    const cases: [string, DispatchRejection][] = [
      ["Workflow does not have 'workflow_dispatch' trigger", "no_dispatch_trigger"],
      ["No ref found for: feat/x", "ref_not_found"],
      ["Required input 'environment' not provided", "missing_inputs"],
      ["Something GitHub has never said", "unprocessable"],
    ];
    for (const [message, code] of cases) {
      answer(422, { message, documentation_url: "https://docs.github.com" });
      expect(await dispatchWorkflow(settings, TOKEN, target)).toEqual({ status: "rejected", target, code });
    }
  });

  test("404, 403, SSO : refusé par GitHub, rien n'est parti", async () => {
    answer(404, { message: "Not Found" });
    expect(await dispatchWorkflow(settings, TOKEN, target)).toMatchObject({ status: "rejected", code: "not_found" });
    answer(403, { message: "Resource not accessible by integration" });
    expect(await dispatchWorkflow(settings, TOKEN, target)).toMatchObject({ status: "rejected", code: "forbidden" });
    answer(403, { message: "SSO" }, { "X-GitHub-SSO": "required; url=https://github.com/orgs/Mask-AI-FR/sso?authorization_request=1" });
    expect(await dispatchWorkflow(settings, TOKEN, target)).toMatchObject({ status: "rejected", code: "sso_required" });
  });

  test("limite de débit ou session terminée : « non tenté », le lot s'arrêtera là", async () => {
    answer(429, { message: "slow down" }, { "retry-after": "30" });
    expect(await dispatchWorkflow(settings, TOKEN, target)).toMatchObject({ status: "not_attempted", code: "rate_limited" });
    const reset = String(Math.floor(Date.now() / 1000) + 60);
    answer(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset });
    expect(await dispatchWorkflow(settings, TOKEN, target)).toMatchObject({ status: "not_attempted", code: "rate_limited" });
    answer(401, { message: "Bad credentials" });
    expect(await dispatchWorkflow(settings, TOKEN, target)).toMatchObject({ status: "not_attempted", code: "unauthorized" });
  });

  test("502 : issue inconnue et UN seul envoi — jamais de nouvelle tentative, un doublon redéploierait", async () => {
    answer(502, { message: "Server Error" });
    expect(await dispatchWorkflow(settings, TOKEN, target)).toEqual({ status: "unknown", target, code: "upstream" });
    expect(github.callsTo("POST", DISPATCH_PATH)).toHaveLength(1);
  });

  test("GitHub trop lent : issue inconnue (timeout), toujours un seul envoi", async () => {
    github.respond("POST", DISPATCH_PATH, async () => {
      await Bun.sleep(300);
      return new Response(null, { status: 204 });
    });
    expect(await dispatchWorkflow({ ...settings, timeoutMs: 50 }, TOKEN, target)).toEqual({
      status: "unknown",
      target,
      code: "timeout",
    });
    expect(github.callsTo("POST", DISPATCH_PATH)).toHaveLength(1);
  });
});
