import type {
  BranchSummary,
  OrgSummary,
  RepoSummary,
  WorkflowSummary,
} from "./githubTypes.ts";

/**
 * Contrat des réponses HTTP de Pipliner : ce module est le propriétaire unique des formes de charge
 * utile échangées entre le serveur (`server/`) et l'application (`app/`) — CLAUDE.md §6.1. Aucun des
 * deux côtés ne redéclare ces types.
 */

/** Corps de `GET /health`, même forme que les services MaskAI (`{ status, service }`). */
export interface HealthBody {
  readonly status: "ok";
  readonly service: "pipliner";
}

/** Codes d'erreur stables : l'interface décide de son comportement sur `code`, jamais sur `message`. */
export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "forbidden_origin"
  | "sso_required"
  | "not_found"
  | "unprocessable"
  | "rate_limited"
  | "upstream"
  | "internal";

/**
 * Corps de toute réponse d'erreur. `message` est toujours un texte à nous : un message ou un corps
 * amont (GitHub) n'atteint jamais le navigateur.
 */
export interface ApiErrorBody {
  readonly detail: {
    readonly code: ApiErrorCode;
    readonly message: string;
    /** `rate_limited` : secondes à attendre avant de réessayer. */
    readonly retryAfterSeconds?: number;
    /** `sso_required` : page GitHub où autoriser l'accès SAML de l'organisation. */
    readonly ssoUrl?: string;
  };
}

/** `GET /api/session` : qui est connecté. Ne contient jamais le jeton GitHub. */
export interface SessionBody {
  readonly user: {
    readonly login: string;
    readonly avatarUrl: string;
  };
  /** Fin de la session (ISO 8601, UTC) : c'est celle du jeton GitHub. */
  readonly expiresAt: string;
  /** Plafonds de la configuration serveur dont l'interface a besoin (jamais figés dans le bundle). */
  readonly limits: {
    readonly dispatchMaxTargets: number;
    readonly runPollMinSeconds: number;
    readonly runTrackMaxMinutes: number;
  };
}

/** `GET /api/orgs` : organisations où l'app est installée, et le lien pour l'installer ailleurs. */
export interface OrgsBody {
  readonly orgs: readonly OrgSummary[];
  /** `null` tant qu'aucune installation n'a fait connaître l'adresse de l'app. */
  readonly installUrl: string | null;
}

/** `GET /api/orgs/:org/repos`. `truncated` : l'organisation a plus de dépôts que `REPOS_MAX`. */
export interface ReposBody {
  readonly org: string;
  readonly totalCount: number;
  readonly truncated: boolean;
  readonly repos: readonly RepoSummary[];
}

/**
 * `GET /api/repos/:owner/:repo/branches` : branches triées (défaut d'abord, puis commit le plus
 * récent), jusqu'à `BRANCHES_MAX`.
 */
export interface BranchesBody {
  readonly defaultBranch: string;
  readonly branches: readonly BranchSummary[];
  readonly truncated: boolean;
}

/** `GET /api/repos/:owner/:repo/workflows?branch=` : workflows et dernière exécution sur la branche. */
export interface WorkflowsBody {
  readonly branch: string;
  readonly workflows: readonly WorkflowSummary[];
}

/**
 * Raisons d'un échec de connexion, passées à `/login?error=<code>` : `expired` (flux trop long ou
 * interrompu), `denied` (autorisation refusée sur GitHub), `github` (GitHub n'a pas abouti), `config`
 * (l'app GitHub n'expire pas ses jetons), `unavailable` (session impossible à vérifier), `ended`
 * (la session a pris fin pendant l'utilisation).
 */
export const LOGIN_ERROR_CODES = [
  "expired",
  "denied",
  "github",
  "config",
  "unavailable",
  "ended",
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];
