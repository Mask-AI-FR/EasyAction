import "../support/testEnv.ts";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { FakeGitHub, type FakeCommit, type FakeRepo } from "../support/fakeGithub.ts";
import { GitHubApiError } from "../../server/adapters/githubApi.ts";
import { branchOnlyCommits, defaultBranchHistory } from "../../server/adapters/githubCommits.ts";

const github = new FakeGitHub();
const settings = github.settings();
const TOKEN = "ghu_not-a-real-token";
const API = { owner: "acme", repo: "api" };

afterEach(() => github.reset());
afterAll(() => github.stop());

const commit = (oid: string, committedDate: string, author: FakeCommit["author"]): FakeCommit => ({ oid, committedDate, author });

function repo(overrides: Partial<FakeRepo> = {}): FakeRepo {
  return {
    name: "api",
    pushedAt: "2026-09-24T10:00:00Z",
    defaultBranch: "main",
    runs: [],
    branches: [{ name: "main", committedDate: "2026-09-24T10:00:00Z" }],
    history: [],
    branchOnly: {},
    ...overrides,
  };
}

async function all<T>(pages: AsyncGenerator<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const page of pages) found.push(page);
  return found;
}

const graphqlBodies = () => github.callsTo("POST", "/graphql").map((call) => JSON.parse(call.body) as { query: string; variables: Record<string, unknown> });

describe("commits de la branche par défaut (GraphQL)", () => {
  test("pages de 100 depuis `since` (à la seconde), auteur réduit à login et e-mail", async () => {
    const history = Array.from({ length: 150 }, (_, index) =>
      commit(`c${index}`, `2026-09-2${index < 100 ? 4 : 3}T10:00:00Z`, { email: "dev@example.com", user: index === 0 ? { login: "octo-cat" } : null }),
    );
    github.serveOrg("acme", [repo({ history })]);
    const pages = await all(defaultBranchHistory(settings, TOKEN, API, "2026-09-12T00:00:00.000Z"));
    expect(pages.map((page) => [page.commits.length, page.hasMore])).toEqual([
      [100, true],
      [50, false],
    ]);
    expect(pages[0]?.commits[0]).toEqual({ oid: "c0", committedAt: "2026-09-24T10:00:00Z", login: "octo-cat", email: "dev@example.com" });
    expect(graphqlBodies()[0]?.variables).toEqual({ owner: "acme", name: "api", since: "2026-09-12T00:00:00Z", cursor: null });
    expect(graphqlBodies()[1]?.variables.cursor).toBe("100");
  });

  test("dépôt vide (pas de branche par défaut) : aucune page", async () => {
    github.respond("POST", "/graphql", () => Response.json({ data: { repository: { defaultBranchRef: null } } }));
    expect(await all(defaultBranchHistory(settings, TOKEN, API, "2026-09-12T00:00:00Z"))).toEqual([]);
  });

  test("dépôt introuvable ou limite de débit GraphQL : codes d'échec stables", async () => {
    github.respond("POST", "/graphql", () =>
      Response.json({ data: { repository: null }, errors: [{ type: "NOT_FOUND", path: ["repository"] }] }),
    );
    const notFound = await all(defaultBranchHistory(settings, TOKEN, API, "2026-09-12T00:00:00Z")).catch((err: unknown) => err);
    expect((notFound as GitHubApiError).code).toBe("not_found");
    github.respond("POST", "/graphql", () => Response.json({ data: null, errors: [{ type: "RATE_LIMITED" }] }));
    const limited = await all(defaultBranchHistory(settings, TOKEN, API, "2026-09-12T00:00:00Z")).catch((err: unknown) => err);
    expect(limited).toBeInstanceOf(GitHubApiError);
    expect((limited as GitHubApiError).code).toBe("rate_limited");
  });
});

describe("commits propres aux autres branches (compare)", () => {
  test("les noms de branche partent en variables, jamais dans le texte de la requête", async () => {
    const tricky = 'feat/"quote"} { viewer { login } }';
    github.serveOrg("acme", [repo({ branchOnly: { [tricky]: [commit("x1", "2026-09-24T09:00:00Z", { email: null, user: { login: "octo-cat" } })] } })]);
    const result = await branchOnlyCommits(settings, TOKEN, API, [tricky]);
    expect(result).toEqual([
      { branch: tricky, commits: [{ oid: "x1", committedAt: "2026-09-24T09:00:00Z", login: "octo-cat", email: null }], complete: true },
    ]);
    const [body] = graphqlBodies();
    expect(body?.query).not.toContain("quote");
    expect(body?.variables.h0).toBe(`refs/heads/${tricky}`);
  });

  test("une branche disparue entre-temps est absente, les autres sont lues", async () => {
    github.serveOrg("acme", [repo({ branchOnly: { kept: [commit("k1", "2026-09-24T09:00:00Z", { email: "dev@example.com", user: null })] } })]);
    const result = await branchOnlyCommits(settings, TOKEN, API, ["gone", "kept"]);
    expect(result.map((branch) => branch.branch)).toEqual(["kept"]);
  });

  test("plus de 100 commits propres : les 100 plus récents, marqués incomplets", async () => {
    const many = Array.from({ length: 120 }, (_, index) => commit(`m${index}`, "2026-09-24T09:00:00Z", { email: null, user: null }));
    github.serveOrg("acme", [repo({ branchOnly: { big: many } })]);
    const [big] = await branchOnlyCommits(settings, TOKEN, API, ["big"]);
    expect(big?.commits).toHaveLength(100);
    expect(big?.commits[0]?.oid).toBe("m20");
    expect(big?.complete).toBe(false);
  });

  test("dix branches par requête au plus ; aucune requête sans branche", async () => {
    github.serveOrg("acme", [repo()]);
    expect(await branchOnlyCommits(settings, TOKEN, API, [])).toEqual([]);
    expect(github.callsTo("POST", "/graphql")).toHaveLength(0);
    await branchOnlyCommits(settings, TOKEN, API, Array.from({ length: 12 }, (_, index) => `b${index}`));
    expect(Object.keys(graphqlBodies()[0]?.variables ?? {}).filter((key) => key.startsWith("h"))).toHaveLength(10);
  });
});
