import { Hono, type Context, type MiddlewareHandler } from "hono";
import type {
  BranchesBody,
  OrgsBody,
  ReposBody,
  SessionBody,
  WorkflowsBody,
} from "../../domain/apiContract.ts";
import { DASHBOARD_DAYS, type DashboardBody, type DashboardDays } from "../../domain/dashboardContract.ts";
import type { DispatchBody, RunsBody } from "../../domain/dispatchContract.ts";
import { latestRunByWorkflow } from "../../domain/runStatus.ts";
import { dispatchWorkflow, listRecentRuns, listWorkflows } from "../adapters/githubActions.ts";
import type { RepoPath } from "../adapters/githubApi.ts";
import {
  listBranches,
  listInstallationRepos,
  listOrgInstallations,
  type OrgInstallation,
} from "../adapters/githubRepos.ts";
import type { GitHubSettings, Limits } from "../config/env.ts";
import { logger } from "../config/logger.ts";
import { HttpError } from "../exceptions/HttpError.ts";
import { originGuard } from "../middleware/originGuard.ts";
import { requireAdmin } from "../middleware/admin.ts";
import { requireSecondFactor } from "../middleware/secondFactor.ts";
import { requireSession, type SessionVariables } from "../middleware/session.ts";
import { BranchName, DispatchRequest, OrgLogin, RepoName, RunsQuery } from "../schemas/api.schema.ts";
import { runDispatches } from "../services/dispatchRunner.ts";
import { trackRuns } from "../services/runTracker.ts";
import type { ActiveSession } from "../services/sessions.ts";
import { secondFactorStateOf, type TwoFactorStore } from "../services/twoFactor.ts";
import { parseJsonBody } from "../validators/parseJsonBody.ts";
import { accountRouter } from "./account.ts";
import { adminSettingsRouter } from "./adminSettings.ts";
import { adminUsersRouter } from "./adminUsers.ts";
import type { AuthDeps } from "./auth.ts";
import { twoFactorRouter } from "./twoFactor.ts";

type ApiContext = Context<{ Variables: SessionVariables }>;

/** Les réponses de l'API sont propres à un utilisateur : aucun cache ne doit les conserver. */
const noStore: MiddlewareHandler = async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
};

/**
 * Un lot de lancements peut durer plusieurs minutes (GitHub répond à chaque cible) : son jeton doit
 * rester valable jusqu'au bout, sinon un renouvellement en route invaliderait celui du lot.
 */
const DISPATCH_TOKEN_VALIDITY_MS = 10 * 60_000;

/** Marge de validité du jeton au-delà de l'échéance du tableau de bord (la dernière réponse de GitHub). */
const DASHBOARD_TOKEN_MARGIN_MS = 60_000;

/**
 * `/api/*`. Les gardes sont posées AVANT toute route (motif `protectedRouter` de Billing) : une
 * route ajoutée plus tard ne peut pas oublier la session ni le contrôle d'origine — `POST
 * /api/dispatches` compris. Les échecs GitHub remontent en `GitHubApiError` et sont rendus par
 * `exceptions/errorHandler.ts`.
 */
export function apiRouter(deps: AuthDeps): Hono<{ Variables: SessionVariables }> {
  const router = new Hono<{ Variables: SessionVariables }>();
  router.use(
    "*",
    noStore,
    originGuard(deps.env.appOrigin),
    requireSession({ store: deps.sessions, tokens: deps.tokens, cookieName: deps.cookies.sessionName }),
    requireSecondFactor(deps.twoFactor),
  );
  // Montés APRÈS les gardes, et sans garde propre : Hono réenregistre le `use("*")` d'un sous-routeur
  // sur le chemin de montage, ce qui doublerait la session.
  router.route("/account/two-factor", twoFactorRouter(deps));
  router.route("/account", accountRouter(deps));
  // Tout `/api/admin/*` : administrateurs seulement, garde posée une fois, avant les routes.
  router.use("/admin/*", requireAdmin);
  router.route("/admin/settings", adminSettingsRouter(deps));
  router.route("/admin", adminUsersRouter(deps));
  router.get("/session", (c) => c.json(sessionBodyOf(c.get("session"), deps.settings().limits, deps.twoFactor)));
  router.get("/orgs", async (c) => c.json(await orgsBody(c, deps)));
  router.get("/orgs/:org/repos", async (c) => c.json(await reposBody(c, deps)));
  router.get("/orgs/:org/dashboard", async (c) => c.json(await dashboardBody(c, deps)));
  router.get("/repos/:owner/:repo/branches", async (c) => c.json(await branchesBody(c, deps)));
  router.get("/repos/:owner/:repo/workflows", async (c) => c.json(await workflowsBody(c, deps)));
  router.get("/repos/:owner/:repo/runs", async (c) => c.json(await runsBody(c, deps)));
  router.post("/dispatches", async (c) => c.json(await dispatchBody(c, deps)));
  return router;
}

