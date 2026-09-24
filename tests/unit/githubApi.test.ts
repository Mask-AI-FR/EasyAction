import "../support/testEnv.ts";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeGitHub } from "../support/fakeGithub.ts";
import { GitHubApiError } from "../../server/adapters/githubApi.ts";
import { listBranches, listInstallationRepos, listOrgInstallations } from "../../server/adapters/githubRepos.ts";

const github = new FakeGitHub();
const settings = github.env().github;
const TOKEN = "ghu_not-a-real-token";

afterAll(() => github.stop());
beforeEach(() => github.reset());

function installation(id: number, login: string, type = "Organization") {
  return {
    id,
    app_slug: "pipliner-dev",
    repository_selection: "all",
    account: { login, avatar_url: `https://avatars.githubusercontent.com/u/${id}?v=4`, type },
  };
}

function apiRepo(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `repo-${id}`,
    full_name: `Mask-AI-FR/repo-${id}`,
    owner: { login: "Mask-AI-FR" },
    description: null,
    private: true,
    visibility: "private",
    archived: false,
    language: "TypeScript",
    default_branch: "main",
    pushed_at: "2026-09-18T10:00:00Z",
    html_url: `https://github.com/Mask-AI-FR/repo-${id}`,
    ...extra,
  };
}

/** Répond page par page selon `?page=`, avec l'en-tête `Link` vers la suivante. */
function paged(pages: readonly object[], nextBase: string) {
  return (request: Request) => {
    const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
    const headers: Record<string, string> =
      page < pages.length ? { Link: `<${nextBase}&page=${page + 1}>; rel="next"` } : {};
    return Response.json(pages[page - 1], { headers });
  };
}

async function failureOf(promise: Promise<unknown>): Promise<GitHubApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof GitHubApiError) return err;
    throw err;
  }
  throw new Error("aucun échec");
}

describe("installations de l'app", () => {
  test("suit les pages et ne garde que les organisations (pas les comptes personnels)", async () => {
    github.respond(
      "GET",
      "/user/installations",
      paged(
        [
          { installations: [installation(1, "Mask-AI-FR"), installation(2, "someone", "User")] },
          { installations: [installation(3, "Other-Org")] },
        ],
        `${github.url}/user/installations?per_page=100`,
      ),
    );
    const found = await listOrgInstallations(settings, TOKEN);
    expect(found.map((item) => item.org.login)).toEqual(["Mask-AI-FR", "Other-Org"]);
    expect(found[0]).toEqual({
      id: 1,
      appSlug: "pipliner-dev",
      org: {
        login: "Mask-AI-FR",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        repositorySelection: "all",
      },
    });
    const first = github.callsTo("GET", "/user/installations")[0];
    expect(first?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(first?.headers.get("x-github-api-version")).toBe("2022-11-28");
  });

  test("ne suit jamais une page suivante hors de notre GitHub : le jeton n'en sort pas", async () => {
    github.respond("GET", "/user/installations", () =>
      Response.json(
        { installations: [installation(1, "Mask-AI-FR")] },
        { headers: { Link: '<https://evil.example/user/installations?page=2>; rel="next"' } },
      ),
    );
    const found = await listOrgInstallations(settings, TOKEN);
    expect(found).toHaveLength(1);
    expect(github.callsTo("GET", "/user/installations")).toHaveLength(1);
  });
});

describe("dépôts d'une installation", () => {
  const path = "/user/installations/1/repositories";
  const hundred = Array.from({ length: 100 }, (_, i) => apiRepo(i + 1));
  const fifty = Array.from({ length: 50 }, (_, i) => apiRepo(i + 101));

  function twoPages(): void {
    github.respond(
      "GET",
      path,
      paged(
        [
          { total_count: 150, repositories: hundred },
          { total_count: 150, repositories: fifty },
        ],
        `${github.url}${path}?per_page=100`,
      ),
    );
  }

  test("lit toutes les pages sous le plafond", async () => {
    twoPages();
    const { repos, totalCount } = await listInstallationRepos(settings, TOKEN, 1, 1000);
    expect(repos).toHaveLength(150);
    expect(totalCount).toBe(150);
    expect(repos[0]).toEqual({
      id: 1,
      owner: "Mask-AI-FR",
      name: "repo-1",
      fullName: "Mask-AI-FR/repo-1",
      description: null,
      visibility: "private",
      archived: false,
      language: "TypeScript",
      defaultBranch: "main",
      pushedAt: "2026-09-18T10:00:00Z",
      htmlUrl: "https://github.com/Mask-AI-FR/repo-1",
    });
  });

  test("s'arrête au plafond REPOS_MAX en gardant le total annoncé (la page affiche « tronqué »)", async () => {
    twoPages();
    const { repos, totalCount } = await listInstallationRepos(settings, TOKEN, 1, 60);
    expect(repos).toHaveLength(60);
    expect(totalCount).toBe(150);
    expect(github.callsTo("GET", path)).toHaveLength(1);
  });

  test("visibilité absente (vieux GitHub Enterprise Server) : déduite de `private`", async () => {
    const { visibility: _unused, ...legacy } = apiRepo(7, { private: false });
    github.respond("GET", path, () => Response.json({ total_count: 1, repositories: [legacy] }));
    const { repos } = await listInstallationRepos(settings, TOKEN, 1, 10);
    expect(repos[0]?.visibility).toBe("public");
  });

  test("une réponse mal formée devient un échec `upstream`, jamais un undefined", async () => {
    github.respond("GET", path, () => Response.json({ total_count: 1, repositories: [{ id: "x" }] }));
    expect((await failureOf(listInstallationRepos(settings, TOKEN, 1, 10))).code).toBe("upstream");
  });
});

describe("branches d'un dépôt (GraphQL)", () => {
  const sandbox = { owner: "Mask-AI-FR", repo: "sandbox" };
  const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const old = new Date(Date.now() - 200 * 86_400_000).toISOString();

  /** Répond page par page selon le curseur envoyé (« 1 », « 2 »…), comme l'API GraphQL. */
  function branchPages(pages: readonly { name: string; committedDate: string }[][]): void {
    github.respond("POST", "/graphql", async (request) => {
      const { variables } = (await request.json()) as { variables: { cursor: string | null } };
      const index = variables.cursor === null ? 0 : Number(variables.cursor);
      const hasNextPage = index + 1 < pages.length;
      const nodes = (pages[index] ?? []).map(({ name, committedDate }) => ({ name, target: { committedDate } }));
      return Response.json({
        data: {
          repository: {
            defaultBranchRef: { name: "main" },
            refs: { pageInfo: { hasNextPage, endCursor: hasNextPage ? String(index + 1) : null }, nodes },
          },
        },
      });
    });
  }

  test("branche par défaut d'abord, puis la plus récente ; « active » selon ACTIVE_BRANCH_DAYS", async () => {
    branchPages([
      [
        { name: "alpha", committedDate: old },
        { name: "main", committedDate: old },
      ],
      [{ name: "zeta", committedDate: recent }],
    ]);
    const result = await listBranches(settings, TOKEN, sandbox, { max: 300, activeDays: 90 });
    expect(result).toEqual({
      defaultBranch: "main",
      truncated: false,
      branches: [
        { name: "main", committedAt: old, active: true },
        { name: "zeta", committedAt: recent, active: true },
        { name: "alpha", committedAt: old, active: false },
      ],
    });
    const calls = github.callsTo("POST", "/graphql");
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0]?.body ?? "{}").variables).toEqual({ owner: "Mask-AI-FR", name: "sandbox", cursor: null });
  });

  test("s'arrête au plafond BRANCHES_MAX et le signale (« tronqué »)", async () => {
    branchPages([
      [
        { name: "a", committedDate: recent },
        { name: "b", committedDate: recent },
      ],
      [{ name: "c", committedDate: recent }],
    ]);
    const result = await listBranches(settings, TOKEN, sandbox, { max: 2, activeDays: 90 });
    expect(result.truncated).toBe(true);
    expect(result.branches).toHaveLength(2);
    expect(github.callsTo("POST", "/graphql")).toHaveLength(1);
  });

  test("dépôt invisible : GraphQL répond 200 avec une erreur NOT_FOUND, traduite en « introuvable »", async () => {
    github.respond("POST", "/graphql", () =>
      Response.json({ data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve" }] }),
    );
    const failure = await failureOf(listBranches(settings, TOKEN, sandbox, { max: 10, activeDays: 90 }));
    expect(failure.code).toBe("not_found");
  });
});

