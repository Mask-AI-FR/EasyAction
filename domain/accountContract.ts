import type { AuditAction } from "./auditActions.ts";

/**
 * Contrat de `/api/account/*` (le compte de la personne connectée), propriétaire unique de ces formes
 * comme `apiContract.ts` l'est pour le reste de l'API — qui a déjà ses 10 exports (CLAUDE.md §3.1).
 * Instants en ISO 8601, UTC. Aucune de ces formes ne contient un jeton, un chiffré ou un haché.
 */

/** Rôle dans EasyActions ; les administrateurs arrivent avec la page Settings. */
export type AccountRole = "member" | "admin";

/** Une session ouverte (un navigateur), vue par son propriétaire. */
export interface AccountSession {
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  /** La session de ce navigateur-ci. */
  readonly current: boolean;
}

/** `GET /api/account/sessions`, de la plus récente à la plus ancienne. */
export interface AccountSessionsBody {
  readonly sessions: readonly AccountSession[];
}

/** `POST /api/account/sessions/sign-out-others` : nombre de sessions fermées. */
export interface SessionsEndedBody {
  readonly ended: number;
}

/** Corps de `POST /api/account/delete` : le login GitHub, retapé pour confirmer. */
export interface DeleteAccountRequest {
  readonly confirmLogin: string;
}

/** `GET /api/account/export` : tout ce qu'EasyActions garde sur la personne (CLAUDE.md §7). */
export interface AccountExportBody {
  readonly exportedAt: string;
  readonly user: {
    readonly githubId: number;
    readonly login: string;
    readonly avatarUrl: string;
    readonly role: AccountRole;
    readonly createdAt: string;
    readonly lastSignInAt: string;
  };
  readonly sessions: readonly AccountSession[];
  /** Historique où la personne est l'auteur (`actor`) ou la cible (`target`) d'une action. */
  readonly history: readonly {
    readonly at: string;
    readonly action: AuditAction;
    readonly as: "actor" | "target";
  }[];
}
