import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { EncryptJWT } from "jose";
import {
  cookiePolicyFor,
  deriveSessionKey,
  openOAuthFlow,
  sealOAuthFlow,
  type OAuthFlow,
} from "../../server/auth/sessionCookie.ts";

const key = deriveSessionKey("not-a-real-secret-only-for-tests-000000");
const flow: OAuthFlow = { state: "state-123", codeVerifier: "verifier-456", returnTo: "/orgs" };

afterEach(() => setSystemTime());

describe("cookie chiffré du flux de connexion", () => {
  test("se relit à l'identique avec la bonne clé", async () => {
    expect(await openOAuthFlow(await sealOAuthFlow(flow, key), key)).toEqual(flow);
  });

  test("ne laisse ni le state ni le vérificateur PKCE en clair", async () => {
    const sealed = await sealOAuthFlow(flow, key);
    expect(sealed).not.toContain("state-123");
    expect(sealed).not.toContain("verifier-456");
  });

  test("un cookie modifié ne vaut rien (échec fermé)", async () => {
    const sealed = await sealOAuthFlow(flow, key);
    const tampered = `${sealed.slice(0, -4)}${sealed.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
    expect(await openOAuthFlow(tampered, key)).toBeNull();
  });

  test("expire au bout de 10 minutes, la durée d'un code d'autorisation GitHub", async () => {
    const sealed = await sealOAuthFlow(flow, key);
    setSystemTime(new Date(Date.now() + 601_000));
    expect(await openOAuthFlow(sealed, key)).toBeNull();
  });

  test("un autre secret de configuration ne l'ouvre pas", async () => {
    const sealed = await sealOAuthFlow(flow, key);
    expect(await openOAuthFlow(sealed, deriveSessionKey("another-secret-that-is-long-enough-00"))).toBeNull();
  });

  test("un ancien cookie de session chiffré (avant la session en base) n'est jamais accepté comme flux", async () => {
    const oldSession = await new EncryptJWT({ pur: "session", uid: 42, login: "octo-test", tok: "ghu_x" })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setExpirationTime("1h")
      .encrypt(key);
    expect(await openOAuthFlow(oldSession, key)).toBeNull();
  });

  test("pas de cookie : pas de flux", async () => {
    expect(await openOAuthFlow(undefined, key)).toBeNull();
  });
});

describe("politique des cookies", () => {
  test("en https : préfixe __Host- et attribut Secure", () => {
    expect(cookiePolicyFor("https://pipliner.example.org")).toEqual({
      sessionName: "__Host-pipliner_session",
      flowName: "__Host-pipliner_oauth",
      secure: true,
    });
  });

  test("en http local : sans Secure, que le navigateur refuserait de renvoyer", () => {
    expect(cookiePolicyFor("http://127.0.0.1:8094")).toEqual({
      sessionName: "pipliner_session",
      flowName: "pipliner_oauth",
      secure: false,
    });
  });
});
