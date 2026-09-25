import type { Database } from "bun:sqlite";
import type { AccountRole } from "../../domain/accountContract.ts";

/**
 * Table `users` : les personnes qui se sont connectées. `id` est l'identifiant numérique GitHub
 * (stable, contrairement au login). Données personnelles : login et avatar — effacés avec la ligne.
 */
export interface UserRecord {
  readonly id: number;
  readonly login: string;
  readonly avatarUrl: string;
  readonly role: AccountRole;
  /** Instants en secondes depuis l'époque Unix (UTC). */
  readonly createdAt: number;
  readonly lastSignInAt: number;
}

interface UserRow {
  readonly id: number;
  readonly login: string;
  readonly avatar_url: string;
  readonly role: string;
  readonly created_at: number;
  readonly last_sign_in_at: number;
}

/** La personne qui vient de se connecter : créée, ou son login et son avatar mis à jour. */
export function upsertSignedInUser(
  db: Database,
  user: Pick<UserRecord, "id" | "login" | "avatarUrl">,
  now: number,
): void {
  db.query(
    `INSERT INTO users (id, login, avatar_url, created_at, last_sign_in_at)
     VALUES ($id, $login, $avatarUrl, $now, $now)
     ON CONFLICT (id) DO UPDATE SET
       login = excluded.login, avatar_url = excluded.avatar_url, last_sign_in_at = excluded.last_sign_in_at`,
  ).run({ id: user.id, login: user.login, avatarUrl: user.avatarUrl, now });
}

export function findUser(db: Database, id: number): UserRecord | null {
  const row = db.query<UserRow, { id: number }>("SELECT * FROM users WHERE id = $id").get({ id });
  return row ? toUser(row) : null;
}

/** La personne dont le login GitHub est `login` (les logins GitHub ne distinguent pas la casse). */
export function findUserByLogin(db: Database, login: string): UserRecord | null {
  const row = db
    .query<UserRow, { login: string }>("SELECT * FROM users WHERE lower(login) = lower($login)")
    .get({ login });
  return row ? toUser(row) : null;
}

/** Toutes les personnes, par login. */
export function listUsers(db: Database): UserRecord[] {
  return db.query<UserRow, []>("SELECT * FROM users ORDER BY lower(login)").all().map(toUser);
}

export function setUserRole(db: Database, id: number, role: AccountRole): boolean {
  return db.query("UPDATE users SET role = $role WHERE id = $id").run({ id, role }).changes === 1;
}

/** Administrateurs : il en reste toujours au moins un (vérifié avant de retirer un rôle ou d'effacer). */
export function countAdmins(db: Database): number {
  return db.query<{ n: number }, []>("SELECT count(*) AS n FROM users WHERE role = 'admin'").get()?.n ?? 0;
}

/** Efface la personne ; ses sessions suivent (CASCADE), son historique devient anonyme (SET NULL). */
export function deleteUser(db: Database, id: number): boolean {
  return db.query("DELETE FROM users WHERE id = $id").run({ id }).changes === 1;
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    login: row.login,
    avatarUrl: row.avatar_url,
    // La contrainte CHECK de la table n'admet que ces deux valeurs.
    role: row.role === "admin" ? "admin" : "member",
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
  };
}
