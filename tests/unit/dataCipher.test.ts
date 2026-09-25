import { describe, expect, test } from "bun:test";
import { deriveSessionKey } from "../../server/auth/sessionCookie.ts";
import { DataCipherError, deriveDataKey, openValue, sealValue } from "../../server/security/dataCipher.ts";

const SECRET = "not-a-real-data-key-only-for-tests-00000";
const key = deriveDataKey(SECRET);
const TOKEN = "ghu_not-a-real-token";

describe("chiffrement des valeurs gardées en base", () => {
  test("se relit à l'identique, pour le même usage et la même ligne", () => {
    const sealed = sealValue(key, "session.access_token", "ligne-a", TOKEN);
    expect(openValue(key, "session.access_token", "ligne-a", sealed)).toBe(TOKEN);
  });

  test("jamais le texte en clair, et un chiffré différent à chaque fois (IV aléatoire)", () => {
    const first = sealValue(key, "session.access_token", "ligne-a", TOKEN);
    const second = sealValue(key, "session.access_token", "ligne-a", TOKEN);
    expect(first).toStartWith("v1.");
    expect(first).not.toContain("ghu_");
    expect(first).not.toBe(second);
  });

  test("recopiée dans une autre ligne, la valeur ne se déchiffre pas (AAD)", () => {
    const sealed = sealValue(key, "session.access_token", "ligne-a", TOKEN);
    expect(() => openValue(key, "session.access_token", "ligne-b", sealed)).toThrow(DataCipherError);
  });

  test("ni dans une autre colonne : un jeton d'accès ne passe pas pour un jeton de rafraîchissement", () => {
    const sealed = sealValue(key, "session.access_token", "ligne-a", TOKEN);
    expect(() => openValue(key, "session.refresh_token", "ligne-a", sealed)).toThrow(DataCipherError);
  });

  test("une valeur modifiée est refusée (échec fermé), jamais un texte faux", () => {
    const sealed = sealValue(key, "session.access_token", "ligne-a", TOKEN);
    const tampered = `${sealed.slice(0, -2)}${sealed.slice(-2) === "AA" ? "BB" : "AA"}`;
    expect(() => openValue(key, "session.access_token", "ligne-a", tampered)).toThrow(DataCipherError);
  });

  test("une autre clé ne l'ouvre pas (DATA_ENCRYPTION_KEY changée)", () => {
    const sealed = sealValue(key, "session.access_token", "ligne-a", TOKEN);
    const other = deriveDataKey("another-data-key-that-is-long-enough-000");
    expect(() => openValue(other, "session.access_token", "ligne-a", sealed)).toThrow(DataCipherError);
  });

  test("un format inconnu est refusé", () => {
    for (const sealed of ["", "v1.", "v2.AAAA", "v1.!!!", "texte-en-clair"]) {
      expect(() => openValue(key, "session.access_token", "ligne-a", sealed)).toThrow(DataCipherError);
    }
  });

  test("même secret, clés distinctes : celle des données n'est pas celle des cookies", () => {
    expect(Buffer.from(deriveDataKey(SECRET)).equals(Buffer.from(deriveSessionKey(SECRET)))).toBe(false);
  });
});
