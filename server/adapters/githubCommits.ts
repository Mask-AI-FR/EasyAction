import type { z } from "zod";
import type { GitHubSettings } from "../config/env.ts";
import { BranchComparisonsResult, CommitHistoryResult } from "../schemas/githubStats.schema.ts";
import { GitHubApiError, parsed, send, type RepoPath } from "./githubApi.ts";
import { graphqlUrl } from "./githubRepos.ts";

/**
 * Commits d'un dépôt pour le tableau de bord, en GraphQL (1 point par requête, vérifié sur l'API le
 * 25 septembre 2026) : l'historique de la branche par défaut, puis, pour chaque autre branche, les seuls
 * commits qu'elle a EN PLUS (`compare`) — un `history` par branche relirait tout l'historique commun.
 * L'auteur (login, e-mail) ne sert qu'à compter des personnes : il ne quitte jamais le serveur.
 */
export interface AuthoredCommit {
  readonly oid: string;
  readonly committedAt: string;
  readonly login: string | null;
  readonly email: string | null;
}

export interface CommitPage {
  readonly commits: AuthoredCommit[];
  readonly hasMore: boolean;
}

/** Commits propres à une branche (les 100 plus récents, du plus ancien au plus récent). */
export interface BranchOnlyCommits {
  readonly branch: string;
  readonly commits: AuthoredCommit[];
  /** Faux quand la branche en a plus que les 100 rendus. */
  readonly complete: boolean;
}

/** Comparaisons envoyées dans une même requête (alias GraphQL) : dix coûtent toujours 1 point. */
export const BRANCHES_PER_COMPARISON = 10;

const COMMIT_FIELDS = "oid committedDate author { email user { login } }";

const HISTORY_QUERY = `query($owner: String!, $name: String!, $since: GitTimestamp!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(since: $since, first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { ${COMMIT_FIELDS} }
          }
        }
      }
    }
  }
}`;

/** Pages de l'historique de la branche par défaut depuis `since` (ISO 8601) ; rien pour un dépôt vide. */
export async function* defaultBranchHistory(
  github: GitHubSettings,
  token: string,
  repo: RepoPath,
  since: string,
): AsyncGenerator<CommitPage> {
  let cursor: string | null = null;
  do {
    const result: z.infer<typeof CommitHistoryResult> = await graphql(github, token, CommitHistoryResult, {
      query: HISTORY_QUERY,
      // `GitTimestamp` : ISO 8601 à la seconde.
      variables: { owner: repo.owner, name: repo.repo, since: since.replace(/\.\d{3}Z$/, "Z"), cursor },
    });
    const repository = repositoryOf(result);
    const history = repository.defaultBranchRef?.target?.history;
    if (!history) return;
    cursor = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
    yield { commits: history.nodes.map(toAuthoredCommit), hasMore: cursor !== null };
  } while (cursor);
}

/**
 * Pour chaque branche (au plus `BRANCHES_PER_COMPARISON`), les commits qu'elle a et que la branche par
 * défaut n'a pas. Les noms de branche partent en VARIABLES GraphQL, jamais dans le texte de la requête
 * (git admet `"` et `\` dans un nom). Une branche supprimée entre-temps est simplement absente du résultat.
 */
export async function branchOnlyCommits(
  github: GitHubSettings,
  token: string,
  repo: RepoPath,
  branches: readonly string[],
): Promise<BranchOnlyCommits[]> {
  const batch = branches.slice(0, BRANCHES_PER_COMPARISON);
  if (batch.length === 0) return [];
  const heads = Object.fromEntries(batch.map((branch, index) => [`h${index}`, `refs/heads/${branch}`]));
  const result = await graphql(github, token, BranchComparisonsResult, {
    query: comparisonQuery(batch.length),
    variables: { owner: repo.owner, name: repo.repo, ...heads },
  });
  const comparisons = repositoryOf(result).defaultBranchRef;
  if (!comparisons) return [];
  return batch.flatMap((branch, index) => {
    const comparison = comparisons[`c${index}`];
    if (!comparison) return [];
    const commits = comparison.commits.nodes.map(toAuthoredCommit);
    return [{ branch, commits, complete: comparison.aheadBy <= commits.length }];
  });
}

function comparisonQuery(count: number): string {
  const indexes = Array.from({ length: count }, (_, index) => index);
  const variables = indexes.map((index) => `$h${index}: String!`).join(", ");
  const aliases = indexes
    .map((index) => `c${index}: compare(headRef: $h${index}) { aheadBy commits(last: 100) { nodes { ${COMMIT_FIELDS} } } }`)
    .join("\n      ");
  return `query($owner: String!, $name: String!, ${variables}) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      ${aliases}
    }
  }
}`;
}

async function graphql<T>(
  github: GitHubSettings,
  token: string,
  schema: z.ZodType<T>,
  body: { readonly query: string; readonly variables: Record<string, unknown> },
): Promise<T> {
  const response = await send(github, token, graphqlUrl(github.apiUrl), { method: "POST", body });
  return parsed(schema, await response.json().catch(() => null));
}

type GraphQLAnswer<T> = {
  readonly data?: { readonly repository: T | null } | null;
  readonly errors?: readonly { readonly type?: string; readonly path?: readonly (string | number)[] }[];
};

/**
 * Le dépôt de la réponse, ou l'échec stable qui l'explique. GraphQL répond HTTP 200 même en échec : seules
 * les erreurs sans chemin ou sur `repository` visent le dépôt entier ; une erreur sur une comparaison
 * (`["repository", "defaultBranchRef", "c3"]`) ne concerne que cette branche.
 */
function repositoryOf<T>(answer: GraphQLAnswer<T>): T {
  const general = (answer.errors ?? []).find((error) => (error.path?.length ?? 0) <= 1);
  if (general?.type === "RATE_LIMITED") throw new GitHubApiError("rate_limited", { retryAfterSeconds: 60 });
  if (general?.type === "NOT_FOUND") throw new GitHubApiError("not_found");
  if (general?.type === "FORBIDDEN") throw new GitHubApiError("forbidden");
  const repository = answer.data?.repository;
  if (!repository) throw new GitHubApiError(general ? "upstream" : "not_found");
  return repository;
}

/** Un commit tel que le rendent les deux requêtes (`COMMIT_FIELDS`). */
interface CommitNode {
  readonly oid: string;
  readonly committedDate: string;
  readonly author: { readonly email?: string | null; readonly user?: { readonly login: string } | null } | null;
}

function toAuthoredCommit(node: CommitNode): AuthoredCommit {
  return {
    oid: node.oid,
    committedAt: node.committedDate,
    login: node.author?.user?.login ?? null,
    email: node.author?.email ?? null,
  };
}
