import { createHmac, randomInt } from "node:crypto";

/**
 * Codes de secours : ils remplacent le code du jour quand le téléphone est perdu (OWASP MFA : codes
 * à usage unique donnés à la mise en place). Montrés UNE fois, gardés seulement hachés par HMAC avec
 * une clé dérivée de `DATA_ENCRYPTION_KEY` : une copie de la base ne suffit pas à les retrouver.
 * 10 caractères chacun (50 bits), sans les caractères que l'on confond (I, O, 0, 1).
 */
export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 10;

/** Codes lisibles, groupés par 5 : « ABCDE-FGHJK ». */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const chars = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** Saisie tolérante : minuscules, espaces et tirets ignorés. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export function hashRecoveryCode(key: Uint8Array, code: string): string {
  return createHmac("sha256", key).update(normalizeRecoveryCode(code)).digest("base64url");
}
