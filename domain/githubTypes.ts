/**
 * Formes du domaine, indépendantes du format brut de GitHub : le serveur les produit (adaptateurs
 * `server/adapters/*`), l'application les lit. Aucune ne contient de jeton ni d'identifiant interne
 * d'installation.
 */

export type RepositorySelection = "all" | "selected";

/** Une organisation où l'app GitHub Pipliner est installée et accessible à l'utilisateur. */
export interface OrgSummary {
  readonly login: string;
  readonly avatarUrl: string;
  /** L'app voit tous les dépôts de l'organisation, ou une sélection choisie à l'installation. */
  readonly repositorySelection: RepositorySelection;
}

export type RepoVisibility = "public" | "private" | "internal";

export interface RepoSummary {
  readonly id: number;
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly description: string | null;
  readonly visibility: RepoVisibility;
  readonly archived: boolean;
  readonly language: string | null;
  readonly defaultBranch: string;
  /** Dernier push (ISO 8601, UTC), ou `null` pour un dépôt vide. */
  readonly pushedAt: string | null;
  readonly htmlUrl: string;
}

export interface BranchSummary {
  readonly name: string;
  /** Date du dernier commit (ISO 8601, UTC), ou `null` si GitHub ne la donne pas. */
  readonly committedAt: string | null;
  /** Commit récent (moins de `ACTIVE_BRANCH_DAYS` jours), comme la vue « Active » de GitHub. */
  readonly active: boolean;
}

export type WorkflowState =
  | "active"
  | "deleted"
  | "disabled_fork"
  | "disabled_inactivity"
  | "disabled_manually";

/** Statut d'une exécution. Une valeur inconnue de GitHub est ramenée à `pending` par l'adaptateur. */
export type RunStatus = "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";

/** Conclusion d'une exécution terminée. Une valeur inconnue est ramenée à `neutral`. */
export type RunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "neutral"
  | "stale"
  | "startup_failure";

export interface RunSummary {
  readonly id: number;
  readonly workflowId: number;
  readonly branch: string | null;
  readonly event: string;
  readonly status: RunStatus;
  readonly conclusion: RunConclusion | null;
  readonly htmlUrl: string;
  /** Instants ISO 8601, UTC. */
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly updatedAt: string;
}

export interface WorkflowSummary {
  readonly id: number;
  readonly name: string;
  /** Chemin du fichier (`.github/workflows/main.yml`) : plusieurs workflows portent le même nom. */
  readonly path: string;
  readonly state: WorkflowState;
  readonly htmlUrl: string;
  /** Dernière exécution sur la branche demandée, parmi les 100 plus récentes de cette branche. */
  readonly latestRun: RunSummary | null;
}
