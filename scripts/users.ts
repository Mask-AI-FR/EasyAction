import { env } from "../server/config/env.ts";
import { openDatabase } from "../server/db/database.ts";
import { HttpError } from "../server/exceptions/HttpError.ts";
import { findSecondFactor } from "../server/repositories/secondFactors.ts";
import { findUserByLogin, listUsers } from "../server/repositories/users.ts";
import { deriveDataKey } from "../server/security/dataCipher.ts";
import { changeRole } from "../server/services/accountData.ts";
import { resetSecondFactor } from "../server/services/twoFactor.ts";

/**
 * Commandes d'exploitation des personnes (accès au serveur = racine de confiance) :
 *   bun run users:promote <login>            donne le rôle d'administrateur (le premier se crée ainsi)
 *   bun run users:demote <login>             le retire (jamais au dernier administrateur)
 *   bun run users:reset-two-factor <login>   retire l'application d'authentification (téléphone perdu)
 *   bun run users:reset-two-factor --all     la retire à tout le monde (après un changement de DATA_ENCRYPTION_KEY)
 * La personne doit s'être connectée au moins une fois. Chaque action est inscrite à l'historique, sans
 * auteur (la ligne de commande n'est pas une personne connectée).
 */
const say = (line: string): void => void process.stdout.write(`${line}\n`);

const storeOf = (db: ReturnType<typeof openDatabase>) => ({
  sessions: { db, dataKey: deriveDataKey(env.dataEncryptionKey), policy: env.sessions, auditRetentionDays: env.auditRetentionDays },
});

/** Rôle d'administrateur donné ou retiré ; la règle « au moins un administrateur » vaut ici aussi. */
function setRole(login: string | undefined, role: "admin" | "member"): number {
  if (!login) {
    say(`Usage: bun run users:${role === "admin" ? "promote" : "demote"} <github-login>`);
    return 2;
  }
  const db = openDatabase(env.databasePath);
  try {
    const user = findUserByLogin(db, login);
    if (!user) {
      say(`No EasyActions user named ${login}. They must sign in once first.`);
      return 1;
    }
    changeRole(storeOf(db).sessions, user.id, role, null);
    say(role === "admin" ? `${user.login} is now an administrator.` : `${user.login} is no longer an administrator.`);
    return 0;
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    say(err.message);
    return 1;
  } finally {
    db.close();
  }
}

function resetTwoFactor(target: string | undefined): number {
  if (!target) {
    say("Usage: bun run users:reset-two-factor <github-login> | --all");
    return 2;
  }
  const db = openDatabase(env.databasePath);
  try {
    const store = storeOf(db);
    const users = target === "--all" ? listUsers(db) : [findUserByLogin(db, target)].filter((user) => user !== null);
    if (users.length === 0) {
      say(`No EasyActions user named ${target}. They must sign in once first.`);
      return 1;
    }
    for (const user of users) {
      if (!findSecondFactor(db, user.id)) continue;
      resetSecondFactor(store, user.id, null);
      say(`Authenticator app removed for ${user.login}. They set up a new one at their next visit.`);
    }
    return 0;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  // Fichiers éventuellement créés ici (journaux SQLite) : lisibles par leur seul propriétaire.
  process.umask(0o077);
  const [command, ...args] = process.argv.slice(2);
  if (command === "promote") process.exit(setRole(args[0], "admin"));
  if (command === "demote") process.exit(setRole(args[0], "member"));
  if (command === "reset-two-factor") process.exit(resetTwoFactor(args[0]));
  say("Usage: bun run users:promote | users:demote | users:reset-two-factor <github-login>");
  process.exit(2);
}
