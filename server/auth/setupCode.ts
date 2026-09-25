import { createHmac, timingSafeEqual } from "node:crypto";
import { base32Decode, base32Encode } from "./totp.ts";

/**
 * Code d'installation (`bun run settings:setup-code`) : il ouvre la page /setup tant qu'aucune
 * connexion à GitHub n'est enregistrée. Sans état : l'heure d'expiration, suivie d'une étiquette
 * HMAC-SHA256 de 80 bits sur cette heure (clé `deriveSetupCodeKey`, tirée de DATA_ENCRYPTION_KEY).
 * Rien n'est stocké, et seul qui détient le secret du serveur peut en fabriquer un. Montré une fois
 * dans le terminal de l'exploitant, jamais journalisé.
 */

/** Le temps de copier le code et de remplir la page ; au-delà, on en redemande un. */
export const SETUP_CODE_MINUTES = 30;

/** 5 octets d'expiration (secondes) + 10 d'étiquette = 15 octets, soit 24 caractères base32. */
const STAMP_BYTES = 5;
const TAG_BYTES = 10;

function tagOf(key: Uint8Array, expiresAt: number): Buffer {
  return createHmac("sha256", key).update(`pipliner:setup:${expiresAt}`).digest().subarray(0, TAG_BYTES);
}

/** Un code valable `SETUP_CODE_MINUTES` minutes à partir de `now` (secondes), en groupes de 4 caractères. */
export function issueSetupCode(key: Uint8Array, now: number): { readonly code: string; readonly expiresAt: number } {
  const expiresAt = now + SETUP_CODE_MINUTES * 60;
  const stamp = Buffer.alloc(STAMP_BYTES);
  stamp.writeUIntBE(expiresAt, 0, STAMP_BYTES);
  const text = base32Encode(Buffer.concat([stamp, tagOf(key, expiresAt)]));
  return { code: (text.match(/.{1,4}/g) ?? []).join("-"), expiresAt };
}

/**
 * Vrai si le code vient de ce serveur et vaut encore. Tirets, espaces et casse ignorés ; étiquette
 * comparée en temps constant. Une expiration plus lointaine que la durée d'un code est refusée aussi.
 */
export function checkSetupCode(key: Uint8Array, code: string, now: number): boolean {
  const text = code.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z2-7]{24}$/.test(text)) return false;
  const bytes = Buffer.from(base32Decode(text));
  if (bytes.length !== STAMP_BYTES + TAG_BYTES) return false;
  const expiresAt = bytes.readUIntBE(0, STAMP_BYTES);
  if (expiresAt < now || expiresAt > now + SETUP_CODE_MINUTES * 60) return false;
  return timingSafeEqual(bytes.subarray(STAMP_BYTES), tagOf(key, expiresAt));
}
