import "../support/testEnv.ts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { FAKE_INSTALLATION_ID, FakeGitHub, type FakeCommit, type FakeRepo, type FakeRun } from "../support/fakeGithub.ts";
import { defaultLimits } from "../../domain/settingsCatalog.ts";
import { GitHubApiError } from "../../server/adapters/githubApi.ts";
import type { Limits } from "../../server/config/env.ts";
import { DashboardCollector, type DashboardRequest } from "../../server/services/dashboardCollector.ts";

/** Vendredi 25 septembre 2026, 10:30 UTC : période de 7 jours du 19 au 25, précédente du 12 au 18 (10:30). */
const NOW = new Date("2026-09-25T10:30:00Z");
const github = new FakeGitHub();

beforeAll(() => setSystemTime(NOW));
beforeEach(() => spyOn(process.stdout, "write").mockImplementation(() => true));
afterEach(() => {
  spyOn(process.stdout, "write").mockRestore();
  github.reset();
});
afterAll(() => {
  setSystemTime();
  github.stop();
});

function fakeRun(createdAt: string, conclusion: string | null = "success", extra: Partial<FakeRun> = {}): FakeRun {
  return {
    workflow_id: 1,
    name: "CI",
    path: ".github/workflows/ci.yml",
    status: conclusion === null ? "in_progress" : "completed",
    conclusion,
    created_at: createdAt,
    run_started_at: createdAt,
    updated_at: createdAt,
    head_branch: "main",
    event: "push",
    html_url: `https://github.com/acme/api/actions/runs/${createdAt}`,
    ...extra,
  };
}

const byLogin = (login: string): FakeCommit["author"] => ({ email: `${login}@example.com`, user: { login } });
const byEmail = (email: string): FakeCommit["author"] => ({ email, user: null });
const fakeCommit = (oid: string, committedDate: string, author: FakeCommit["author"]): FakeCommit => ({ oid, committedDate, author });

function fakeRepo(name: string, overrides: Partial<FakeRepo> = {}): FakeRepo {
  return {
    name,
    pushedAt: "2026-09-24T12:00:00Z",
    defaultBranch: "main",
    runs: [],
    branches: [{ name: "main", committedDate: "2026-09-24T12:00:00Z" }],
    history: [],
    branchOnly: {},
    ...overrides,
  };
}

/** L'organisation de référence : deux dépôts actifs et un archivé. */
function referenceOrg(): FakeRepo[] {
  const shared = fakeCommit("x1", "2026-09-23T09:00:00Z", byEmail("321+carol@users.noreply.github.com"));
  return [
    fakeRepo("api", {
      runs: [
        fakeRun("2026-09-24T09:00:00Z"),
        fakeRun("2026-09-23T09:00:00Z"),
        fakeRun("2026-09-22T09:00:00Z", "failure"),
        fakeRun("2026-09-15T09:00:00Z"),
      ],
      branches: [
        { name: "main", committedDate: "2026-09-24T12:00:00Z" },
        { name: "feat", committedDate: "2026-09-23T09:00:00Z" },
        { name: "feat-2", committedDate: "2026-09-23T09:00:00Z" },
        { name: "stale", committedDate: "2026-01-01T00:00:00Z" },
      ],
      history: [
        fakeCommit("c1", "2026-09-24T12:00:00Z", byLogin("octo-cat")),
        fakeCommit("c2", "2026-09-22T12:00:00Z", byEmail("Dev@Example.com")),
        fakeCommit("c3", "2026-09-21T12:00:00Z", byEmail("49699333+dependabot[bot]@users.noreply.github.com")),
        fakeCommit("c4", "2026-09-14T12:00:00Z", byLogin("octo-cat")),
      ],
      branchOnly: { feat: [shared], "feat-2": [shared] },
    }),
    fakeRepo("web", { pushedAt: "2026-09-20T12:00:00Z", runs: [fakeRun("2026-09-24T10:00:00Z", "cancelled")] }),
    fakeRepo("legacy", { archived: true }),
  ];
}

