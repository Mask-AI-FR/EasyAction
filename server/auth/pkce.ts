import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secrets du flux OAuth : `state` (anti-falsification) et vérificateur PKCE (RFC 7636).
 * 32 octets aléatoires en base64url = 43 caractères, la longueur minimale admise pour un vérificateur.
 */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Défi PKCE `S256` : base64url(SHA-256(vérificateur)), RFC 7636 §4.2. */
export function codeChallengeOf(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/** Comparaison à temps constant du `state` reçu et de celui du cookie. */
export function sameSecret(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
