import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AdminUsersBody, HistoryBody } from "../../domain/adminContract.ts";
import { AUDIT_ACTIONS } from "../../domain/auditActions.ts";
import { HttpError } from "../exceptions/HttpError.ts";
import type { SessionVariables } from "../middleware/session.ts";
import { listHistory } from "../repositories/auditEvents.ts";
import { RoleChangeRequest, StepUpRequest } from "../schemas/admin.schema.ts";
import { changeRole, listAdminUsers, removeUser } from "../services/accountData.ts";
import { endSessions } from "../services/sessions.ts";
import { checkStepUpCode, resetSecondFactor } from "../services/twoFactor.ts";
import { parseJsonBody } from "../validators/parseJsonBody.ts";
import type { AuthDeps } from "./auth.ts";

type AdminContext = Context<{ Variables: SessionVariables }>;

/** Entrées de l'historique par page : une page d'écran, pas une limite d'exploitation. */
const HISTORY_PAGE = 50;

const UserId = z.coerce.number().int().positive();
const HistoryQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
});

/**
 * `/api/admin/users/*` et `/api/admin/history` : les personnes et l'historique. Monté dans `apiRouter`
 * derrière la session, le code du jour et `requireAdmin`. Rôle, retrait du code et effacement exigent
 * en plus un code à 6 chiffres actuel ; fermer les sessions de quelqu'un, non (sans risque).
 */
export function adminUsersRouter(deps: AuthDeps): Hono<{ Variables: SessionVariables }> {
  return new Hono<{ Variables: SessionVariables }>()
    .get("/users", (c) => c.json({ users: listAdminUsers(deps.sessions) } satisfies AdminUsersBody))
    .post("/users/:id/role", async (c) => {
      const { role, code } = await parseJsonBody(c, RoleChangeRequest);
      checkStepUpCode(deps.twoFactor, c.get("session"), code);
      changeRole(deps.sessions, targetOf(c), role, c.get("session").userId);
      return c.body(null, 204);
    })
    .post("/users/:id/reset-two-factor", async (c) => {
      const { code } = await parseJsonBody(c, StepUpRequest);
      checkStepUpCode(deps.twoFactor, c.get("session"), code);
      resetSecondFactor(deps.twoFactor, targetOf(c), c.get("session").userId);
      return c.body(null, 204);
    })
    .post("/users/:id/sign-out", async (c) => {
      const target = targetOf(c);
      const ended = endSessions(deps.sessions, { userId: target }, { action: "user.sign_out", actorId: c.get("session").userId, targetId: target });
      deps.dashboard.forgetUser(target);
      await deps.tokens.revokeEnded(ended, "/api/admin/users/:id/sign-out");
      return c.json({ ended: ended.length });
    })
    .post("/users/:id/delete", async (c) => {
      const { code } = await parseJsonBody(c, StepUpRequest);
      checkStepUpCode(deps.twoFactor, c.get("session"), code);
      const target = targetOf(c);
      const ended = removeUser(deps.sessions, target, c.get("session"));
      deps.dashboard.forgetUser(target);
      await deps.tokens.revokeEnded(ended, "/api/admin/users/:id/delete");
      return c.body(null, 204);
    })
    .get("/history", (c) => c.json(historyBody(c, deps)));
}

function targetOf(c: AdminContext): number {
  const id = UserId.safeParse(c.req.param("id"));
  if (!id.success) throw new HttpError(400, "bad_request", "Invalid user id");
  return id.data;
}

function historyBody(c: AdminContext, deps: AuthDeps): HistoryBody {
  const query = HistoryQuery.safeParse({ before: c.req.query("before"), action: c.req.query("action") || undefined });
  if (!query.success) throw new HttpError(400, "bad_request", "Invalid history query");
  const records = listHistory(deps.sessions.db, {
    before: query.data.before ?? null,
    action: query.data.action ?? null,
    limit: HISTORY_PAGE,
  });
  return {
    entries: records.map((record) => ({
      id: record.id,
      at: new Date(record.at * 1000).toISOString(),
      action: record.action,
      actor: record.actorLogin,
      target: record.targetLogin,
      keys: record.keys,
    })),
    nextBefore: records.length === HISTORY_PAGE ? (records.at(-1)?.id ?? null) : null,
  };
}
