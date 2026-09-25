import type { AccountRole } from "./accountContract.ts";
import type { AuditAction } from "./auditActions.ts";

/**
 * Contrat de `/api/admin/users/*` et `/api/admin/history` (administrateurs). Instants ISO 8601, UTC.
 */
export interface AdminUserView {
  readonly githubId: number;
  readonly login: string;
  readonly avatarUrl: string;
  readonly role: AccountRole;
  readonly twoFactorEnabled: boolean;
  readonly lastSignInAt: string;
  /** Navigateurs connectés. */
  readonly sessions: number;
}

export interface AdminUsersBody {
  readonly users: readonly AdminUserView[];
}

/** Corps des actions sensibles (rôle, retrait du code, effacement) : un code à 6 chiffres actuel. */
export interface StepUpRequest {
  readonly code: string;
}

export interface RoleChangeRequest extends StepUpRequest {
  readonly role: AccountRole;
}

/** Une entrée de l'historique. `actor`/`target` : login, ou `null` (ligne de commande, personne effacée). */
export interface HistoryEntryView {
  readonly id: number;
  readonly at: string;
  readonly action: AuditAction;
  readonly actor: string | null;
  readonly target: string | null;
  /** Réglages concernés (noms seulement, jamais une valeur), pour les actions sur les réglages. */
  readonly keys: readonly string[] | null;
}

/** `GET /api/admin/history?before=&action=` : du plus récent au plus ancien, par pages. */
export interface HistoryBody {
  readonly entries: readonly HistoryEntryView[];
  /** À passer en `before` pour la page suivante ; `null` à la fin. */
  readonly nextBefore: number | null;
}