function request(overrides: Partial<Omit<DashboardRequest, "limits">> & { readonly limits?: Partial<Limits> } = {}): DashboardRequest {
  return {
    session: { idHash: "session-a", userId: 42 },
    installation: {
      id: FAKE_INSTALLATION_ID,
      appSlug: "pipliner-test",
      org: { login: "acme", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4", repositorySelection: "all" },
    },
    days: 7,
    fresh: false,
    github: github.settings(),
    token: "ghu_not-a-real-token",
    deadline: Date.now() + 60_000,
    ...overrides,
    limits: { ...defaultLimits(), ...overrides.limits },
  };
}

const reposListings = () => github.callsTo("GET", `/user/installations/${FAKE_INSTALLATION_ID}/repositories`).length;

describe("collecte du tableau de bord", () => {
  test("exécutions des deux périodes, branches, personnes sur toutes les branches (sans doublon ni robot)", async () => {
    github.serveOrg("acme", referenceOrg());
    const body = await new DashboardCollector().dashboard(request());
    expect(body.kpis.successfulRuns).toEqual({ current: 2, previous: 1 });
    expect(body.kpis.failedRuns).toEqual({ current: 1, previous: 0 });
    // octo-cat, dev@example.com et carol (noreply) ; le robot ne compte pas ; x1 est sur deux branches.
    expect(body.kpis.committers).toEqual({ current: 3, previous: 1 });
    expect(body.kpis.branches).toBe(5);
    expect(body.repositories.map((repo) => [repo.name, repo.success, repo.failed, repo.other, repo.committers])).toEqual([
      ["api", 2, 1, 0, 3],
      ["web", 0, 0, 1, 0],
    ]);
    expect(body.coverage).toMatchObject({ repositories: 3, read: 2, archived: 1, beyondLimit: 0, unreadable: [], notCollected: [] });
    expect(JSON.stringify(body)).not.toMatch(/octo-cat|example\.com|carol/);
  });

  test("périodes demandées à GitHub à la seconde ; seules les branches actives sont comparées", async () => {
    github.serveOrg("acme", referenceOrg());
    await new DashboardCollector().dashboard(request());
    const created = github
      .callsTo("GET", "/repos/acme/api/actions/runs")
      .map((call) => new URLSearchParams(call.search).get("created"));
    expect(created.sort()).toEqual([
      "2026-09-12T00:00:00Z..2026-09-18T10:30:00Z",
      "2026-09-19T00:00:00Z..2026-09-25T10:30:00Z",
    ]);
    const compared = github
      .callsTo("POST", "/graphql")
      .map((call) => JSON.parse(call.body) as { query: string; variables: Record<string, string> })
      .filter((body) => body.query.includes("compare(headRef"))
      .flatMap((body) => Object.entries(body.variables).filter(([key]) => key.startsWith("h")).map(([, head]) => head));
    expect(compared.sort()).toEqual(["refs/heads/feat", "refs/heads/feat-2"]);
  });

  test("les dépôts les plus récemment poussés d'abord, jusqu'au plafond ; le reste est compté à part", async () => {
    github.serveOrg("acme", referenceOrg());
    const body = await new DashboardCollector().dashboard(request({ limits: { statsMaxRepos: 1 } }));
    expect(body.repositories.map((repo) => repo.name)).toEqual(["api"]);
    expect(body.coverage.beyondLimit).toBe(1);
  });

  test("un dépôt sans push depuis le début de la période précédente : aucun commit demandé", async () => {
    github.serveOrg("acme", [fakeRepo("quiet", { pushedAt: "2026-08-01T00:00:00Z" })]);
    await new DashboardCollector().dashboard(request());
    const queries = github.callsTo("POST", "/graphql").map((call) => (JSON.parse(call.body) as { query: string }).query);
    expect(queries.some((query) => query.includes("history(since"))).toBe(false);
  });

  test("ÉCHEC OUVERT : un dépôt illisible est nommé, les autres comptent, aucune comparaison n'est donnée", async () => {
    const repos = referenceOrg();
    github.serveOrg("acme", [repos[0] as FakeRepo, fakeRepo("web", { runsFailure: () => new Response("", { status: 404 }) })]);
    const body = await new DashboardCollector().dashboard(request());
    expect(body.coverage.unreadable).toEqual(["web"]);
    expect(body.kpis.successfulRuns).toEqual({ current: 2, previous: null });
  });

  test("ÉCHEC FERMÉ : une limite de débit arrête tout, et rien n'est gardé en mémoire", async () => {
    const limited = () => new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "0" } });
    github.serveOrg("acme", [fakeRepo("api", { runsFailure: limited })]);
    const collector = new DashboardCollector();
    const failure = await collector.dashboard(request()).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(GitHubApiError);
    expect((failure as GitHubApiError).code).toBe("rate_limited");
    await collector.dashboard(request()).catch(() => undefined);
    expect(reposListings()).toBe(2);
  });

  test("échéance passée : les dépôts sont nommés « pas lus », le tableau de bord répond quand même", async () => {
    github.serveOrg("acme", referenceOrg());
    const body = await new DashboardCollector().dashboard(request({ deadline: Date.now() - 1 }));
    expect([...body.coverage.notCollected].sort()).toEqual(["api", "web"]);
    expect(body.coverage.read).toBe(0);
  });

  test("plafond d'exécutions par dépôt atteint : signalé, et plus de comparaison sur les exécutions", async () => {
    const runs = Array.from({ length: 150 }, (_, index) => fakeRun(`2026-09-24T${String(index % 24).padStart(2, "0")}:00:${String(index % 60).padStart(2, "0")}Z`));
    github.serveOrg("acme", [fakeRepo("api", { runs })]);
    const body = await new DashboardCollector().dashboard(request({ limits: { statsMaxRunsPerRepo: 100 } }));
    expect(body.kpis.successfulRuns).toEqual({ current: 100, previous: null });
    expect(body.coverage.runsCapped).toEqual(["api"]);
  });
});

