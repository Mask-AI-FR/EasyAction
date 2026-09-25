import { describe, expect, test } from "bun:test";
import { checkSetupCode, issueSetupCode, SETUP_CODE_MINUTES } from "../../server/auth/setupCode.ts";
import { deriveSetupCodeKey } from "../../server/security/dataCipher.ts";

const KEY = deriveSetupCodeKey("test-data-key-that-is-long-enough-00000000");
const NOW = 1_790_000_000;

/** Remplace le caractère `index` (tirets compris) par un autre caractère base32. */
function changed(code: string, index: number): string {
  const replacement = code[index] === "A" ? "B" : "A";
  return code.slice(0, index) + replacement + code.slice(index + 1);
}

describe("code d'installation", () => {
  test("un code tout juste émis vaut ; groupes de 4, casse et séparateurs indifférents", () => {
    const { code, expiresAt } = issueSetupCode(KEY, NOW);
    expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$/);
    expect(expiresAt).toBe(NOW + SETUP_CODE_MINUTES * 60);
    expect(checkSetupCode(KEY, code, NOW)).toBe(true);
    expect(checkSetupCode(KEY, ` ${code.toLowerCase().replaceAll("-", " ")} `, NOW + 60)).toBe(true);
  });

  test("valable jusqu'à son expiration, pas une seconde de plus", () => {
    const { code, expiresAt } = issueSetupCode(KEY, NOW);
    expect(checkSetupCode(KEY, code, expiresAt)).toBe(true);
    expect(checkSetupCode(KEY, code, expiresAt + 1)).toBe(false);
  });

  test("un seul caractère changé (étiquette ou expiration) : refusé", () => {
    const { code } = issueSetupCode(KEY, NOW);
    expect(checkSetupCode(KEY, changed(code, 25), NOW)).toBe(false);
    expect(checkSetupCode(KEY, changed(code, 6), NOW)).toBe(false);
  });

  test("fabriqué avec une autre clé (un autre serveur) : refusé", () => {
    const other = deriveSetupCodeKey("another-data-key-that-is-long-enough-0000");
    expect(checkSetupCode(KEY, issueSetupCode(other, NOW).code, NOW)).toBe(false);
  });

  test("une expiration plus lointaine que la durée d'un code : refusée", () => {
    expect(checkSetupCode(KEY, issueSetupCode(KEY, NOW + 3_600).code, NOW)).toBe(false);
  });

  test("forme invalide : refusée sans exception", () => {
    const { code } = issueSetupCode(KEY, NOW);
    for (const bad of ["", "abc", `${code}A`, "0000-0000-0000-0000-0000-0000", "!!!!-!!!!", "1".repeat(24)]) {
      expect(checkSetupCode(KEY, bad, NOW)).toBe(false);
    }
  });
});
