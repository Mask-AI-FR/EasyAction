import { describe, expect, test } from "bun:test";
import {
  buildDashboard,
  personOf,
  windowOf,
  type RepositoryCollection,
  type StatsCommit,
  type StatsRun,
} from "../../domain/dashboardStats.ts";

/** Vendredi 25 septembre 2026, 10:30 UTC. */
const NOW = Date.parse("2026-09-25T10:30:00Z");

function run(overrides: Partial<StatsRun> = {}): StatsRun {
  return {
    workflowId: 1,
    workflowName: "CI",
    workflowPath: ".github/workflows/ci.yml",
    branch: "main",
    event: "push",
    status: "completed",
    conclusion: "success",
    htmlUrl: "https://github.com/acme/api/actions/runs/1",
    createdAt: "2026-09-24T09:00:00Z",
    startedAt: "2026-09-24T09:00:00Z",
    updatedAt: "2026-09-24T09:02:00Z",
    ...overrides,
  };
}

const commit = (oid: string, committedAt: string, person: string | null): StatsCommit => ({ oid, committedAt, person });

function repository(overrides: Partial<RepositoryCollection> = {}): RepositoryCollection {
  return {
    name: "api",
    htmlUrl: "https://github.com/acme/api",
    runs: { current: [], previous: [], capped: false },
    branches: { total: 3, capped: false },
    commits: { items: [], capped: false },
    ...overrides,
  };
}

const COMPLETE = { repositories: 1, archived: 0, beyondLimit: 0, unreadable: [], notCollected: [] };