describe("mémoire du tableau de bord", () => {
  test("resservi à la même personne ; « Refresh », déconnexion ou réglages changés relisent GitHub", async () => {
    github.serveOrg("acme", referenceOrg());
    const collector = new DashboardCollector();
    await collector.dashboard(request());
    await collector.dashboard(request({ session: { idHash: "session-b", userId: 42 } }));
    expect(reposListings()).toBe(1);
    await collector.dashboard(request({ fresh: true }));
    expect(reposListings()).toBe(2);
    collector.forgetUser(42);
    await collector.dashboard(request());
    expect(reposListings()).toBe(3);
    collector.clear();
    await collector.dashboard(request());
    expect(reposListings()).toBe(4);
    await collector.dashboard(request({ session: { idHash: "session-c", userId: 7 } }));
    expect(reposListings()).toBe(5);
  });

  test("0 seconde de mémoire : chaque visite relit GitHub", async () => {
    github.serveOrg("acme", referenceOrg());
    const collector = new DashboardCollector();
    await collector.dashboard(request({ limits: { statsCacheSeconds: 0 } }));
    await collector.dashboard(request({ limits: { statsCacheSeconds: 0 } }));
    expect(reposListings()).toBe(2);
  });

  test("une seule collecte à la fois par session ; une déconnexion pendant la collecte empêche de la garder", async () => {
    github.serveOrg("acme", referenceOrg());
    const collector = new DashboardCollector();
    const first = collector.dashboard(request());
    const second = collector.dashboard(request());
    collector.forgetUser(42);
    expect(await second).toBe(await first);
    expect(reposListings()).toBe(1);
    await collector.dashboard(request());
    expect(reposListings()).toBe(2);
  });
});
