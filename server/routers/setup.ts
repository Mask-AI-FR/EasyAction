import { Hono, type Context } from "hono";
import type { ConnectionTestBody, SetupStatusBody } from "../../domain/settingsContract.ts";
import { checkSetupCode } from "../auth/setupCode.ts";
import { logger } from "../config/logger.ts";
import { HttpError } from "../exceptions/HttpError.ts";
import { originGuard } from "../middleware/originGuard.ts";
import { SetupConnectionRequest, SetupTestRequest } from "../schemas/settings.schema.ts";
import { deriveSetupCodeKey } from "../security/dataCipher.ts";
import { completeSetup, isConfigured, settingsBodyOf } from "../services/settings.ts";
import { parseJsonBody } from "../validators/parseJsonBody.ts";
import { connectionTestOf, ensurePaired } from "./adminSettings.ts";
import type { AuthDeps } from "./auth.ts";

/**
 * Les seules routes de l'API ouvertes sans session. Élargir cette liste est une décision de sécurité :
 * `tests/unit/secondFactorGate.test.ts` la fige.
 */
export const SETUP_ROUTES: ReadonlySet<string> = new Set(["GET /api/setup", "POST /api/setup/test", "POST /api/setup/github"]);

/**
 * `/api/setup/*` : l'installation depuis le navigateur. Monté AVANT `/api` : ces routes répondent sans
 * session, et les gardes de `/api`, enregistrées après, ne s'exécutent jamais pour elles (Hono ne passe
 * au gestionnaire suivant que par `next()`).
 * - Tester et enregistrer exigent le code d'installation (`bun run settings:setup-code`) et l'`Origin`
 *   exacte de l'app : sans code, personne ne fait appeler une adresse au serveur.
 * - ÉCHEC FERMÉ une fois installé : `404` — l'installation n'écrase jamais une connexion qui marche ;
 *   la changer passe par la page Settings (administrateur + code à 6 chiffres actuel).
 */
export function setupRouter(deps: AuthDeps): Hono {
  const setupKey = deriveSetupCodeKey(deps.env.dataEncryptionKey);
  const { db, dataKey } = deps.sessions;
  return new Hono()
    .get("/", (c) => c.json({ required: !isConfigured(db, dataKey) } satisfies SetupStatusBody))
    .post("/test", originGuard(deps.env.appOrigin), async (c) => c.json(await testDuringSetup(c, deps, setupKey)))
    .post("/github", originGuard(deps.env.appOrigin), async (c) => saveDuringSetup(c, deps, setupKey));
}

function ensureSetupOpen(deps: AuthDeps): void {
  if (isConfigured(deps.sessions.db, deps.sessions.dataKey)) {
    throw new HttpError(404, "not_found", "EasyActions is already set up: change the GitHub connection on the Settings page");
  }
}

function ensureSetupCode(setupKey: Uint8Array, code: string): void {
  if (!checkSetupCode(setupKey, code, Math.floor(Date.now() / 1000))) {
    throw new HttpError(400, "invalid_code", "The setup code is wrong or has expired: run `bun run settings:setup-code` again");
  }
}

/** Délai des appels à GitHub : le réglage s'il est enregistré, sinon la valeur par défaut du catalogue. */
const timeoutOf = (deps: AuthDeps): number => settingsBodyOf(deps.sessions.db).limits.githubTimeoutMs;

async function testDuringSetup(c: Context, deps: AuthDeps, setupKey: Uint8Array): Promise<ConnectionTestBody> {
  ensureSetupOpen(deps);
  const { setupCode, webUrl, apiUrl } = await parseJsonBody(c, SetupTestRequest);
  ensureSetupCode(setupKey, setupCode);
  ensurePaired(webUrl, apiUrl);
  return connectionTestOf(apiUrl, timeoutOf(deps));
}

/** Code, paire d'adresses, test de connexion — puis seulement l'écriture (`completeSetup`). */
async function saveDuringSetup(c: Context, deps: AuthDeps, setupKey: Uint8Array): Promise<Response> {
  ensureSetupOpen(deps);
  const { setupCode, ...connection } = await parseJsonBody(c, SetupConnectionRequest);
  ensureSetupCode(setupKey, setupCode);
  ensurePaired(connection.webUrl, connection.apiUrl);
  const test = await connectionTestOf(connection.apiUrl, timeoutOf(deps));
  if (!test.ok) throw new HttpError(400, "bad_request", test.message);
  completeSetup(deps.sessions.db, deps.sessions.dataKey, connection);
  deps.dashboard.clear();
  logger.info("settings.setup_done", { route: "/api/setup/github", method: "POST", status: 204 });
  return c.body(null, 204);
}