/** Ce que l'application a le droit de savoir de la session : jamais un jeton GitHub. */
function sessionBodyOf(session: ActiveSession, limits: Limits, twoFactor: TwoFactorStore): SessionBody {
  return {
    user: { login: session.login, avatarUrl: session.avatarUrl, role: session.role },
    secondFactor: secondFactorStateOf(twoFactor, session),
    expiresAt: new Date(session.expiresAt * 1000).toISOString(),
    limits: {
      dispatchMaxTargets: limits.dispatchMaxTargets,
      runPollMinSeconds: limits.runPollMinSeconds,
      runTrackMaxMinutes: limits.runTrackMaxMinutes,
    },
  };
}

async function orgsBody(c: ApiContext, deps: AuthDeps): Promise<OrgsBody> {
  const { github } = deps.settings();
  const installations = await listOrgInstallations(github, await c.get("githubToken")());
  const appSlug = installations[0]?.appSlug;
  return {
    orgs: installations.map((installation) => installation.org),
    installUrl: appSlug ? `${github.webUrl}/apps/${appSlug}/installations/new` : null,
  };
}

async function reposBody(c: ApiContext, deps: AuthDeps): Promise<ReposBody> {
  const installation = await installationFor(c, deps);
  const { github, limits } = deps.settings();
  const { repos, totalCount } = await listInstallationRepos(
    github,
    await c.get("githubToken")(),
    installation.id,
    limits.reposMax,
  );
  return {
    org: installation.org.login,
    totalCount,
    truncated: totalCount > repos.length,
    repos,
  };
}

/**
 * Statistiques d'une organisation (`services/dashboardCollector.ts`). Le jeton doit tenir jusqu'à
 * l'échéance (un renouvellement en route invaliderait celui de la collecte) ; l'accès à l'organisation
 * est revérifié chez GitHub à CHAQUE appel, même quand le résultat vient de la mémoire.
 */
async function dashboardBody(c: ApiContext, deps: AuthDeps): Promise<DashboardBody> {
  const days = dashboardDaysOf(c.req.query("days"));
  const { github, limits } = deps.settings();
  const budgetMs = dashboardBudgetMs(limits, github, deps.env.httpIdleTimeoutSeconds);
  const deadline = Date.now() + budgetMs;
  const token = await c.get("githubToken")({ minValidityMs: budgetMs + DASHBOARD_TOKEN_MARGIN_MS });
  const installation = await installationFor(c, deps);
  return deps.dashboard.dashboard({
    session: c.get("session"),
    installation,
    days,
    fresh: c.req.query("fresh") === "1",
    github,
    token,
    limits,
    deadline,
  });
}

function dashboardDaysOf(value: string | undefined): DashboardDays {
  const days = DASHBOARD_DAYS.find((option) => String(option) === (value ?? "30"));
  if (days === undefined) throw new HttpError(400, "bad_request", "Invalid dashboard period");
  return days;
}

/**
 * Temps accordé à la lecture de GitHub : le réglage, mais assez court pour qu'une requête lancée juste
 * avant l'échéance tienne encore dans l'inactivité HTTP de Bun — sinon Bun coupe la connexion et le
 * navigateur ne reçoit jamais la réponse.
 */
function dashboardBudgetMs(limits: Limits, github: GitHubSettings, idleTimeoutSeconds: number): number {
  const ceiling = (idleTimeoutSeconds - 5) * 1000 - github.timeoutMs;
  return Math.max(1000, Math.min(limits.statsDeadlineSeconds * 1000, ceiling));
}

