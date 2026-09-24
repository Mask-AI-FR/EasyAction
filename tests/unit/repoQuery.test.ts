import { describe, expect, test } from "bun:test";
import type { RepoSummary } from "../../domain/githubTypes.ts";
import {
  DEFAULT_REPO_QUERY,
  languagesOf,
  parseRepoQuery,
  queryRepos,
  repoQueryToParams,
  REPOS_PER_PAGE,
} from "../../domain/repoQuery.ts";

function repo(name: string, overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    id: name.length * 1000 + name.charCodeAt(0),
    owner: "Mask-AI-FR",
    name,
    fullName: `Mask-AI-FR/${name}`,
    description: null,
    visibility: "private",
    archived: false,
    language: "TypeScript",
    defaultBranch: "main",
    pushedAt: "2026-09-01T10:00:00Z",
    htmlUrl: `https://github.com/Mask-AI-FR/${name}`,
    ...overrides,
  };
}

const REPOS = [
  repo("MaskAI-Frontend", { pushedAt: "2026-09-18T10:00:00Z", description: "Next.js app" }),
  repo("MaskAI-Ai_Service", { language: "Python", pushedAt: "2026-09-10T10:00:00Z" }),
  repo("buzz", { visibility: "public", language: "Rust", pushedAt: "2026-09-12T10:00:00Z" }),
  repo("old-infra", { archived: true, pushedAt: "2025-01-01T10:00:00Z" }),
  repo("empty-repo", { language: null, pushedAt: null }),
];

const names = (query = DEFAULT_REPO_QUERY) => queryRepos(REPOS, query).items.map((r) => r.name);

describe("requête sur les dépôts", () => {
  test("par défaut : archives masquées, dernier push d'abord, dépôt vide à la fin", () => {
    expect(names()).toEqual(["MaskAI-Frontend", "buzz", "MaskAI-Ai_Service", "empty-repo"]);
  });

  test("les archives s'affichent sur demande", () => {
    expect(names({ ...DEFAULT_REPO_QUERY, showArchived: true })).toContain("old-infra");
  });

  test("la recherche porte sur le nom et la description, sans tenir compte de la casse", () => {
    expect(names({ ...DEFAULT_REPO_QUERY, search: "maskai" })).toEqual(["MaskAI-Frontend", "MaskAI-Ai_Service"]);
    expect(names({ ...DEFAULT_REPO_QUERY, search: "NEXT.JS" })).toEqual(["MaskAI-Frontend"]);
  });

  test("filtres de visibilité et de langage", () => {
    expect(names({ ...DEFAULT_REPO_QUERY, visibility: "public" })).toEqual(["buzz"]);
    expect(names({ ...DEFAULT_REPO_QUERY, language: "Python" })).toEqual(["MaskAI-Ai_Service"]);
  });

  test("tri par nom", () => {
    expect(names({ ...DEFAULT_REPO_QUERY, sort: "name" })).toEqual([
      "buzz",
      "empty-repo",
      "MaskAI-Ai_Service",
      "MaskAI-Frontend",
    ]);
  });

  test("pages de 25, et une page demandée au-delà de la dernière est ramenée à la dernière", () => {
    const many = Array.from({ length: 60 }, (_, i) => repo(`repo-${String(i).padStart(2, "0")}`));
    const last = queryRepos(many, { ...DEFAULT_REPO_QUERY, sort: "name", page: 99 });
    expect(REPOS_PER_PAGE).toBe(25);
    expect(last.pageCount).toBe(3);
    expect(last.page).toBe(3);
    expect(last.items.map((r) => r.name)).toEqual(many.slice(50).map((r) => r.name));
    expect(last.total).toBe(60);
  });

  test("« Select all N matching » : tous les dépôts filtrés, toutes pages, dans l'ordre affiché", () => {
    const many = Array.from({ length: 60 }, (_, i) => repo(`repo-${String(i).padStart(2, "0")}`));
    const archived = { ...repo("repo-archive"), archived: true };
    const first = queryRepos([...many, archived], { ...DEFAULT_REPO_QUERY, sort: "name" });
    expect(first.items).toHaveLength(25);
    expect(first.matching.map((r) => r.name)).toEqual(many.map((r) => r.name));
  });

  test("les langages proposés sont ceux de la liste, triés, sans vide", () => {
    expect(languagesOf(REPOS)).toEqual(["Python", "Rust", "TypeScript"]);
  });
});

describe("requête dans l'adresse", () => {
  test("aller-retour : une requête se relit à l'identique", () => {
    const query = { search: "maskai", visibility: "private", language: "Python", showArchived: true, sort: "name", page: 2 } as const;
    expect(parseRepoQuery(repoQueryToParams(query))).toEqual(query);
  });

  test("les valeurs par défaut ne s'écrivent pas (adresses courtes)", () => {
    expect(repoQueryToParams(DEFAULT_REPO_QUERY)).toEqual({});
  });

  test("une valeur inconnue ou mal formée retombe sur le défaut", () => {
    expect(parseRepoQuery({ visibility: "secret", sort: "stars", page: "-3", archived: "yes" })).toEqual(
      DEFAULT_REPO_QUERY,
    );
    expect(parseRepoQuery({ page: ["2"] as unknown as string })).toEqual(DEFAULT_REPO_QUERY);
  });
});
