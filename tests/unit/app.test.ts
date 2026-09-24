import "../support/testEnv.ts";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { FakeGitHub } from "../support/fakeGithub.ts";
import { buildApp } from "../../server/app.ts";
import { deriveSessionKey, sealSession } from "../../server/auth/sessionCookie.ts";
import { parseEnv } from "../../server/config/env.ts";
import type { ApiErrorBody, BranchesBody, ReposBody, SessionBody, WorkflowsBody } from "../../domain/apiContract.ts";
import type { DispatchBody, RunsBody } from "../../domain/dispatchContract.ts";

const app = () => buildApp(parseEnv(process.env));
const github = new FakeGitHub();

afterEach(() => {
  spyOn(process.stderr, "write").mockRestore();
  spyOn(process.stdout, "write").mockRestore();
});

afterAll(() => github.stop());

interface Call {
  readonly method?: "GET" | "POST";
  /** En-tête `Origin` : le navigateur l'envoie sur un POST ; le garde refuse un POST sans lui. */
  readonly origin?: string;
  readonly json?: unknown;
}

/** Requête d'un utilisateur connecté, contre le faux GitHub. */
async function signedIn(path: string, call: Call = {}): Promise<Response> {
  const env = github.env();
  const sealed = await sealSession(
    {
      userId: 42,
      login: "octo-test",
      avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
      accessToken: "ghu_not-a-real-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
    deriveSessionKey(env.sessionSecret),
  );
  const headers: Record<string, string> = { Cookie: `pipliner_session=${sealed}` };
  if (call.origin) headers.Origin = call.origin;
  if (call.json !== undefined) headers["Content-Type"] = "application/json";
  const body = call.json === undefined ? undefined : JSON.stringify(call.json);
  return buildApp(env).request(path, { method: call.method ?? "GET", headers, body });
}

function installations(): void {
  github.respond("GET", "/user/installations", () =>
    Response.json({
      installations: [
        {
          id: 7,
          app_slug: "pipliner-dev",
          repository_selection: "selected",
          account: { login: "Mask-AI-FR", avatar_url: "https://avatars.githubusercontent.com/u/7?v=4", type: "Organization" },
        },
      ],
    }),
  );
}

describe("application HTTP", () => {
  test("GET /health répond comme les services MaskAI", async () => {
    const response = await app().request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "pipliner" });
  });

  test("chaque réponse interdit l'encadrement par un autre site", async () => {
    const response = await app().request("/health");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
  });

  test("la CSP n'autorise d'autres images que les avatars GitHub (github.com ou GHES)", async () => {
    const cspFor = async (webUrl: string) => {
      const instance = buildApp(parseEnv({ ...process.env, GITHUB_WEB_URL: webUrl }));
      const response = await instance.request("/health");
      return response.headers.get("content-security-policy") ?? "";
    };
    expect(await cspFor("https://github.com")).toContain(
      "img-src 'self' https://avatars.githubusercontent.com;",
    );
    expect(await cspFor("https://ghe.example.org")).toContain(
      "img-src 'self' https://ghe.example.org https://avatars.ghe.example.org;",
    );
  });

  test("l'API exige une session : 401 JSON, jamais mis en cache", async () => {
    const response = await app().request("/api/session");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      detail: { code: "unauthorized", message: "Sign in required" },
    });
  });

  test("une adresse d'authentification inconnue répond un 404 JSON, pas la page de l'app", async () => {
    const response = await app().request("/auth/inconnue");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      detail: { code: "not_found", message: "Not Found" },
    });
  });

  test("une erreur inattendue répond 500 sans exposer son message, ni au client ni au journal", async () => {
    const logged: string[] = [];
    spyOn(process.stderr, "write").mockImplementation((chunk) => {
      logged.push(String(chunk));
      return true;
    });
    const instance = app();
    instance.get("/boom", () => {
      throw new Error("détail interne à ne pas divulguer");
    });
    const response = await instance.request("/boom");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("détail interne");
    expect(logged.join("")).toContain("http.unhandled_error");
    expect(logged.join("")).not.toContain("détail interne");
  });
});

