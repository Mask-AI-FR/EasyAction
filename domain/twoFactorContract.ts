/**
 * Contrat de `/api/account/two-factor/*` : le code à 6 chiffres d'une application d'authentification
 * (TOTP), demandé chaque jour. Propriétaire unique de ces formes (CLAUDE.md §6.1).
 */

/**
 * Où en est une session : `setup` (aucune application encore), `verify` (le code du jour est à saisir),
 * `verified` (code accepté depuis moins de `TWO_FACTOR_EVERY_HOURS`).
 */
export type SecondFactorState = "setup" | "verify" | "verified";

/** `POST …/enrollment` : la clé à taper à la main si le code QR ne peut pas être lu. */
export interface EnrollmentBody {
  /** Clé base32 groupée par 4 caractères, pour la lecture. */
  readonly manualKey: string;
  readonly issuer: string;
  readonly account: string;
}

/** Corps de `POST …/enrollment` : le code actuel, exigé pour CHANGER d'application. */
export interface EnrollmentRequest {
  readonly code?: string;
}

/** Corps de `POST …/enrollment/confirm` et `POST …/recovery-codes` : un code à 6 chiffres. */
export interface CodeRequest {
  readonly code: string;
}

/** Corps de `POST …/verify` : le code du jour, ou un code de secours. */
export type VerifyRequest = { readonly code: string } | { readonly recoveryCode: string };

/** Codes de secours, montrés UNE seule fois (à la mise en place, puis à chaque renouvellement). */
export interface RecoveryCodesBody {
  readonly recoveryCodes: readonly string[];
}

/** `GET /api/account/two-factor` : l'état, pour la page du compte. */
export interface TwoFactorStatusBody {
  readonly enabled: boolean;
  /** Mise en place (ISO 8601, UTC), ou `null`. */
  readonly confirmedAt: string | null;
  readonly recoveryCodesLeft: number;
}
