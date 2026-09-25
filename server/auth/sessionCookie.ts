import { createHash } from "node:crypto";
import { EncryptJWT, errors, jwtDecrypt } from "jose";
import { z } from "zod";

/**
 * Cookies de Pipliner : leurs noms et attributs, et le cookie chiffré (JWE `dir` + `A256GCM`) du flux
 * de connexion OAuth en cours (`state` + vérificateur PKCE, 10 minutes).
 *
 * Le cookie de SESSION ne porte qu'un identifiant aléatoire : la session et ses jetons GitHub
 * (chiffrés) sont en base (services/sessions.ts). Le claim `pur` reste vérifié : un ancien cookie de
 * session chiffré, ou tout autre JWE, n'est jamais accepté comme flux.
 * ÉCHEC FERMÉ : un cookie de flux absent, falsifié, expiré ou mal formé vaut « pas de flux ».
 */
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

/** Clé de 256 bits du cookie de flux, dérivée de `SESSION_SECRET` (SHA-256). */
export function deriveSessionKey(secret: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(secret, "utf8").digest());
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
