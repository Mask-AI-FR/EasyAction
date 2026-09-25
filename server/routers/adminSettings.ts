import { Hono, type Context } from "hono";
import { deleteCookie } from "hono/cookie";
import { apiUrlFor, isPairedApiUrl } from "../../domain/githubHosts.ts";
import { checkLimitChanges } from "../../domain/settingsCatalog.ts";
import type { ConnectionTestBody, GitHubConnectionSavedBody, SettingsBody } from "../../domain/settingsContract.ts";
import { testGitHubApi, type ConnectionProblem } from "../adapters/githubConnection.ts";
import { logger } from "../config/logger.ts";
import { HttpError } from "../exceptions/HttpError.ts";
import type { SessionVariables } from "../middleware/session.ts";
import { ConnectionTestRequest, GitHubConnectionUpdateRequest, LimitsUpdateRequest } from "../schemas/settings.schema.ts";
import { endSessions } from "../services/sessions.ts";
import { saveGitHubConnection, settingsBodyOf, updateLimits } from "../services/settings.ts";
import { checkStepUpCode } from "../services/twoFactor.ts";
import { parseJsonBody } from "../validators/parseJsonBody.ts";
import type { AuthDeps } from "./auth.ts";

type AdminContext = Context<{ Variables: SessionVariables }>;

/**
 * `/api/admin/settings/*` : la page Settings. Monté dans `apiRouter` derrière la session, le code du
 * jour et `requireAdmin` (posé une fois pour tout `/api/admin/*`) : aucune garde ici.
 */
export function adminSettingsRouter(deps: AuthDeps): Hono<{ Variables: SessionVariables }> {
  return new Hono<{ Variables: SessionVariables }>()
    .get("/", (c) => c.json(settingsBodyOf(deps.sessions.db) satisfies SettingsBody))
    .put("/limits", async (c) => c.json(await putLimits(c, deps)))
    .post("/github/test", async (c) => c.json(await testConnection(c, deps)))
    .put("/github", async (c) => saveConnection(c, deps));
}

async function putLimits(c: AdminContext, deps: AuthDeps): Promise<SettingsBody> {
  const { values } = await parseJsonBody(c, LimitsUpdateRequest);
  const { accepted, invalid } = checkLimitChanges(values);
  if (invalid.length > 0) throw new HttpError(400, "bad_request", `Invalid value for ${invalid.join(", ")}`);
  updateLimits(deps.sessions.db, accepted, c.get("session").userId);
  // Des plafonds du tableau de bord ont pu changer : aucun résultat calculé avant n'est resservi.
  deps.dashboard.clear();
  return settingsBodyOf(deps.sessions.db);
}

/** L'adresse d'API doit aller avec l'adresse web : sinon, dire laquelle est attendue. */
function ensurePaired(webUrl: string, apiUrl: string): void {
  if (!isPairedApiUrl(webUrl, apiUrl)) {
    throw new HttpError(400, "bad_request", `The API address must be ${apiUrlFor(webUrl) ?? "the one of the GitHub address"}`);
  }
}

const PROBLEMS: Record<ConnectionProblem, string> = {
  unreachable: "Nothing answers at this API address.",
  timeout: "The API address did not answer in time.",
  not_github: "This address does not answer like a GitHub API.",
};

async function testConnection(c: AdminContext, deps: AuthDeps): Promise<ConnectionTestBody> {
  const { webUrl, apiUrl } = await parseJsonBody(c, ConnectionTestRequest);
  ensurePaired(webUrl, apiUrl);
  const problem = await testGitHubApi(apiUrl, deps.settings().github.timeoutMs);
  return problem ? { ok: false, message: PROBLEMS[problem] } : { ok: true, message: "GitHub answers at this address." };
}

/**
 * Enregistre la connexion à GitHub : code à 6 chiffres actuel, paire web/API, test de connexion — puis
 * seulement l'écriture. Adresse ou identifiant changés : TOUTES les sessions sont fermées (celle-ci
 * comprise) et leurs jetons révoqués avec l'ANCIENNE connexion, qui les a délivrés (échec ouvert).
 * Un secret seul qui change garde les sessions : les jetons restent ceux de la même app.
 */
async function saveConnection(c: AdminContext, deps: AuthDeps): Promise<Response> {
  const session = c.get("session");
  const input = await parseJsonBody(c, GitHubConnectionUpdateRequest);
  ensurePaired(input.webUrl, input.apiUrl);
  checkStepUpCode(deps.twoFactor, session, input.code);
  const previous = deps.settings().github;
  const problem = await testGitHubApi(input.apiUrl, previous.timeoutMs);
  if (problem) throw new HttpError(400, "bad_request", PROBLEMS[problem]);
  const { code: _code, ...connection } = input;
  const { changedIdentity } = saveGitHubConnection(deps.sessions.db, deps.sessions.dataKey, connection, session.userId);
  deps.dashboard.clear();
  if (!changedIdentity) return c.json({ signedEveryoneOut: false } satisfies GitHubConnectionSavedBody);
  const ended = endSessions(deps.sessions, { all: true }, { action: "session.end_all", actorId: session.userId });
  deleteCookie(c, deps.cookies.sessionName, { path: "/", secure: deps.cookies.secure });
  await deps.tokens.revokeEnded(ended, "/api/admin/settings/github", previous);
  logger.warn("settings.github_changed", { route: "/api/admin/settings/github", method: "PUT", status: 200 });
  return c.json({ signedEveryoneOut: true } satisfies GitHubConnectionSavedBody);
}
