import { Hono, type Context } from "hono";
import { setCookie } from "hono/cookie";
import { renderSVG } from "uqr";
import type { EnrollmentBody, RecoveryCodesBody, TwoFactorStatusBody } from "../../domain/twoFactorContract.ts";
import { HttpError } from "../exceptions/HttpError.ts";
import type { SessionVariables } from "../middleware/session.ts";
import { CodeRequest, EnrollmentRequest, VerifyRequest } from "../schemas/twoFactor.schema.ts";
import { DataCipherError } from "../security/dataCipher.ts";
import { elevateSession, endSessions } from "../services/sessions.ts";
import {
  confirmEnrollment,
  pendingEnrollmentUri,
  regenerateRecoveryCodes,
  startEnrollment,
  twoFactorStatusOf,
  verifySecondFactor,
} from "../services/twoFactor.ts";
import { parseJsonBody } from "../validators/parseJsonBody.ts";
import { sessionCookieAttributes, type AuthDeps } from "./auth.ts";

type TwoFactorContext = Context<{ Variables: SessionVariables }>;

/**
 * `/api/account/two-factor/*` : mettre en place l'application d'authentification, saisir le code du
 * jour, renouveler les codes de secours. Monté DANS `apiRouter` (session, origine, `no-store`) ; les
 * routes utilisables avant le code du jour sont listées dans `middleware/secondFactor.ts`.
 */
export function twoFactorRouter(deps: AuthDeps): Hono<{ Variables: SessionVariables }> {
  return new Hono<{ Variables: SessionVariables }>()
    .get("/", (c) => c.json(twoFactorStatusOf(deps.twoFactor, c.get("session")) satisfies TwoFactorStatusBody))
    .post("/enrollment", async (c) => c.json(await start(c, deps)))
    .get("/enrollment/qr.svg", (c) => qrCode(c, deps))
    .post("/enrollment/confirm", async (c) => c.json(await confirm(c, deps)))
    .post("/verify", async (c) => verify(c, deps))
    .post("/recovery-codes", async (c) => c.json(await regenerate(c, deps)));
}

async function start(c: TwoFactorContext, deps: AuthDeps): Promise<EnrollmentBody> {
  const { code } = await parseJsonBody(c, EnrollmentRequest);
  return startEnrollment(deps.twoFactor, c.get("session"), code);
}

/**
 * Le secret en attente en code QR (SVG de `uqr` : seulement des rectangles et un tracé, vérifié). Servi
 * comme image de la même origine, jamais mis en cache (`no-store` de l'API).
 */
function qrCode(c: TwoFactorContext, deps: AuthDeps): Response {
  const uri = pendingEnrollmentUri(deps.twoFactor, c.get("session"));
  if (!uri) throw new HttpError(404, "not_found", "No setup in progress");
  c.header("Content-Type", "image/svg+xml");
  return c.body(renderSVG(uri, { ecc: "M", border: 2 }));
}

async function confirm(c: TwoFactorContext, deps: AuthDeps): Promise<RecoveryCodesBody> {
  const { code } = await parseJsonBody(c, CodeRequest);
  const recoveryCodes = confirmEnrollment(deps.twoFactor, c.get("session"), code);
  renewSessionCookie(c, deps);
  return { recoveryCodes };
}

async function verify(c: TwoFactorContext, deps: AuthDeps): Promise<Response> {
  const input = await parseJsonBody(c, VerifyRequest);
  verifySecondFactor(deps.twoFactor, c.get("session"), input);
  renewSessionCookie(c, deps);
  return c.body(null, 204);
}

async function regenerate(c: TwoFactorContext, deps: AuthDeps): Promise<RecoveryCodesBody> {
  const { code } = await parseJsonBody(c, CodeRequest);
  return { recoveryCodes: regenerateRecoveryCodes(deps.twoFactor, c.get("session"), code) };
}

/**
 * Code accepté : nouvel identifiant de session dans un nouveau cookie (l'ancien ne vaut plus rien).
 * ÉCHEC FERMÉ : session disparue, ou jetons illisibles (clé changée) → session fermée, 401.
 */
function renewSessionCookie(c: TwoFactorContext, deps: AuthDeps): void {
  const session = c.get("session");
  let renewed: ReturnType<typeof elevateSession>;
  try {
    renewed = elevateSession(deps.sessions, session.idHash);
  } catch (err) {
    if (!(err instanceof DataCipherError)) throw err;
    endSessions(deps.sessions, { idHash: session.idHash }, { action: "session.end", actorId: session.userId });
    renewed = null;
  }
  if (!renewed) throw new HttpError(401, "unauthorized", "Your session has ended.");
  setCookie(c, deps.cookies.sessionName, renewed.cookieValue, sessionCookieAttributes(deps, renewed.maxAgeSeconds));
}
