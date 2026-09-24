import { Hono, type Context, type MiddlewareHandler } from "hono";
import type {
  BranchesBody,
  OrgsBody,
  ReposBody,
  SessionBody,
  WorkflowsBody,
} from "../../domain/apiContract.ts";
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
import type { UserSession } from "../auth/sessionCookie.ts";
import type { Limits } from "../config/env.ts";
import { logger } from "../config/logger.ts";
import { HttpError } from "../exceptions/HttpError.ts";
import { originGuard } from "../middleware/originGuard.ts";
import { requireSession, type SessionVariables } from "../middleware/session.ts";
import { BranchName, DispatchRequest, OrgLogin, RepoName, RunsQuery } from "../schemas/api.schema.ts";
import { runDispatches } from "../services/dispatchRunner.ts";
import { trackRuns } from "../services/runTracker.ts";
import { parseJsonBody } from "../validators/parseJsonBody.ts";
import type { AuthDeps } from "./auth.ts";

type ApiContext = Context<{ Variables: SessionVariables }>;

/** Les réponses de l'API sont propres à un utilisateur : aucun cache ne doit les conserver. */
const noStore: MiddlewareHandler = async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
};

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
    requireSession(deps.key, deps.cookies.sessionName),
  );
  router.get("/session", (c) => c.json(sessionBodyOf(c.get("session"), deps.env.limits)));
  router.get("/orgs", async (c) => c.json(await orgsBody(c, deps)));
  router.get("/orgs/:org/repos", async (c) => c.json(await reposBody(c, deps)));
  router.get("/repos/:owner/:repo/branches", async (c) => c.json(await branchesBody(c, deps)));
  router.get("/repos/:owner/:repo/workflows", async (c) => c.json(await workflowsBody(c, deps)));
  router.get("/repos/:owner/:repo/runs", async (c) => c.json(await runsBody(c, deps)));
  router.post("/dispatches", async (c) => c.json(await dispatchBody(c, deps)));
  return router;
}

/** Ce que l'application a le droit de savoir de la session : jamais le jeton GitHub. */
function sessionBodyOf(session: UserSession, limits: Limits): SessionBody {
  return {
    user: { login: session.login, avatarUrl: session.avatarUrl },
    expiresAt: new Date(session.expiresAt * 1000).toISOString(),
    limits: {
      dispatchMaxTargets: limits.dispatchMaxTargets,
      runPollMinSeconds: limits.runPollMinSeconds,
      runTrackMaxMinutes: limits.runTrackMaxMinutes,
    },
  };
}

async function orgsBody(c: ApiContext, deps: AuthDeps): Promise<OrgsBody> {
  const { github } = deps.env;
  const installations = await listOrgInstallations(github, c.get("session").accessToken);
  const appSlug = installations[0]?.appSlug;
  return {
    orgs: installations.map((installation) => installation.org),
    installUrl: appSlug ? `${github.webUrl}/apps/${appSlug}/installations/new` : null,
  };
}

async function reposBody(c: ApiContext, deps: AuthDeps): Promise<ReposBody> {
  const installation = await installationFor(c, deps);
  const { repos, totalCount } = await listInstallationRepos(
    deps.env.github,
    c.get("session").accessToken,
    installation.id,
    deps.env.limits.reposMax,
  );
  return {
    org: installation.org.login,
    totalCount,
    truncated: totalCount > repos.length,
    repos,
  };
}

/**
 * L'installation de l'app sur l'organisation demandée, parmi celles que l'utilisateur voit : c'est
 * ce qui borne l'accès. Une organisation absente de la liste répond 404, qu'elle existe ou non.
 */
async function installationFor(c: ApiContext, deps: AuthDeps): Promise<OrgInstallation> {
  const org = OrgLogin.safeParse(c.req.param("org"));
  if (!org.success) throw new HttpError(400, "bad_request", "Invalid organization name");
  const wanted = org.data.toLowerCase();
  const installations = await listOrgInstallations(deps.env.github, c.get("session").accessToken);
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
  const { limits } = deps.env;
  return listBranches(deps.env.github, c.get("session").accessToken, repoPathOf(c), {
    max: limits.branchesMax,
    activeDays: limits.activeBranchDays,
  });
}

async function workflowsBody(c: ApiContext, deps: AuthDeps): Promise<WorkflowsBody> {
  const repo = repoPathOf(c);
  const branch = BranchName.safeParse(c.req.query("branch"));
  if (!branch.success) throw new HttpError(400, "bad_request", "Invalid branch name");
  const token = c.get("session").accessToken;
  const [definitions, runs] = await Promise.all([
    listWorkflows(deps.env.github, token, repo),
    listRecentRuns(deps.env.github, token, repo, { branch: branch.data }),
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
  const runs = await trackRuns(deps.env.github, c.get("session").accessToken, repo, {
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
  if (targets.length > deps.env.limits.dispatchMaxTargets) {
    throw new HttpError(400, "bad_request", "Too many pipelines in one request");
  }
  const token = c.get("session").accessToken;
  const outcomes = await runDispatches(
    targets,
    (target) => dispatchWorkflow(deps.env.github, token, target),
    deps.env.limits.dispatchConcurrency,
  );
  logger.info("dispatch.completed", { route: "/api/dispatches", method: "POST", status: 200 });
  return { outcomes };
}
