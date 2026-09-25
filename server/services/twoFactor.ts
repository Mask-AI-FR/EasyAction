import type { AuditAction } from "../../domain/auditActions.ts";
import type { EnrollmentBody, SecondFactorState, TwoFactorStatusBody } from "../../domain/twoFactorContract.ts";
import { generateRecoveryCodes, hashRecoveryCode } from "../auth/recoveryCodes.ts";
import { generateTotpSecret, matchTotp, otpauthUri } from "../auth/totp.ts";
import type { TwoFactorPolicy } from "../config/env.ts";
import { HttpError } from "../exceptions/HttpError.ts";
import { recordAuditEvent } from "../repositories/auditEvents.ts";
import { countUnusedRecoveryCodes, deleteRecoveryCodes, replaceRecoveryCodes, useRecoveryCode } from "../repositories/recoveryCodes.ts";
import {
  confirmPendingSecret,
  deleteSecondFactor,
  findSecondFactor,
  recordCodeSuccess,
  saveFailureCounters,
  savePendingSecret,
  type SecondFactorRecord,
} from "../repositories/secondFactors.ts";
import { clearSecondFactors } from "../repositories/sessions.ts";
import { DataCipherError, openValue, sealValue } from "../security/dataCipher.ts";
import type { ActiveSession, SessionStore } from "./sessions.ts";

/**
 * Le code à 6 chiffres d'une application d'authentification, demandé chaque jour (TOTP). Un seul
 * vérificateur pour le code du jour, la confirmation d'une action sensible et les codes de secours :
 * mêmes règles partout — un code ne sert qu'une fois, un code faux compte pour le blocage, et chaque
 * blocage dure deux fois plus que le précédent (24 h au plus). ÉCHEC FERMÉ dans tous les cas.
 */
export interface TwoFactorStore {
  readonly sessions: SessionStore;
  /** Clé HMAC des codes de secours (`deriveRecoveryCodeKey`). */
  readonly recoveryKey: Uint8Array;
  readonly policy: TwoFactorPolicy;
}

/** Nom affiché dans l'application d'authentification. */
const ISSUER = "EasyActions";
const MAX_LOCK_MINUTES = 24 * 60;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const invalidCode = (): HttpError =>
  new HttpError(400, "invalid_code", "This code is not valid. Check that your phone shows the right time.");

/** Où en est la session : aucune application, code du jour à saisir, ou code saisi. */
export function secondFactorStateOf(store: TwoFactorStore, session: ActiveSession): SecondFactorState {
  if (!findSecondFactor(store.sessions.db, session.userId)?.secretEnc) return "setup";
  const verifiedAt = session.secondFactorAt;
  const fresh = verifiedAt !== null && nowSeconds() - verifiedAt < store.policy.everyHours * 3600;
  return fresh ? "verified" : "verify";
}

/**
 * Nouveau secret en attente (le QR code le montre). Pour CHANGER d'application, il faut une session
 * déjà vérifiée ET un code actuel : sans cela, un cookie GitHub volé suffirait à remplacer le
 * téléphone de quelqu'un (revue de conception du 25 septembre 2026).
 */
export function startEnrollment(store: TwoFactorStore, session: ActiveSession, code: string | undefined): EnrollmentBody {
  if (findSecondFactor(store.sessions.db, session.userId)?.secretEnc) {
    if (secondFactorStateOf(store, session) !== "verified" || !code) {
      throw new HttpError(403, "forbidden", "Enter your current code to change your authenticator app");
    }
    acceptCode(store, session.userId, code, null);
  }
  const secret = generateTotpSecret();
  const sealed = sealValue(store.sessions.dataKey, "two_factor.pending_secret", String(session.userId), secret);
  savePendingSecret(store.sessions.db, session.userId, sealed);
  return { manualKey: secret.replace(/(.{4})/g, "$1 ").trim(), issuer: ISSUER, account: session.login };
}

/** Adresse `otpauth://` du secret en attente (pour le QR code), ou `null` s'il n'y en a pas. */
export function pendingEnrollmentUri(store: TwoFactorStore, session: ActiveSession): string | null {
  const pending = findSecondFactor(store.sessions.db, session.userId)?.pendingSecretEnc;
  if (!pending) return null;
  return otpauthUri(ISSUER, session.login, revealPending(store, session.userId, pending));
}

