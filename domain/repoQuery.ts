import type { RepoSummary, RepoVisibility } from "./githubTypes.ts";

/**
 * Recherche, filtres, tri et pagination de la liste des dépôts — logique pure, testée sans navigateur.
 * La requête vit dans l'adresse de la page (`?q=…&visibility=…`) : un lien partagé ou un rechargement
 * retrouve la même vue.
 */
export type VisibilityFilter = "all" | RepoVisibility;
export type RepoSort = "pushed" | "name";

export interface RepoQuery {
  readonly search: string;
  readonly visibility: VisibilityFilter;
  /** Langage exact, ou "" pour tous. */
  readonly language: string;
  readonly showArchived: boolean;
  readonly sort: RepoSort;
  /** Numéro de page, à partir de 1. */
  readonly page: number;
}

export interface RepoPage {
  readonly items: readonly RepoSummary[];
  /** Tous les dépôts qui correspondent, toutes pages confondues (« Select all N matching »). */
  readonly matching: readonly RepoSummary[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

/** Taille d'une page à l'écran : un choix de lecture, pas une limite imposée à GitHub. */
export const REPOS_PER_PAGE = 25;

export const DEFAULT_REPO_QUERY: RepoQuery = {
  search: "",
  visibility: "all",
  language: "",
  showArchived: false,
  sort: "pushed",
  page: 1,
};

const VISIBILITIES: readonly VisibilityFilter[] = ["all", "public", "private", "internal"];
const SORTS: readonly RepoSort[] = ["pushed", "name"];

export function queryRepos(repos: readonly RepoSummary[], query: RepoQuery): RepoPage {
  const matching = repos.filter((repo) => matches(repo, query)).sort(comparator(query.sort));
  const pageCount = Math.max(1, Math.ceil(matching.length / REPOS_PER_PAGE));
  const page = Math.min(Math.max(1, query.page), pageCount);
  const start = (page - 1) * REPOS_PER_PAGE;
  return {
    items: matching.slice(start, start + REPOS_PER_PAGE),
    matching,
    total: matching.length,
    page,
    pageCount,
  };
}

/** Langages présents dans la liste, triés, pour le filtre. */
export function languagesOf(repos: readonly RepoSummary[]): string[] {
  const languages = new Set<string>();
  for (const repo of repos) if (repo.language) languages.add(repo.language);
  return [...languages].sort((a, b) => a.localeCompare(b, "en"));
}

/** Lit la requête dans les paramètres d'adresse ; toute valeur inconnue retombe sur le défaut. */
export function parseRepoQuery(params: Readonly<Record<string, unknown>>): RepoQuery {
  const text = (key: string): string => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };
  const page = Number(text("page"));
  return {
    search: text("q").slice(0, 100),
    visibility: VISIBILITIES.find((known) => known === text("visibility")) ?? "all",
    language: text("language").slice(0, 60),
    showArchived: text("archived") === "1",
    sort: SORTS.find((known) => known === text("sort")) ?? "pushed",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Paramètres d'adresse d'une requête ; les valeurs par défaut sont omises (adresses courtes). */
export function repoQueryToParams(query: RepoQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.search) params.q = query.search;
  if (query.visibility !== "all") params.visibility = query.visibility;
  if (query.language) params.language = query.language;
  if (query.showArchived) params.archived = "1";
  if (query.sort !== "pushed") params.sort = query.sort;
  if (query.page > 1) params.page = String(query.page);
  return params;
}

function matches(repo: RepoSummary, query: RepoQuery): boolean {
  if (!query.showArchived && repo.archived) return false;
  if (query.visibility !== "all" && repo.visibility !== query.visibility) return false;
  if (query.language && repo.language !== query.language) return false;
  const needle = query.search.trim().toLowerCase();
  if (!needle) return true;
  return (
    repo.name.toLowerCase().includes(needle) ||
    (repo.description ?? "").toLowerCase().includes(needle)
  );
}

function comparator(sort: RepoSort): (a: RepoSummary, b: RepoSummary) => number {
  const byName = (a: RepoSummary, b: RepoSummary) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  if (sort === "name") return byName;
  // Les dates ISO 8601 de GitHub se comparent comme des chaînes ; un dépôt vide va à la fin.
  return (a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "") || byName(a, b);
}
