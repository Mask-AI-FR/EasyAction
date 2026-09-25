import type { Database } from "bun:sqlite";
import { totpAt, base32Decode } from "../../server/auth/totp.ts";
import type { PiplinerEnv } from "../../server/config/env.ts";
import { confirmPendingSecret, savePendingSecret } from "../../server/repositories/secondFactors.ts";
import { deriveDataKey, deriveRecoveryCodeKey, sealValue } from "../../server/security/dataCipher.ts";
import { elevateSession, openSession, resolveSession, type FreshTokens, type SessionStore } from "../../server/services/sessions.ts";
import type { TwoFactorStore } from "../../server/services/twoFactor.ts";

/** Jetons fictifs : valables 1 h (au-delà du renouvellement anticipé, 30 min) et 6 mois. */
export const FAKE_TOKENS: FreshTokens = {
  accessToken: "ghu_not-a-real-token",
  accessExpiresIn: 3600,
  refreshToken: "ghr_not-a-real-refresh-token",
  refreshExpiresIn: 15_897_600,
};

export const FAKE_OWNER = {
  id: 42,
  login: "octo-test",
  avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
} as const;

/** Secret d'application d'authentification des tests (base32 fictive, connue des tests seulement). */
export const FAKE_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** Le magasin de sessions tel que `buildApp(env, db)` le construit (même base, même clé). */
export function sessionStoreOf(env: PiplinerEnv, db: Database): SessionStore {
  return {
    db,
    dataKey: deriveDataKey(env.dataEncryptionKey),
    policy: env.sessions,
    auditRetentionDays: env.auditRetentionDays,
  };
}

export function twoFactorStoreOf(env: PiplinerEnv, db: Database): TwoFactorStore {
  return {
    sessions: sessionStoreOf(env, db),
    recoveryKey: deriveRecoveryCodeKey(env.dataEncryptionKey),
    policy: env.twoFactor,
  };
}

/** Code à 6 chiffres valable maintenant (ou à `atSeconds`) pour un secret de test. */
export function codeFor(secret: string = FAKE_TOTP_SECRET, atSeconds: number = Math.floor(Date.now() / 1000)): string {
  return totpAt(base32Decode(secret), atSeconds);
}

/** Application d'authentification mise en place directement en base, avec un secret connu des tests. */
export function enrollDirectly(env: PiplinerEnv, db: Database, userId: number = FAKE_OWNER.id, secret = FAKE_TOTP_SECRET): void {
  const key = deriveDataKey(env.dataEncryptionKey);
  const pendingSecretEnc = sealValue(key, "two_factor.pending_secret", String(userId), secret);
  savePendingSecret(db, userId, pendingSecretEnc);
  const secretEnc = sealValue(key, "two_factor.secret", String(userId), secret);
  confirmPendingSecret(db, { userId, pendingSecretEnc, secretEnc, step: 0 }, Math.floor(Date.now() / 1000));
}

/**
 * Session ouverte directement en base, sans passer par GitHub ; rend la valeur du cookie. Par défaut
 * la personne a son application d'authentification et le code du jour est saisi (`verified`) : les
 * tests de routes testent leurs routes, pas la garde du code (testée par secondFactorGate.test.ts).
 */
export function signInDirectly(
  env: PiplinerEnv,
  db: Database,
  overrides: {
    readonly owner?: { readonly id: number; readonly login: string; readonly avatarUrl: string };
    readonly tokens?: Partial<FreshTokens>;
    readonly verified?: boolean;
  } = {},
): string {
  const store = sessionStoreOf(env, db);
  const owner = overrides.owner ?? FAKE_OWNER;
  const opened = openSession(store, owner, { ...FAKE_TOKENS, ...overrides.tokens }, undefined);
  if (overrides.verified === false) return opened.cookieValue;
  enrollDirectly(env, db, owner.id);
  const idHash = resolveSession(store, opened.cookieValue)?.idHash ?? "";
  return elevateSession(store, idHash)?.cookieValue ?? "";
}