/**
 * Premier code correct pour le secret en attente : il devient LE secret, dix codes de secours sont
 * créés (montrés une seule fois), et c'est inscrit à l'historique — en une transaction.
 */
export function confirmEnrollment(store: TwoFactorStore, session: ActiveSession, code: string): string[] {
  const { db, dataKey } = store.sessions;
  const now = nowSeconds();
  const factor = findSecondFactor(db, session.userId);
  if (!factor?.pendingSecretEnc) throw new HttpError(400, "bad_request", "Start the setup again");
  ensureNotLocked(factor, now);
  const pending = revealPending(store, session.userId, factor.pendingSecretEnc);
  const step = matchTotp(pending, code, now, 0);
  if (step === null) throw recordFailure(store, factor, now);
  const codes = generateRecoveryCodes();
  const confirmed = db.transaction(() => {
    const secretEnc = sealValue(dataKey, "two_factor.secret", String(session.userId), pending);
    const done = confirmPendingSecret(db, { userId: session.userId, pendingSecretEnc: factor.pendingSecretEnc ?? "", secretEnc, step }, now);
    if (!done) return false;
    replaceRecoveryCodes(db, session.userId, codes.map((one) => hashRecoveryCode(store.recoveryKey, one)));
    recordAuditEvent(db, { action: "two_factor.enroll", actorId: session.userId, targetId: null }, now);
    return true;
  })();
  if (!confirmed) throw new HttpError(400, "bad_request", "Start the setup again");
  return codes;
}

/** Code du jour, ou code de secours. Rien n'est rendu : l'appelant renouvelle alors la session. */
export function verifySecondFactor(
  store: TwoFactorStore,
  session: ActiveSession,
  input: { readonly code: string } | { readonly recoveryCode: string },
): void {
  if ("code" in input) {
    acceptCode(store, session.userId, input.code, "two_factor.verify");
    return;
  }
  const { db } = store.sessions;
  const now = nowSeconds();
  const factor = findSecondFactor(db, session.userId);
  if (!factor?.secretEnc) throw new HttpError(403, "second_factor_required", "Set up your authenticator app first");
  ensureNotLocked(factor, now);
  const hash = hashRecoveryCode(store.recoveryKey, input.recoveryCode);
  const used = db.transaction(() => {
    if (!useRecoveryCode(db, session.userId, hash, now)) return false;
    recordAuditEvent(db, { action: "two_factor.recovery_used", actorId: session.userId, targetId: null }, now);
    return true;
  })();
  if (!used) throw recordFailure(store, factor, now);
}

/** Confirmation d'une action sensible (administration, nouveaux codes) : un code actuel, mêmes règles. */
export function checkStepUpCode(store: TwoFactorStore, session: ActiveSession, code: string): void {
  acceptCode(store, session.userId, code, null);
}

/** Nouveaux codes de secours, après un code actuel ; les anciens ne valent plus rien. */
export function regenerateRecoveryCodes(store: TwoFactorStore, session: ActiveSession, code: string): string[] {
  const { db } = store.sessions;
  acceptCode(store, session.userId, code, null);
  const codes = generateRecoveryCodes();
  db.transaction(() => {
    replaceRecoveryCodes(db, session.userId, codes.map((one) => hashRecoveryCode(store.recoveryKey, one)));
    recordAuditEvent(db, { action: "two_factor.recovery_regenerated", actorId: session.userId, targetId: null }, nowSeconds());
  })();
  return codes;
}

export function twoFactorStatusOf(store: TwoFactorStore, session: ActiveSession): TwoFactorStatusBody {
  const factor = findSecondFactor(store.sessions.db, session.userId);
  return {
    enabled: Boolean(factor?.secretEnc),
    confirmedAt: factor?.confirmedAt ? new Date(factor.confirmedAt * 1000).toISOString() : null,
    recoveryCodesLeft: countUnusedRecoveryCodes(store.sessions.db, session.userId),
  };
}

/**
 * Retire l'application d'authentification d'une personne (téléphone perdu, compte compromis) : secret
 * et codes de secours effacés, code du jour oublié par toutes ses sessions. `actorId` : l'administrateur,
 * ou `null` pour la ligne de commande (accès au serveur).
 */
