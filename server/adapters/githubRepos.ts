import type { z } from "zod";
import type { BranchSummary, OrgSummary, RepoSummary } from "../../domain/githubTypes.ts";
import type { GitHubSettings } from "../config/env.ts";
import {
  BranchesQueryResult,
  InstallationReposPage,
  InstallationsPage,
  Viewer,
} from "../schemas/github.schema.ts";
import { GitHubApiError, pages, parsed, send, type RepoPath } from "./githubApi.ts";

/**
 * Lectures GitHub au nom de l'utilisateur : son compte, les installations de l'app, les dépôts et les
 * branches. Passe par la couche HTTP commune (`githubApi.ts`) : délai, aucune reprise, validation zod,
 * codes d'échec stables.
 */
export interface GitHubViewer {
  readonly id: number;
  readonly login: string;
  readonly avatarUrl: string;
}

/** Installation de l'app sur une organisation. L'identifiant ne sort jamais du serveur. */
export interface OrgInstallation {
  readonly id: number;
  readonly appSlug: string;
  readonly org: OrgSummary;
}

export interface InstallationRepos {
  readonly repos: RepoSummary[];
  /** Total annoncé par GitHub, même au-delà du plafond lu. */
  readonly totalCount: number;
}

export interface RepoBranches {
  readonly defaultBranch: string;
  readonly branches: BranchSummary[];
  readonly truncated: boolean;
  /** Nombre exact de branches du dépôt, même au-delà du plafond lu (tableau de bord). */
  readonly totalCount: number;
}

/** `GET /user` : l'utilisateur à qui appartient le jeton. */
export async function getViewer(github: GitHubSettings, token: string): Promise<GitHubViewer> {
  const response = await send(github, token, `${github.apiUrl}/user`);
  const viewer = parsed(Viewer, await response.json().catch(() => null));
  return { id: viewer.id, login: viewer.login, avatarUrl: viewer.avatar_url };
}

/** Organisations où l'app est installée ET que l'utilisateur peut voir (comptes personnels exclus). */
export async function listOrgInstallations(
  github: GitHubSettings,
  token: string,
): Promise<OrgInstallation[]> {
  const found: OrgInstallation[] = [];
  for await (const body of pages(github, token, "/user/installations?per_page=100")) {
    for (const installation of parsed(InstallationsPage, body).installations) {
      const { account } = installation;
      if (account?.type !== "Organization") continue;
      found.push({
        id: installation.id,
        appSlug: installation.app_slug,
        org: {
          login: account.login,
          avatarUrl: account.avatar_url,
          repositorySelection: installation.repository_selection,
        },
      });
    }
  }
  return found;
}

/** Dépôts d'une installation accessibles à l'utilisateur, jusqu'à `max` (pages de 100). */
export async function listInstallationRepos(
  github: GitHubSettings,
  token: string,
  installationId: number,
  max: number,
): Promise<InstallationRepos> {
  const repos: RepoSummary[] = [];
  let totalCount = 0;
  const path = `/user/installations/${installationId}/repositories?per_page=100`;
  for await (const body of pages(github, token, path)) {
    const page = parsed(InstallationReposPage, body);
    totalCount = page.total_count;
    repos.push(...page.repositories.map(toRepoSummary));
    if (repos.length >= max) break;
  }
  return { repos: repos.slice(0, max), totalCount: Math.max(totalCount, repos.length) };
}

const BRANCHES_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    refs(refPrefix: "refs/heads/", first: 100, after: $cursor, orderBy: {field: ALPHABETICAL, direction: ASC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { name target { ... on Commit { committedDate } } }
    }
  }
}`;

/**
 * Branches d'un dépôt avec la date de leur dernier commit, en GraphQL (une requête par 100 branches,
 * au lieu d'une par branche en REST). GraphQL ne sait trier par date que les tags : le tri est fait ici.
 */
export async function listBranches(
  github: GitHubSettings,
  token: string,
  repo: RepoPath,
  limits: { readonly max: number; readonly activeDays: number },
): Promise<RepoBranches> {
  const found: { name: string; committedAt: string | null }[] = [];
  let cursor: string | null = null;
  let defaultBranch = "";
  let truncated = false;
  let totalCount = 0;
  do {
    const repository = await branchesPage(github, token, repo, cursor);
    defaultBranch = repository.defaultBranchRef?.name ?? defaultBranch;
    totalCount = repository.refs.totalCount;
    for (const node of repository.refs.nodes) {
      found.push({ name: node.name, committedAt: node.target?.committedDate ?? null });
    }
    cursor = repository.refs.pageInfo.hasNextPage ? repository.refs.pageInfo.endCursor : null;
    truncated = cursor !== null && found.length >= limits.max;
  } while (cursor && !truncated);
  const branches = rankBranches(found.slice(0, limits.max), defaultBranch, limits.activeDays);
  return { defaultBranch, branches, truncated, totalCount: Math.max(totalCount, found.length) };
}

async function branchesPage(github: GitHubSettings, token: string, repo: RepoPath, cursor: string | null) {
  const response = await send(github, token, graphqlUrl(github.apiUrl), {
    method: "POST",
    body: { query: BRANCHES_QUERY, variables: { owner: repo.owner, name: repo.repo, cursor } },
  });
  const result = parsed(BranchesQueryResult, await response.json().catch(() => null));
  const type = result.errors?.[0]?.type;
  if (type === "NOT_FOUND") throw new GitHubApiError("not_found");
  if (type === "FORBIDDEN") throw new GitHubApiError("forbidden");
  if (type === "RATE_LIMITED") throw new GitHubApiError("rate_limited", { retryAfterSeconds: 60 });
  const repository = result.data?.repository;
  if (!repository) throw new GitHubApiError(result.errors ? "upstream" : "not_found");
  return repository;
}

/** Branche par défaut d'abord, puis du commit le plus récent au plus ancien. */
function rankBranches(
  branches: readonly { name: string; committedAt: string | null }[],
  defaultBranch: string,
  activeDays: number,
): BranchSummary[] {
  const since = Date.now() - activeDays * 86_400_000;
  return [...branches]
    .sort(
      (a, b) =>
        Number(b.name === defaultBranch) - Number(a.name === defaultBranch) ||
        (b.committedAt ?? "").localeCompare(a.committedAt ?? ""),
    )
    .map((branch) => ({
      ...branch,
      active: branch.name === defaultBranch || (branch.committedAt !== null && Date.parse(branch.committedAt) >= since),
    }));
}

/** GraphQL : `/graphql` sur api.github.com, mais `/api/graphql` sur GitHub Enterprise Server. */
export function graphqlUrl(apiUrl: string): string {
  return apiUrl.endsWith("/api/v3") ? `${apiUrl.slice(0, -3)}graphql` : `${apiUrl}/graphql`;
}

function toRepoSummary(repo: z.infer<typeof InstallationReposPage>["repositories"][number]): RepoSummary {
  return {
    id: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    visibility: repo.visibility ?? (repo.private ? "private" : "public"),
    archived: repo.archived,
    language: repo.language,
    defaultBranch: repo.default_branch,
    pushedAt: repo.pushed_at,
    htmlUrl: repo.html_url,
  };
}
