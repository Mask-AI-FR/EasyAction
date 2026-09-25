import { describe, expect, test } from "bun:test";
import { base32Decode, base32Encode, generateTotpSecret, matchTotp, otpauthUri, totpAt } from "../../server/auth/totp.ts";
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from "../../server/auth/recoveryCodes.ts";

/** Graine des vecteurs de la RFC 6238, annexe B (SHA-1) : "12345678901234567890" en ASCII. */
const RFC_SEED = new TextEncoder().encode("12345678901234567890");
const RFC_SEED_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("codes TOTP (RFC 6238)", () => {
  test("reproduit les six vecteurs officiels de la RFC 6238 (SHA-1, 8 chiffres)", () => {
    const vectors: readonly [number, string][] = [
      [59, "94287082"],
      [1_111_111_109, "07081804"],
      [1_111_111_111, "14050471"],
      [1_234_567_890, "89005924"],
      [2_000_000_000, "69279037"],
      [20_000_000_000, "65353130"],
    ];
    for (const [seconds, code] of vectors) expect(totpAt(RFC_SEED, seconds, 8)).toBe(code);
  });

  test("base32 sans remplissage : aller-retour exact, saisie tolérante (minuscules, espaces)", () => {
    expect(base32Encode(RFC_SEED)).toBe(RFC_SEED_BASE32);
    expect(Buffer.from(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq")).equals(Buffer.from(RFC_SEED))).toBe(true);
    expect(() => base32Decode("ABC1")).toThrow();
  });

  test("un secret neuf fait 160 bits (32 caractères base32) et change à chaque fois", () => {
    const first = generateTotpSecret();
    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(first);
  });

  test("accepte le code du pas courant et d'un pas d'écart, pas au-delà", () => {
    const now = 1_900_000_005;
    const step = Math.floor(now / 30);
    const at = (offset: number) => totpAt(RFC_SEED, (step + offset) * 30);
    expect(matchTotp(RFC_SEED_BASE32, at(0), now, 0)).toBe(step);
    expect(matchTotp(RFC_SEED_BASE32, at(-1), now, 0)).toBe(step - 1);
    expect(matchTotp(RFC_SEED_BASE32, at(1), now, 0)).toBe(step + 1);
    expect(matchTotp(RFC_SEED_BASE32, at(2), now, 0)).toBeNull();
    expect(matchTotp(RFC_SEED_BASE32, at(-2), now, 0)).toBeNull();
  });

  test("un code déjà accepté (pas ≤ dernier pas) ne resert jamais", () => {
    const now = 1_900_000_005;
    const step = Math.floor(now / 30);
    expect(matchTotp(RFC_SEED_BASE32, totpAt(RFC_SEED, now), now, step)).toBeNull();
    expect(matchTotp(RFC_SEED_BASE32, "12345", now, 0)).toBeNull();
  });

  test("l'adresse otpauth:// suit le format « Key Uri » de Google Authenticator", () => {
    const uri = new URL(otpauthUri("EasyActions", "octo-test", RFC_SEED_BASE32));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/EasyActions:octo-test");
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      secret: RFC_SEED_BASE32,
      issuer: "EasyActions",
      algorithm: "SHA1",
      digits: "6",
      period: "30",
    });
  });
});

describe("codes de secours", () => {
  test("dix codes lisibles, sans caractères que l'on confond, tous différents", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(new Set(codes).size).toBe(10);
  });

  test("gardés hachés (HMAC) : saisie tolérante, clé nécessaire", () => {
    const key = new Uint8Array(32).fill(7);
    const hash = hashRecoveryCode(key, "ABCDE-FGHJK");
    expect(normalizeRecoveryCode(" abcde fghjk ")).toBe("ABCDEFGHJK");
    expect(hashRecoveryCode(key, "abcde fghjk")).toBe(hash);
    expect(hash).not.toContain("ABCDE");
    expect(hashRecoveryCode(new Uint8Array(32).fill(8), "ABCDE-FGHJK")).not.toBe(hash);
  });
});