export function resetSecondFactor(store: Pick<TwoFactorStore, "sessions">, userId: number, actorId: number | null): void {
  const { db } = store.sessions;
  db.transaction(() => {
    deleteSecondFactor(db, userId);
    deleteRecoveryCodes(db, userId);
    clearSecondFactors(db, userId);
    recordAuditEvent(db, { action: "two_factor.reset", actorId, targetId: userId }, nowSeconds());
  })();
}

/**
 * Accepte un code TOTP de la personne, ou lève (code faux, déjà utilisé, bloqué, aucune application).
 * Le pas accepté et l'entrée d'historique `action` s'écrivent dans la même transaction.
 */
function acceptCode(store: TwoFactorStore, userId: number, code: string, action: AuditAction | null): void {
  const { db, dataKey } = store.sessions;
  const now = nowSeconds();
  const factor = findSecondFactor(db, userId);
  if (!factor?.secretEnc) throw new HttpError(403, "second_factor_required", "Set up your authenticator app first");
  ensureNotLocked(factor, now);
  let secret: string;
  try {
    secret = openValue(dataKey, "two_factor.secret", String(userId), factor.secretEnc);
  } catch (err) {
    // ÉCHEC FERMÉ : secret illisible (DATA_ENCRYPTION_KEY changée) — seul un administrateur peut le retirer.
    if (!(err instanceof DataCipherError)) throw err;
    throw new HttpError(403, "forbidden", "Your authenticator app can no longer be checked. Ask an administrator to reset it.");
  }
  const step = matchTotp(secret, code, now, factor.lastStep);
  const accepted =
    step !== null &&
    db.transaction(() => {
      if (!recordCodeSuccess(db, userId, step)) return false;
      if (action) recordAuditEvent(db, { action, actorId: userId, targetId: null }, now);
      return true;
    })();
  if (!accepted) throw recordFailure(store, factor, now);
}

function ensureNotLocked(factor: SecondFactorRecord, now: number): void {
  if (factor.lockedUntil !== null && factor.lockedUntil > now) {
    const wait = factor.lockedUntil - now;
    throw new HttpError(429, "code_locked", `Too many wrong codes. Try again in ${Math.ceil(wait / 60)} min.`, wait);
  }
}

/**
 * Code faux : compté, et au bout de `TWO_FACTOR_MAX_ATTEMPTS` la personne est bloquée
 * `TWO_FACTOR_LOCK_MINUTES` × 2^(blocages précédents), 24 h au plus. Écrit AVANT de lever l'erreur
 * (hors de toute transaction qu'elle annulerait). Rend l'erreur à lever.
 */
function recordFailure(store: TwoFactorStore, factor: SecondFactorRecord, now: number): HttpError {
  const { db } = store.sessions;
  const attempts = factor.failedAttempts + 1;
  const locks = attempts >= store.policy.maxAttempts;
  const minutes = Math.min(store.policy.lockMinutes * 2 ** factor.lockLevel, MAX_LOCK_MINUTES);
  const counters = locks
    ? { failedAttempts: 0, lockLevel: factor.lockLevel + 1, lockedUntil: now + minutes * 60 }
    : { failedAttempts: attempts, lockLevel: factor.lockLevel, lockedUntil: null };
  db.transaction(() => {
    saveFailureCounters(db, factor.userId, counters);
    recordAuditEvent(db, { action: locks ? "two_factor.lock" : "two_factor.fail", actorId: factor.userId, targetId: null }, now);
  })();
  if (!locks) return invalidCode();
  return new HttpError(429, "code_locked", `Too many wrong codes. Try again in ${minutes} min.`, minutes * 60);
}

/** ÉCHEC FERMÉ : un secret en attente illisible oblige à recommencer la mise en place. */
function revealPending(store: TwoFactorStore, userId: number, pendingSecretEnc: string): string {
  try {
    return openValue(store.sessions.dataKey, "two_factor.pending_secret", String(userId), pendingSecretEnc);
  } catch (err) {
    if (!(err instanceof DataCipherError)) throw err;
    throw new HttpError(400, "bad_request", "Start the setup again");
  }
}
