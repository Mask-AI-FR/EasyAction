import { createHash } from "node:crypto";
import { EncryptJWT, errors, jwtDecrypt } from "jose";
import { z } from "zod";

/**
 * Cookies chiffrés (JWE `dir` + `A256GCM`) : la session, et le flux OAuth en cours.
 *
 * Le jeton GitHub ne quitte jamais le serveur autrement que dans ce cookie chiffré et HttpOnly : le
 * JavaScript de la page ne peut ni le lire ni le déchiffrer. Le claim `pur` empêche de présenter un
 * cookie de flux comme cookie de session (et inversement).
 * ÉCHEC FERMÉ : un cookie absent, falsifié, expiré ou mal formé vaut « pas de session ».
 */
export interface UserSession {
  readonly userId: number;
  readonly login: string;
  readonly avatarUrl: string;
  readonly accessToken: string;
  /** Expiration, en secondes depuis l'époque Unix (UTC) : celle du jeton GitHub. */
  readonly expiresAt: number;
}

export interface OAuthFlow {
  readonly state: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
}

export interface CookiePolicy {
  readonly sessionName: string;
  readonly flowName: string;
  readonly secure: boolean;
}

/** Durée de vie du flux OAuth (cookie et jeton) : celle d'un code d'autorisation GitHub, 10 minutes. */
export const FLOW_MAX_AGE_SECONDS = 600;

const SessionClaims = z.object({
  pur: z.literal("session"),
  uid: z.number().int().positive(),
  login: z.string().min(1),
  avatar: z.string(),
  tok: z.string().min(1),
  exp: z.number().int(),
});

const FlowClaims = z.object({
  pur: z.literal("oauth"),
  state: z.string().min(1),
  cv: z.string().min(1),
  rt: z.string().min(1),
});

/**
 * Noms et attributs des cookies. En https : préfixe `__Host-` (Secure, Path=/, sans Domain imposés
 * par le navigateur). En http, seulement admis vers la boucle locale : sans Secure, que le navigateur
 * refuserait de renvoyer.
 */
export function cookiePolicyFor(appOrigin: string): CookiePolicy {
  const secure = appOrigin.startsWith("https://");
  const prefix = secure ? "__Host-" : "";
  return {
    sessionName: `${prefix}pipliner_session`,
    flowName: `${prefix}pipliner_oauth`,
    secure,
  };
}

/** Clé de 256 bits dérivée du secret de configuration (SHA-256). */
export function deriveSessionKey(secret: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(secret, "utf8").digest());
}

export function sealSession(session: UserSession, key: Uint8Array): Promise<string> {
  return new EncryptJWT({
    pur: "session",
    uid: session.userId,
    login: session.login,
    avatar: session.avatarUrl,
    tok: session.accessToken,
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(session.expiresAt)
    .encrypt(key);
}

export async function openSession(
  sealed: string | undefined,
  key: Uint8Array,
): Promise<UserSession | null> {
  const claims = await decrypt(sealed, key, SessionClaims);
  if (!claims) return null;
  return {
    userId: claims.uid,
    login: claims.login,
    avatarUrl: claims.avatar,
    accessToken: claims.tok,
    expiresAt: claims.exp,
  };
}

export function sealOAuthFlow(flow: OAuthFlow, key: Uint8Array): Promise<string> {
  return new EncryptJWT({
    pur: "oauth",
    state: flow.state,
    cv: flow.codeVerifier,
    rt: flow.returnTo,
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${FLOW_MAX_AGE_SECONDS}s`)
    .encrypt(key);
}

export async function openOAuthFlow(
  sealed: string | undefined,
  key: Uint8Array,
): Promise<OAuthFlow | null> {
  const claims = await decrypt(sealed, key, FlowClaims);
  if (!claims) return null;
  return { state: claims.state, codeVerifier: claims.cv, returnTo: claims.rt };
}

async function decrypt<T>(
  sealed: string | undefined,
  key: Uint8Array,
  schema: z.ZodType<T>,
): Promise<T | null> {
  if (!sealed) return null;
  try {
    const { payload } = await jwtDecrypt(sealed, key);
    const parsed = schema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch (err) {
    // Seules les erreurs de jose (falsification, expiration, format) valent « pas de cookie ».
    if (err instanceof errors.JOSEError) return null;
    throw err;
  }
}
