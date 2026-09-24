import { describe, expect, test } from "bun:test";
import {
  cookiePolicyFor,
  deriveSessionKey,
  openOAuthFlow,
  openSession,
  sealOAuthFlow,
  sealSession,
  type UserSession,
} from "../../server/auth/sessionCookie.ts";

const key = deriveSessionKey("not-a-real-secret-only-for-tests-000000");
const nowSeconds = () => Math.floor(Date.now() / 1000);

const session: UserSession = {
  userId: 42,
  login: "octo-test",
  avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
  accessToken: "ghu_not-a-real-token",
  expiresAt: nowSeconds() + 3600,
};

describe("cookie de session chiffré", () => {
  test("se relit à l'identique avec la bonne clé", async () => {
    expect(await openSession(await sealSession(session, key), key)).toEqual(session);
  });

  test("ne laisse jamais le jeton GitHub en clair dans le cookie", async () => {
    const sealed = await sealSession(session, key);
    expect(sealed).not.toContain("ghu_");
    expect(sealed).not.toContain("octo-test");
  });

  test("un cookie modifié ne vaut rien (échec fermé)", async () => {
    const sealed = await sealSession(session, key);
    const tampered = `${sealed.slice(0, -4)}${sealed.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
    expect(await openSession(tampered, key)).toBeNull();
  });

  test("un cookie expiré ne vaut rien", async () => {
    const sealed = await sealSession({ ...session, expiresAt: nowSeconds() - 1 }, key);
    expect(await openSession(sealed, key)).toBeNull();
  });

  test("un autre secret de configuration ne l'ouvre pas", async () => {
    const sealed = await sealSession(session, key);
    expect(await openSession(sealed, deriveSessionKey("another-secret-that-is-long-enough-00"))).toBeNull();
  });

  test("un cookie de flux OAuth n'est jamais accepté comme session, ni l'inverse", async () => {
    const flow = await sealOAuthFlow({ state: "s", codeVerifier: "v", returnTo: "/orgs" }, key);
    expect(await openSession(flow, key)).toBeNull();
    expect(await openOAuthFlow(await sealSession(session, key), key)).toBeNull();
    expect(await openOAuthFlow(flow, key)).toEqual({ state: "s", codeVerifier: "v", returnTo: "/orgs" });
  });

  test("pas de cookie : pas de session", async () => {
    expect(await openSession(undefined, key)).toBeNull();
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