/**
 * L'installation de l'app sur l'organisation demandée, parmi celles que l'utilisateur voit : c'est
 * ce qui borne l'accès. Une organisation absente de la liste répond 404, qu'elle existe ou non.
 */
async function installationFor(c: ApiContext, deps: AuthDeps): Promise<OrgInstallation> {
  const org = OrgLogin.safeParse(c.req.param("org"));
  if (!org.success) throw new HttpError(400, "bad_request", "Invalid organization name");
  const wanted = org.data.toLowerCase();
  const installations = await listOrgInstallations(deps.settings().github, await c.get("githubToken")());
  const installation = installations.find((item) => item.org.login.toLowerCase() === wanted);
  if (!installation) {
    throw new HttpError(404, "not_found", "The GitHub App is not installed on this organization");
  }
  return installation;
}

/** Dépôt désigné par l'adresse, validé avant tout appel. L'accès réel, c'est GitHub qui le tranche. */
function repoPathOf(c: ApiContext): RepoPath {
  const owner = OrgLogin.safeParse(c.req.param("owner"));
  const repo = RepoName.safeParse(c.req.param("repo"));
  if (!owner.success || !repo.success) throw new HttpError(400, "bad_request", "Invalid repository name");
  return { owner: owner.data, repo: repo.data };
}

async function branchesBody(c: ApiContext, deps: AuthDeps): Promise<BranchesBody> {
  const { github, limits } = deps.settings();
  // Nom validé AVANT de demander un jeton : une adresse invalide ne déclenche aucun renouvellement.
  const repo = repoPathOf(c);
  const { defaultBranch, branches, truncated } = await listBranches(github, await c.get("githubToken")(), repo, {
    max: limits.branchesMax,
    activeDays: limits.activeBranchDays,
  });
  // Forme de réponse inchangée (interface publique) : le total ne sert qu'au tableau de bord.
  return { defaultBranch, branches, truncated };
}

async function workflowsBody(c: ApiContext, deps: AuthDeps): Promise<WorkflowsBody> {
  const repo = repoPathOf(c);
  const branch = BranchName.safeParse(c.req.query("branch"));
  if (!branch.success) throw new HttpError(400, "bad_request", "Invalid branch name");
  const token = await c.get("githubToken")();
  const { github } = deps.settings();
  const [definitions, runs] = await Promise.all([
    listWorkflows(github, token, repo),
    listRecentRuns(github, token, repo, { branch: branch.data }),
  ]);
  const latest = latestRunByWorkflow(runs);
  return {
    branch: branch.data,
    workflows: definitions.map((workflow) => ({ ...workflow, latestRun: latest.get(workflow.id) ?? null })),
  };
}

async function runsBody(c: ApiContext, deps: AuthDeps): Promise<RunsBody> {
  const repo = repoPathOf(c);
  const query = RunsQuery.safeParse({ ids: c.req.query("ids"), since: c.req.query("since") });
  if (!query.success) throw new HttpError(400, "bad_request", "Invalid run query");
  const ids = query.data.ids.split(",").map(Number);
  const runs = await trackRuns(deps.settings().github, await c.get("githubToken")(), repo, {
    ids,
    since: query.data.since,
  });
  return { runs };
}

/**
 * Lance les pipelines demandés. Le serveur revalide tout (schéma, plafond) : la confirmation de
 * l'interface n'est qu'un confort. La réponse est 200 même si des cibles ont échoué : chacune porte
 * son issue.
 */
async function dispatchBody(c: ApiContext, deps: AuthDeps): Promise<DispatchBody> {
  const { targets } = await parseJsonBody(c, DispatchRequest);
  const { github, limits } = deps.settings();
  if (targets.length > limits.dispatchMaxTargets) {
    throw new HttpError(400, "bad_request", "Too many pipelines in one request");
  }
  const token = await c.get("githubToken")({ minValidityMs: DISPATCH_TOKEN_VALIDITY_MS });
  const outcomes = await runDispatches(
    targets,
    (target) => dispatchWorkflow(github, token, target),
    limits.dispatchConcurrency,
  );
  logger.info("dispatch.completed", { route: "/api/dispatches", method: "POST", status: 200 });
  return { outcomes };
}
