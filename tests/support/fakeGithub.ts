import type { Database } from "bun:sqlite";
import { parseEnv, type GitHubSettings, type PiplinerEnv } from "../../server/config/env.ts";
import { TEST_GITHUB, testDatabase } from "./testDatabase.ts";

type Handler = (request: Request) => Response | Promise<Response>;

/** Une exécution du faux GitHub, aux champs de l'API REST. */
export interface FakeRun {
  readonly workflow_id: number;
  readonly name: string;
  readonly path: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly created_at: string;
  readonly run_started_at: string | null;
  readonly updated_at: string;
  readonly head_branch: string;
  readonly event: string;
  readonly html_url: string;
}

/** Un commit du faux GitHub, aux champs de GraphQL (`author.user` nul : e-mail lié à aucun compte). */
export interface FakeCommit {
  readonly oid: string;
  readonly committedDate: string;
  readonly author: { readonly email: string | null; readonly user: { readonly login: string } | null };
}

/** Un dépôt pour le tableau de bord : exécutions, branches (défaut comprise), commits. */
export interface FakeRepo {
  readonly name: string;
  readonly archived?: boolean;
  readonly pushedAt: string | null;
  readonly defaultBranch: string;
  readonly runs: readonly FakeRun[];
  readonly branches: readonly { readonly name: string; readonly committedDate: string }[];
  /** Historique de la branche par défaut, du plus récent au plus ancien. */
  readonly history: readonly FakeCommit[];
  /** Commits propres à chaque autre branche, du plus ancien au plus récent (comme `compare`). */
  readonly branchOnly: Readonly<Record<string, readonly FakeCommit[]>>;
  /** Réponse forcée des exécutions de ce dépôt (404, limite de débit…). */
  readonly runsFailure?: () => Response;
}

/** Installation de l'app servie par `serveOrg` (identifiant interne, jamais rendu au navigateur). */
export const FAKE_INSTALLATION_ID = 1;

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  /** Chaîne de requête (`?created=…`), vide sans elle. */
  readonly search: string;
  readonly headers: Headers;
  readonly body: string;
}

/**
 * Faux GitHub : un vrai serveur HTTP local sur un port libre (motif `tests/support/upstreams.ts` des
 * services Org/Billing), plutôt qu'un `fetch` simulé. Chaque test programme les réponses et relit
 * les appels reçus. Une route non programmée répond 599, pour qu'un appel imprévu se voie.
 */
export class FakeGitHub {
  readonly calls: RecordedCall[] = [];
  private readonly handlers = new Map<string, Handler>();
  private readonly server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => this.dispatch(request),
  });

  get url(): string {
    return `http://127.0.0.1:${this.server.port}`;
  }

  /** Configuration de démarrage de Pipliner (la connexion à GitHub est un réglage du site : `database()`). */
  env(): PiplinerEnv {
    return parseEnv(process.env);
  }

  /** Connexion à GitHub pointée sur ce faux GitHub (adresses web et API : ce serveur). */
  settings(): GitHubSettings {
    return { ...TEST_GITHUB, webUrl: this.url, apiUrl: this.url };
  }

  /** Base de test dont la connexion à GitHub est ce faux GitHub. */
  database(): Database {
    return testDatabase(this.settings());
  }

  respond(method: string, path: string, handler: Handler): void {
    this.handlers.set(`${method} ${path}`, handler);
  }

  callsTo(method: string, path: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method && call.path === path);
  }

  reset(): void {
    this.calls.length = 0;
    this.handlers.clear();
  }

  stop(): void {
    void this.server.stop(true);
  }

  /**
   * Sert une organisation entière pour le tableau de bord, comme l'API de GitHub : installation,
   * dépôts, exécutions filtrées par `created=<de>..<à>` (pages de 100 avec `Link`), et GraphQL
   * (branches avec leur total, historique depuis `since`, comparaisons `c0`…`c9`).
   */
  serveOrg(org: string, repos: readonly FakeRepo[]): void {
    this.respond("GET", "/user/installations", () =>
      Response.json({
        installations: [
          {
            id: FAKE_INSTALLATION_ID,
            app_slug: "pipliner-test",
            repository_selection: "all",
            account: { login: org, avatar_url: "https://avatars.githubusercontent.com/u/1?v=4", type: "Organization" },
          },
        ],
      }),
    );
    this.respond("GET", `/user/installations/${FAKE_INSTALLATION_ID}/repositories`, () =>
      Response.json({ total_count: repos.length, repositories: repos.map((repo, index) => apiRepoOf(org, repo, index + 1)) }),
    );
    for (const repo of repos) {
      this.respond("GET", `/repos/${org}/${repo.name}/actions/runs`, (request) => repo.runsFailure?.() ?? runsPage(request, repo));
    }
    this.respond("POST", "/graphql", async (request) => graphqlAnswer(repos, (await request.json()) as GraphQLRequest));
  }

  private async dispatch(request: Request): Promise<Response> {
    const { pathname: path, search } = new URL(request.url);
    this.calls.push({
      method: request.method,
      path,
      search,
      headers: request.headers,
      body: await request.clone().text(),
    });
    const handler = this.handlers.get(`${request.method} ${path}`);
    return handler ? handler(request) : new Response("not programmed", { status: 599 });
  }
}