describe("organisations et dépôts (API)", () => {
  beforeEach(() => {
    github.reset();
    // Le journal des échecs GitHub écrit sur stdout/stderr : on le fait taire ici.
    spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  test("GET /api/orgs : les organisations et le lien d'installation, jamais l'identifiant d'installation", async () => {
    installations();
    const response = await signedIn("/api/orgs");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orgs: [
        {
          login: "Mask-AI-FR",
          avatarUrl: "https://avatars.githubusercontent.com/u/7?v=4",
          repositorySelection: "selected",
        },
      ],
      installUrl: `${github.url}/apps/pipliner-dev/installations/new`,
    });
  });

  test("GET /api/orgs/:org/repos : l'organisation se retrouve sans tenir compte de la casse", async () => {
    installations();
    github.respond("GET", "/user/installations/7/repositories", () =>
      Response.json({
        total_count: 1,
        repositories: [
          {
            id: 1,
            name: "MaskAI-Frontend",
            full_name: "Mask-AI-FR/MaskAI-Frontend",
            owner: { login: "Mask-AI-FR" },
            description: "Next.js app",
            private: true,
            visibility: "private",
            archived: false,
            language: "TypeScript",
            default_branch: "main",
            pushed_at: "2026-09-18T10:00:00Z",
            html_url: "https://github.com/Mask-AI-FR/MaskAI-Frontend",
          },
        ],
      }),
    );
    const response = await signedIn("/api/orgs/mask-ai-fr/repos");
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReposBody;
    expect(body.org).toBe("Mask-AI-FR");
    expect(body.totalCount).toBe(1);
    expect(body.truncated).toBe(false);
    expect(body.repos[0]?.name).toBe("MaskAI-Frontend");
  });

  test("une organisation sans l'app : 404, sans interroger ses dépôts", async () => {
    installations();
    const response = await signedIn("/api/orgs/Other-Org/repos");
    expect(response.status).toBe(404);
    expect(((await response.json()) as ApiErrorBody).detail.code).toBe("not_found");
    expect(github.calls.filter((call) => call.path.includes("/repositories"))).toHaveLength(0);
  });

  test("un nom d'organisation invalide est refusé avant tout appel à GitHub", async () => {
    const response = await signedIn("/api/orgs/bad--name/repos");
    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiErrorBody).detail.code).toBe("bad_request");
    expect(github.calls).toHaveLength(0);
  });

  test("GitHub dit « jeton invalide » : notre 401, et l'app renvoie vers la connexion", async () => {
    github.respond("GET", "/user/installations", () => new Response("Bad credentials", { status: 401 }));
    const response = await signedIn("/api/orgs");
    expect(response.status).toBe(401);
    expect(((await response.json()) as ApiErrorBody).detail.code).toBe("unauthorized");
  });

  test("limite de débit : 429 avec Retry-After, et le corps de GitHub n'est jamais relayé", async () => {
    github.respond("GET", "/user/installations", () =>
      new Response("corps GitHub à ne pas relayer", { status: 429, headers: { "retry-after": "30" } }),
    );
    const response = await signedIn("/api/orgs");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    const text = await response.text();
    expect(text).not.toContain("corps GitHub");
    expect(JSON.parse(text).detail).toEqual({
      code: "rate_limited",
      message: "GitHub rate limit reached.",
      retryAfterSeconds: 30,
    });
  });
});

