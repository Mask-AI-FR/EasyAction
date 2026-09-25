import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Codes à usage unique basés sur le temps (TOTP, RFC 6238 sur HOTP, RFC 4226), ceux des applications
 * d'authentification (Google Authenticator, Authy, 2FAS, 1Password…). Écrit ici plutôt qu'avec une
 * bibliothèque : une vingtaine de lignes sur `node:crypto`, vérifiées par les vecteurs de test
 * officiels de la RFC 6238 (tests/unit/totp.test.ts).
 *
 * Réglages FIXES : SHA-1, 6 chiffres, pas de 30 s. Google Authenticator ignore les autres valeurs de
 * l'adresse `otpauth://` : un autre réglage donnerait des codes que l'application ne sait pas produire.
 */
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** RFC 4648 base32 (sans `=`) : l'alphabet des clés tapées à la main dans ces applications. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Secret de 160 bits, la taille recommandée par la RFC 4226 (§4, R6), en base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + ALPHABET[(value << (5 - bits)) & 31] : out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

/** HOTP (RFC 4226 §5.3) : HMAC-SHA-1 du compteur, troncature dynamique, `digits` chiffres. */
export function hotp(secret: Uint8Array, counter: number, digits: number = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(binary).padStart(digits, "0");
}

/** Code valable à l'instant `unixSeconds` (utile aux tests : les vecteurs RFC ont 8 chiffres). */
export function totpAt(secret: Uint8Array, unixSeconds: number, digits: number = DIGITS): string {
  return hotp(secret, Math.floor(unixSeconds / PERIOD_SECONDS), digits);
}

/**
 * Pas de temps que `code` désigne, ou `null`. Tolère un pas d'écart de part et d'autre (horloges pas
 * tout à fait à l'heure : la RFC 6238 §5.2 en recommande un au plus) et refuse tout pas déjà utilisé
 * (`lastStep`) : un code intercepté ne sert pas une deuxième fois. Comparaison à temps constant.
 */
export function matchTotp(secretBase32: string, code: string, unixSeconds: number, lastStep: number): number | null {
  const secret = base32Decode(secretBase32);
  const current = Math.floor(unixSeconds / PERIOD_SECONDS);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(hotp(secret, step));
    const given = Buffer.from(code);
    if (step > lastStep && given.length === expected.length && timingSafeEqual(given, expected)) matched = step;
  }
  return matched;
}

/** Adresse lue par le code QR (format « Key Uri » de Google Authenticator) : l'émetteur deux fois, comme recommandé. */
export function otpauthUri(issuer: string, account: string, secretBase32: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query}`;
}