function apiRepoOf(org: string, repo: FakeRepo, id: number) {
  return {
    id,
    name: repo.name,
    full_name: `${org}/${repo.name}`,
    owner: { login: org },
    description: null,
    private: true,
    visibility: "private",
    archived: repo.archived ?? false,
    language: "TypeScript",
    default_branch: repo.defaultBranch,
    pushed_at: repo.pushedAt,
    html_url: `https://github.com/${org}/${repo.name}`,
  };
}

/** `created=<de>..<à>` (bornes incluses), 100 par page, `Link` vers la suivante sur le même hôte. */
function runsPage(request: Request, repo: FakeRepo): Response {
  const url = new URL(request.url);
  const [from = "", to = ""] = (url.searchParams.get("created") ?? "").split("..");
  const matching = repo.runs.filter((run) => run.created_at >= from && run.created_at <= to);
  const page = Number(url.searchParams.get("page") ?? "1");
  const headers: Record<string, string> = {};
  if (page * 100 < matching.length) {
    url.searchParams.set("page", String(page + 1));
    headers.link = `<${url.toString()}>; rel="next"`;
  }
  return Response.json({ total_count: matching.length, workflow_runs: matching.slice((page - 1) * 100, page * 100) }, { headers });
}

interface GraphQLRequest {
  readonly query: string;
  readonly variables: Record<string, string | null>;
}

function graphqlAnswer(repos: readonly FakeRepo[], { query, variables }: GraphQLRequest): Response {
  const repo = repos.find((one) => one.name === variables.name);
  if (!repo) return Response.json({ data: { repository: null }, errors: [{ type: "NOT_FOUND", path: ["repository"] }] });
  if (query.includes("refs(refPrefix")) {
    const nodes = repo.branches.map((branch) => ({ name: branch.name, target: { committedDate: branch.committedDate } }));
    return Response.json({
      data: {
        repository: {
          defaultBranchRef: { name: repo.defaultBranch },
          refs: { totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes },
        },
      },
    });
  }
  if (query.includes("history(since")) return historyAnswer(repo, variables);
  return comparisonsAnswer(repo, variables);
}

/** Historique depuis `since`, 100 par page ; le curseur est l'indice de départ. */
function historyAnswer(repo: FakeRepo, variables: Record<string, string | null>): Response {
  const since = variables.since ?? "";
  const matching = repo.history.filter((commit) => commit.committedDate >= since);
  const start = Number(variables.cursor ?? "0");
  const hasNextPage = start + 100 < matching.length;
  return Response.json({
    data: {
      repository: {
        defaultBranchRef: {
          target: {
            history: {
              pageInfo: { hasNextPage, endCursor: hasNextPage ? String(start + 100) : null },
              nodes: matching.slice(start, start + 100),
            },
          },
        },
      },
    },
  });
}

/** Une comparaison par variable `h<i>` ; une branche inconnue répond `null` + une erreur sur son alias. */
function comparisonsAnswer(repo: FakeRepo, variables: Record<string, string | null>): Response {
  const comparisons: Record<string, unknown> = {};
  const errors: { type: string; path: string[] }[] = [];
  for (const [key, head] of Object.entries(variables)) {
    if (!/^h\d+$/.test(key)) continue;
    const alias = `c${key.slice(1)}`;
    const commits = repo.branchOnly[(head ?? "").replace(/^refs\/heads\//, "")];
    if (!commits) {
      comparisons[alias] = null;
      errors.push({ type: "NOT_FOUND", path: ["repository", "defaultBranchRef", alias] });
      continue;
    }
    comparisons[alias] = { aheadBy: commits.length, commits: { nodes: commits.slice(-100) } };
  }
  return Response.json({ data: { repository: { defaultBranchRef: comparisons } }, ...(errors.length > 0 ? { errors } : {}) });
}