describe("périodes du tableau de bord", () => {
  test("7 jours : de minuit UTC il y a 6 jours à maintenant, 7 colonnes d'un jour", () => {
    const window = windowOf(7, NOW);
    expect(new Date(window.from).toISOString()).toBe("2026-09-19T00:00:00.000Z");
    expect(window.to).toBe(NOW);
    expect(window.bucket).toBe("day");
    expect(window.bucketStarts).toHaveLength(7);
    expect(new Date(window.bucketStarts.at(-1) ?? 0).toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });

  test("la période précédente a la même durée écoulée, une période plus tôt (jour en cours compris)", () => {
    const window = windowOf(7, NOW);
    expect(new Date(window.previousFrom).toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(new Date(window.previousTo).toISOString()).toBe("2026-09-18T10:30:00.000Z");
    expect(window.to - window.from).toBe(window.previousTo - window.previousFrom);
  });

  test("90 jours : 13 semaines ISO commencées un lundi, la semaine en cours comprise", () => {
    const window = windowOf(90, NOW);
    expect(window.bucket).toBe("week");
    expect(window.bucketStarts).toHaveLength(13);
    for (const start of window.bucketStarts) expect(new Date(start).getUTCDay()).toBe(1);
    // La semaine en cours a commencé le lundi 21 septembre 2026.
    expect(new Date(window.bucketStarts.at(-1) ?? 0).toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(window.to - window.from).toBe(window.previousTo - window.previousFrom);
  });

  test("un dimanche soir reste dans la semaine commencée le lundi précédent", () => {
    const sunday = Date.parse("2026-09-27T23:59:00Z");
    expect(new Date(windowOf(90, sunday).bucketStarts.at(-1) ?? 0).toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });
});

describe("personnes qui committent", () => {
  test("le login GitHub, sans distinction de casse", () => {
    expect(personOf({ login: "Octo-Cat", email: "octo@example.com" })).toBe("octo-cat");
  });

  test("sans compte lié : l'e-mail en minuscules", () => {
    expect(personOf({ login: null, email: " Dev@Example.COM " })).toBe("dev@example.com");
  });

  test("l'adresse noreply de GitHub redonne le login (avec ou sans identifiant)", () => {
    expect(personOf({ login: null, email: "12345+Octo-Cat@users.noreply.github.com" })).toBe("octo-cat");
    expect(personOf({ login: null, email: "octo-cat@users.noreply.github.com" })).toBe("octo-cat");
  });

  test("les robots ne comptent pas, ni un auteur sans identité", () => {
    expect(personOf({ login: "dependabot[bot]", email: null })).toBeNull();
    expect(personOf({ login: null, email: "49699333+dependabot[bot]@users.noreply.github.com" })).toBeNull();
    expect(personOf({ login: null, email: null })).toBeNull();
  });
});

describe("calcul du tableau de bord", () => {
  const window = windowOf(7, NOW);

  test("exécutions classées réussies / échouées / autres, par jour UTC", () => {
    const body = buildDashboard({
      org: "acme",
      window,
      generatedAt: NOW,
      coverage: COMPLETE,
      repositories: [
        repository({
          runs: {
            current: [
              run({ createdAt: "2026-09-24T09:00:00Z" }),
              run({ conclusion: "failure", createdAt: "2026-09-24T23:59:59Z" }),
              run({ conclusion: "timed_out", createdAt: "2026-09-25T00:00:00Z" }),
              run({ conclusion: "cancelled", createdAt: "2026-09-25T01:00:00Z" }),
              run({ status: "in_progress", conclusion: null, createdAt: "2026-09-25T02:00:00Z" }),
            ],
            previous: [],
            capped: false,
          },
        }),
      ],
    });
    expect(body.timeline.at(-2)).toEqual({ start: "2026-09-24T00:00:00.000Z", success: 1, failed: 1, other: 0 });
    expect(body.timeline.at(-1)).toEqual({ start: "2026-09-25T00:00:00.000Z", success: 0, failed: 1, other: 2 });
    expect(body.kpis.successfulRuns.current).toBe(1);
    expect(body.kpis.failedRuns.current).toBe(2);
    expect(body.kpis.successRate.current).toBeCloseTo(1 / 3);
  });

  test("durée moyenne : exécutions réussies ou échouées terminées seulement, `updated_at − run_started_at`", () => {
    const body = buildDashboard({
      org: "acme",
      window,
      generatedAt: NOW,
      coverage: COMPLETE,
      repositories: [
        repository({
          runs: {
            current: [
              run({ startedAt: "2026-09-24T09:00:00Z", updatedAt: "2026-09-24T09:01:00Z" }),
              run({ conclusion: "failure", startedAt: "2026-09-24T10:00:00Z", updatedAt: "2026-09-24T10:03:00Z" }),
              run({ conclusion: "cancelled", startedAt: "2026-09-24T11:00:00Z", updatedAt: "2026-09-24T12:00:00Z" }),
              run({ startedAt: null }),
            ],
            previous: [],
            capped: false,
          },
        }),
      ],
    });
    expect(body.kpis.averageDurationSeconds.current).toBe(120);
  });

  test("comparaison avec la période précédente quand tout a été lu ; aucune sinon", () => {
    const repo = repository({ runs: { current: [run(), run()], previous: [run()], capped: false } });
    const complete = buildDashboard({ org: "acme", window, generatedAt: NOW, coverage: COMPLETE, repositories: [repo] });
    expect(complete.kpis.successfulRuns).toEqual({ current: 2, previous: 1 });
    const missing = buildDashboard({
      org: "acme",
      window,
      generatedAt: NOW,
      coverage: { ...COMPLETE, unreadable: ["web"] },
      repositories: [repo],
    });
    expect(missing.kpis.successfulRuns).toEqual({ current: 2, previous: null });
    const capped = buildDashboard({
      org: "acme",
      window,
      generatedAt: NOW,
      coverage: COMPLETE,
      repositories: [repository({ runs: { current: [run()], previous: [run()], capped: true } })],
    });
    expect(capped.kpis.failedRuns.previous).toBeNull();
    expect(capped.coverage.runsCapped).toEqual(["api"]);
  });

  test("personnes différentes sur tous les dépôts, dans chaque période ; aucune identité dans la réponse", () => {
    const body = buildDashboard({
      org: "acme",
      window,
      generatedAt: NOW,
      coverage: { ...COMPLETE, repositories: 2 },
      repositories: [
        repository({
          commits: {
            items: [
              commit("a1", "2026-09-24T08:00:00Z", "octo-cat"),
              commit("a2", "2026-09-23T08:00:00Z", "dev@example.com"),
              commit("a3", "2026-09-22T08:00:00Z", null),
              commit("a4", "2026-09-15T08:00:00Z", "octo-cat"),
            ],
            capped: false,
          },
        }),
        repository({ name: "web", commits: { items: [commit("b1", "2026-09-24T09:00:00Z", "octo-cat")], capped: false } }),
      ],
    });
    expect(body.kpis.committers).toEqual({ current: 2, previous: 1 });
    expect(body.repositories.map((repo) => [repo.name, repo.committers])).toEqual([
      ["api", 2],
      ["web", 1],
    ]);
    expect(JSON.stringify(body)).not.toContain("octo-cat");
    expect(JSON.stringify(body)).not.toContain("@example.com");
  });

  test("workflows qui échouent le plus (lien vers le dernier échec) et 10 derniers échecs, du plus récent", () => {
    const failures = Array.from({ length: 12 }, (_, index) =>
      run({
        workflowId: index < 8 ? 2 : 3,
        workflowName: index < 8 ? "Deploy" : "Lint",
        conclusion: "failure",
        createdAt: `2026-09-2${index % 5}T0${index % 10}:00:00Z`,
        htmlUrl: `https://github.com/acme/api/actions/runs/${100 + index}`,
      }),
    );
    const body = buildDashboard({
      org: "acme",
      window,
      generatedAt: NOW,
      coverage: COMPLETE,
      repositories: [repository({ runs: { current: [...failures, run({ workflowId: 3, workflowName: "Lint" })], previous: [], capped: false } })],
    });
    expect(body.failingWorkflows.map((workflow) => [workflow.workflow, workflow.failed, workflow.runs])).toEqual([
      ["Deploy", 8, 8],
      ["Lint", 4, 5],
    ]);
    expect(body.failingWorkflows[0]?.latestFailureUrl).toBe("https://github.com/acme/api/actions/runs/104");
    expect(body.recentFailures).toHaveLength(10);
    const times = body.recentFailures.map((failure) => failure.at);
    expect(times).toEqual([...times].sort().reverse());
    expect(body.recentFailures[0]?.label).toBe("Failed");
  });

  test("branches : total des dépôts lus ; couverture complétée des plafonds atteints", () => {
    const body = buildDashboard({
      org: "acme",
      window,
      generatedAt: NOW,
      coverage: { ...COMPLETE, repositories: 3, archived: 1 },
      repositories: [
        repository({ branches: { total: 4, capped: false } }),
        repository({ name: "web", branches: { total: 300, capped: true }, commits: { items: [], capped: true } }),
      ],
    });
    expect(body.kpis.branches).toBe(304);
    expect(body.coverage).toMatchObject({ read: 2, archived: 1, branchesCapped: ["web"], commitsCapped: ["web"] });
    expect(body.kpis.committers.previous).toBeNull();
  });
});