describe("échecs GitHub traduits en codes stables", () => {
  const answer = (status: number, headers: Record<string, string> = {}) =>
    github.respond("GET", "/user/installations", () => new Response("corps GitHub à ne pas relayer", { status, headers }));

  test("401 : session GitHub terminée", async () => {
    answer(401);
    expect((await failureOf(listOrgInstallations(settings, TOKEN))).code).toBe("unauthorized");
  });

  test("403 avec X-GitHub-SSO : SSO SAML requis, avec le lien d'autorisation", async () => {
    answer(403, { "X-GitHub-SSO": "required; url=https://github.com/orgs/Mask-AI-FR/sso?authorization_request=abc" });
    const failure = await failureOf(listOrgInstallations(settings, TOKEN));
    expect(failure.code).toBe("sso_required");
    expect(failure.details.ssoUrl).toBe("https://github.com/orgs/Mask-AI-FR/sso?authorization_request=abc");
  });

  test("403 quota épuisé, ou 429 : limite de débit, avec le délai d'attente", async () => {
    const reset = Math.floor(Date.now() / 1000) + 120;
    answer(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) });
    const quota = await failureOf(listOrgInstallations(settings, TOKEN));
    expect(quota.code).toBe("rate_limited");
    expect(quota.details.retryAfterSeconds).toBeGreaterThanOrEqual(118);
    answer(429, { "retry-after": "30" });
    expect((await failureOf(listOrgInstallations(settings, TOKEN))).details.retryAfterSeconds).toBe(30);
  });

  test("403 simple, 404, 500 : refus, introuvable, panne", async () => {
    answer(403);
    expect((await failureOf(listOrgInstallations(settings, TOKEN))).code).toBe("forbidden");
    answer(404);
    expect((await failureOf(listOrgInstallations(settings, TOKEN))).code).toBe("not_found");
    answer(500);
    expect((await failureOf(listOrgInstallations(settings, TOKEN))).code).toBe("upstream");
  });

  test("GitHub trop lent : échec `timeout` au bout du délai configuré", async () => {
    github.respond("GET", "/user/installations", async () => {
      await Bun.sleep(300);
      return Response.json({ installations: [] });
    });
    const failure = await failureOf(listOrgInstallations({ ...settings, timeoutMs: 50 }, TOKEN));
    expect(failure.code).toBe("timeout");
  });
});