describe("branches, workflows, exécutions et lancement (API)", () => {
  const ORIGIN = github.env().appOrigin;
  const REPO = "/api/repos/Mask-AI-FR/sandbox";
  const DISPATCH_PATH = "/repos/Mask-AI-FR/sandbox/actions/workflows/11/dispatches";

  beforeEach(() => {
    github.reset();
    spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  function run(id: number, workflowId: number, status: string, conclusion: string | null) {
    return {
      id,
      workflow_id: workflowId,
      head_branch: "main",
      event: "workflow_dispatch",
      status,
      conclusion,
      html_url: `https://github.com/Mask-AI-FR/sandbox/actions/runs/${id}`,
      created_at: `2026-09-24T10:0${id % 10}:00Z`,
      run_started_at: null,
      updated_at: "2026-09-24T10:10:00Z",
    };
  }

  test("GET /api/session donne les plafonds dont l'interface a besoin, jamais le jeton", async () => {
    const body = (await (await signedIn("/api/session")).json()) as SessionBody;
    expect(body.limits).toEqual({ dispatchMaxTargets: 50, runPollMinSeconds: 10, runTrackMaxMinutes: 30 });
    expect(JSON.stringify(body)).not.toContain("ghu_");
  });

  test("GET …/branches : liste GraphQL rangée, branche par défaut en tête", async () => {
    github.respond("POST", "/graphql", () =>
      Response.json({
        data: {
          repository: {
            defaultBranchRef: { name: "main" },
            refs: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                { name: "feat/x", target: { committedDate: new Date().toISOString() } },
                { name: "main", target: { committedDate: "2020-01-01T00:00:00Z" } },
              ],
            },
          },
        },
      }),
    );
    const response = await signedIn(`${REPO}/branches`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as BranchesBody;
    expect(body.branches.map((branch) => [branch.name, branch.active])).toEqual([
      ["main", true],
      ["feat/x", true],
    ]);
  });

  test("GET …/workflows?branch= : chaque workflow avec sa dernière exécution sur cette branche", async () => {
    let asked = new URLSearchParams();
    github.respond("GET", "/repos/Mask-AI-FR/sandbox/actions/workflows", () =>
      Response.json({
        workflows: [
          { id: 11, name: "CI/CD", path: ".github/workflows/main.yml", state: "active", html_url: "https://github.com/w/11" },
          { id: 12, name: "Nightly", path: ".github/workflows/nightly.yml", state: "disabled_manually", html_url: "https://github.com/w/12" },
        ],
      }),
    );
    github.respond("GET", "/repos/Mask-AI-FR/sandbox/actions/runs", (request) => {
      asked = new URL(request.url).searchParams;
      return Response.json({ workflow_runs: [run(9, 11, "in_progress", null), run(8, 11, "completed", "success")] });
    });
    const response = await signedIn(`${REPO}/workflows?branch=main`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as WorkflowsBody;
    expect(asked.get("branch")).toBe("main");
    expect(body.branch).toBe("main");
    expect(body.workflows.map((workflow) => [workflow.id, workflow.latestRun?.id ?? null])).toEqual([
      [11, 9],
      [12, null],
    ]);
  });

  test("entrées invalides refusées avant tout appel à GitHub : branche absente, dépôt, identifiants", async () => {
    const invalid = [
      `${REPO}/workflows`,
      "/api/repos/bad--owner/sandbox/branches",
      "/api/repos/Mask-AI-FR/a%20b/branches",
      `${REPO}/runs?ids=abc&since=2026-09-24T10:00:00Z`,
    ];
    for (const path of invalid) {
      const response = await signedIn(path);
      expect([path, response.status]).toEqual([path, 400]);
    }
    expect(github.calls).toHaveLength(0);
  });

  test("GET …/runs : seulement les exécutions suivies, lancées depuis `since`", async () => {
    let asked = new URLSearchParams();
    github.respond("GET", "/repos/Mask-AI-FR/sandbox/actions/runs", (request) => {
      asked = new URL(request.url).searchParams;
      return Response.json({ workflow_runs: [run(5, 11, "queued", null), run(6, 11, "completed", "failure"), run(7, 11, "queued", null)] });
    });
    const response = await signedIn(`${REPO}/runs?ids=5,6&since=2026-09-24T10:00:00.000Z`);
    const body = (await response.json()) as RunsBody;
    expect(body.runs.map((tracked) => tracked.id)).toEqual([5, 6]);
    expect(asked.get("event")).toBe("workflow_dispatch");
    expect(asked.get("created")).toBe(">=2026-09-24T10:00:00.000Z");
  });

  test("POST /api/dispatches sans en-tête Origin : 403, rien n'est lancé", async () => {
    const targets = [{ owner: "Mask-AI-FR", repo: "sandbox", workflowId: 11, ref: "main" }];
    const response = await signedIn("/api/dispatches", { method: "POST", json: { targets } });
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  test("POST /api/dispatches : corps invalide ou au-delà de DISPATCH_MAX_TARGETS → 400, rien n'est lancé", async () => {
    const invalid = await signedIn("/api/dispatches", { method: "POST", origin: ORIGIN, json: { targets: [] } });
    expect(invalid.status).toBe(400);
    const tooMany = Array.from({ length: 51 }, (_, index) => ({ owner: "Mask-AI-FR", repo: "sandbox", workflowId: index + 1, ref: "main" }));
    const capped = await signedIn("/api/dispatches", { method: "POST", origin: ORIGIN, json: { targets: tooMany } });
    expect(capped.status).toBe(400);
    expect(github.calls).toHaveLength(0);
  });

  test("POST /api/dispatches : une issue par cible, un seul envoi chacune, le message de GitHub jamais relayé", async () => {
    github.respond("POST", DISPATCH_PATH, () =>
      Response.json({ workflow_run_id: 77, html_url: "https://github.com/Mask-AI-FR/sandbox/actions/runs/77" }),
    );
    github.respond("POST", "/repos/Mask-AI-FR/sandbox/actions/workflows/12/dispatches", () =>
      Response.json({ message: "Workflow does not have 'workflow_dispatch' trigger" }, { status: 422 }),
    );
    const ci = { owner: "Mask-AI-FR", repo: "sandbox", workflowId: 11, ref: "main" };
    const nightly = { ...ci, workflowId: 12 };
    const targets = [ci, nightly];
    const response = await signedIn("/api/dispatches", { method: "POST", origin: ORIGIN, json: { targets } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("does not have");
    expect((JSON.parse(text) as DispatchBody).outcomes).toEqual([
      { status: "dispatched", target: ci, runId: 77, htmlUrl: "https://github.com/Mask-AI-FR/sandbox/actions/runs/77" },
      { status: "rejected", target: nightly, code: "no_dispatch_trigger" },
    ]);
    expect(github.calls.filter((call) => call.method === "POST")).toHaveLength(2);
  });
});

describe("application pré-construite (production)", () => {
  test("page d'entrée revalidée à chaque visite, fichiers hachés en cache long, API jamais servie en HTML", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { serveBuiltApp } = await import("../../server/app.ts");
    const dist = await mkdtemp(join(tmpdir(), "pipliner-dist-"));
    try {
      await writeFile(join(dist, "index.html"), "<!doctype html><title>Pipliner</title>");
      await writeFile(join(dist, "chunk-abc123.js"), "export {};");
      const instance = app();
      serveBuiltApp(instance, dist);

      const deepLink = await instance.request("/orgs/Mask-AI-FR?page=2");
      expect(deepLink.status).toBe(200);
      expect(await deepLink.text()).toContain("<title>Pipliner</title>");
      expect(deepLink.headers.get("cache-control")).toBe("no-cache");
      expect(deepLink.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");

      const chunk = await instance.request("/chunk-abc123.js");
      expect(chunk.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

      const api = await instance.request("/api/inconnue");
      expect(api.status).toBe(401);
      expect(api.headers.get("content-type")).toContain("application/json");
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });
});
