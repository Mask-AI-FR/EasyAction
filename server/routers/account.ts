import { Hono, type Context } from "hono";
import { deleteCookie } from "hono/cookie";
import type { AccountSessionsBody, SessionsEndedBody } from "../../domain/accountContract.ts";
import { logger } from "../config/logger.ts";
import { HttpError } from "../exceptions/HttpError.ts";
import type { SessionVariables } from "../middleware/session.ts";
import { DeleteAccountRequest } from "../schemas/account.schema.ts";
import { deleteAccountData, exportAccountData, listAccountSessions } from "../services/accountData.ts";
import { endSessions } from "../services/sessions.ts";
import { parseJsonBody } from "../validators/parseJsonBody.ts";
import type { AuthDeps } from "./auth.ts";

type AccountContext = Context<{ Variables: SessionVariables }>;

/**
 * `/api/account/*` : les sessions de la personne connectée, l'export et l'effacement de ses données.
 * Monté DANS `apiRouter`, derrière ses gardes (session, origine, `no-store`) : aucune garde ici.
 */
export function accountRouter(deps: AuthDeps): Hono<{ Variables: SessionVariables }> {
  return new Hono<{ Variables: SessionVariables }>()
    .get("/sessions", (c) => c.json(sessionsBody(c, deps)))
    .post("/sessions/sign-out-others", async (c) => c.json(await signOutOthers(c, deps)))
    .post("/sessions/sign-out-all", async (c) => signOutEverywhere(c, deps))
    .get("/export", (c) => exportData(c, deps))
    .post("/delete", async (c) => deleteData(c, deps));
}

function sessionsBody(c: AccountContext, deps: AuthDeps): AccountSessionsBody {
  return { sessions: listAccountSessions(deps.sessions, c.get("session")) };
}

/** Ferme toutes les AUTRES sessions de la personne (un appareil perdu, un navigateur oublié). */
async function signOutOthers(c: AccountContext, deps: AuthDeps): Promise<SessionsEndedBody> {
  const session = c.get("session");
  const ended = endSessions(
    deps.sessions,
    { userId: session.userId, except: session.idHash },
    { action: "session.end_others", actorId: session.userId },
  );
  await deps.tokens.revokeEnded(ended, "/api/account/sessions/sign-out-others");
  return { ended: ended.length };
}

/** Ferme toutes les sessions de la personne, celle-ci comprise. */
async function signOutEverywhere(c: AccountContext, deps: AuthDeps): Promise<Response> {
  const session = c.get("session");
  const ended = endSessions(
    deps.sessions,
    { userId: session.userId },
    { action: "session.end_all", actorId: session.userId },
  );
  clearSessionCookie(c, deps);
  deps.dashboard.forgetUser(session.userId);
  await deps.tokens.revokeEnded(ended, "/api/account/sessions/sign-out-all");
  return c.body(null, 204);
}

/** Téléchargement de toutes les données gardées sur la personne (JSON, sans jeton ni chiffré). */
function exportData(c: AccountContext, deps: AuthDeps): Response {
  const day = new Date().toISOString().slice(0, 10);
  c.header("Content-Disposition", `attachment; filename="easyactions-my-data-${day}.json"`);
  return c.json(exportAccountData(deps.sessions, c.get("session")));
}

/**
 * Efface la personne et ses sessions, après avoir retapé son login GitHub. Ses jetons sont ensuite
 * révoqués chez GitHub (échec ouvert : les données sont déjà effacées chez nous).
 */
async function deleteData(c: AccountContext, deps: AuthDeps): Promise<Response> {
  const session = c.get("session");
  const { confirmLogin } = await parseJsonBody(c, DeleteAccountRequest);
  // Les logins GitHub ne distinguent pas les majuscules.
  if (confirmLogin.toLowerCase() !== session.login.toLowerCase()) {
    throw new HttpError(400, "bad_request", "Type your GitHub login to confirm");
  }
  const ended = deleteAccountData(deps.sessions, session);
  clearSessionCookie(c, deps);
  deps.dashboard.forgetUser(session.userId);
  await deps.tokens.revokeEnded(ended, "/api/account/delete");
  logger.info("account.deleted", { route: "/api/account/delete", method: "POST", status: 204 });
  return c.body(null, 204);
}

function clearSessionCookie(c: AccountContext, deps: AuthDeps): void {
  deleteCookie(c, deps.cookies.sessionName, { path: "/", secure: deps.cookies.secure });
}
