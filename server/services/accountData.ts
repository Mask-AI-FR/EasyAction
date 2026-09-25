import type { AccountExportBody, AccountRole, AccountSession } from "../../domain/accountContract.ts";
import type { AdminUserView } from "../../domain/adminContract.ts";
import { HttpError } from "../exceptions/HttpError.ts";
import { listAuditEventsAbout, recordAuditEvent } from "../repositories/auditEvents.ts";
import { findSecondFactor } from "../repositories/secondFactors.ts";
import { deleteSessions, listSessionsOfUser, type SessionRecord } from "../repositories/sessions.ts";
import { countAdmins, deleteUser, findUser, listUsers, setUserRole } from "../repositories/users.ts";
import type { ActiveSession, SessionStore } from "./sessions.ts";

/**
 * Les comptes : pour la personne connectée, ses sessions, l'export de ses données et leur effacement
 * (CLAUDE.md §7 : chaque donnée personnelle gardée est exportable et effaçable) ; pour les
 * administrateurs, la liste des personnes, leur rôle et leur effacement. L'export ne contient ni
 * jeton, ni valeur chiffrée, ni haché. Il reste TOUJOURS au moins un administrateur.
 */
const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();

function toAccountSession(session: SessionRecord, currentIdHash: string): AccountSession {
  return {
    createdAt: iso(session.createdAt),
    lastSeenAt: iso(session.lastSeenAt),
    expiresAt: iso(session.expiresAt),
    current: session.idHash === currentIdHash,
  };
}

/** Sessions ouvertes de la personne, de la plus récente à la plus ancienne. */
export function listAccountSessions(store: SessionStore, current: ActiveSession): AccountSession[] {
  return listSessionsOfUser(store.db, current.userId).map((session) => toAccountSession(session, current.idHash));
}

/**
 * Tout ce qu'EasyActions garde sur la personne. Écrit `account.export` à l'historique (dans la même
 * transaction que la lecture) : sortir des données personnelles est une action de sécurité.
 */
export function exportAccountData(store: SessionStore, current: ActiveSession): AccountExportBody {
  const now = Math.floor(Date.now() / 1000);
  return store.db.transaction(() => {
    recordAuditEvent(store.db, { action: "account.export", actorId: current.userId, targetId: null }, now);
    const user = findUser(store.db, current.userId);
    if (!user) throw new Error("Account vanished during its export");
    return {
      exportedAt: iso(now),
      user: {
        githubId: user.id,
        login: user.login,
        avatarUrl: user.avatarUrl,
        role: user.role,
        createdAt: iso(user.createdAt),
        lastSignInAt: iso(user.lastSignInAt),
      },
      sessions: listSessionsOfUser(store.db, user.id).map((session) => toAccountSession(session, current.idHash)),
      history: listAuditEventsAbout(store.db, user.id).map((event) => ({
        at: iso(event.at),
        action: event.action,
        as: event.actorId === user.id ? ("actor" as const) : ("target" as const),
      })),
    };
  })();
}

/** Effacer ou rétrograder le dernier administrateur est refusé : plus personne ne pourrait administrer. */
function ensureAnotherAdmin(store: SessionStore, userId: number): void {
  if (findUser(store.db, userId)?.role === "admin" && countAdmins(store.db) <= 1) {
    throw new HttpError(400, "bad_request", "Keep at least one administrator: make someone else admin first");
  }
}

/**
 * Efface une personne : sa ligne, ses sessions (rendues, pour révoquer leurs jetons), et son historique
 * devient anonyme (SET NULL). L'action est écrite AVANT l'effacement, qui l'anonymise aussitôt : il
 * reste la trace qu'un effacement a eu lieu, sans rien sur la personne. Le point de contrôle WAL
 * `TRUNCATE` vide ensuite le journal, où les anciennes pages pourraient encore traîner.
 */
function eraseUser(store: SessionStore, targetId: number, audit: { action: "account.delete" | "user.remove"; actorId: number }): SessionRecord[] {
  const now = Math.floor(Date.now() / 1000);
  const ended = store.db.transaction(() => {
    ensureAnotherAdmin(store, targetId);
    recordAuditEvent(store.db, { ...audit, targetId: audit.action === "user.remove" ? targetId : null }, now);
    const sessions = deleteSessions(store.db, { userId: targetId });
    deleteUser(store.db, targetId);
    return sessions;
  })();
  store.db.run("PRAGMA wal_checkpoint(TRUNCATE)");
  return ended;
}

/** « Delete my data » : la personne s'efface elle-même. */
export function deleteAccountData(store: SessionStore, current: ActiveSession): SessionRecord[] {
  return eraseUser(store, current.userId, { action: "account.delete", actorId: current.userId });
}

/** Un administrateur efface quelqu'un (jamais lui-même : la page du compte est là pour ça). */
export function removeUser(store: SessionStore, targetId: number, admin: ActiveSession): SessionRecord[] {
  if (targetId === admin.userId) throw new HttpError(400, "bad_request", "Use your account page to delete your own data");
  if (!findUser(store.db, targetId)) throw new HttpError(404, "not_found", "No such user");
  return eraseUser(store, targetId, { action: "user.remove", actorId: admin.userId });
}

/** Rôle d'une personne ; `actorId` : l'administrateur, ou `null` (ligne de commande). */
export function changeRole(store: SessionStore, targetId: number, role: AccountRole, actorId: number | null): void {
  store.db.transaction(() => {
    if (!findUser(store.db, targetId)) throw new HttpError(404, "not_found", "No such user");
    if (role === "member") ensureAnotherAdmin(store, targetId);
    setUserRole(store.db, targetId, role);
    recordAuditEvent(store.db, { action: "user.role_change", actorId, targetId }, Math.floor(Date.now() / 1000));
  })();
}

/** Les personnes, pour la page Users : rôle, code du jour en place ou non, navigateurs connectés. */
export function listAdminUsers(store: SessionStore): AdminUserView[] {
  return listUsers(store.db).map((user) => ({
    githubId: user.id,
    login: user.login,
    avatarUrl: user.avatarUrl,
    role: user.role,
    twoFactorEnabled: Boolean(findSecondFactor(store.db, user.id)?.secretEnc),
    lastSignInAt: iso(user.lastSignInAt),
    sessions: listSessionsOfUser(store.db, user.id).length,
  }));
}
