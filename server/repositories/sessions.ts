import type { Database } from "bun:sqlite";

/**
 * Table `sessions` : une ligne par navigateur connecté. Le cookie n'y figure que haché (`idHash`) et
 * les jetons GitHub que chiffrés (`*Enc`) : la table seule ne permet ni de se faire passer pour
 * quelqu'un ni d'appeler GitHub. Instants en secondes depuis l'époque Unix (UTC).
 */
export interface SealedTokens {
  readonly accessTokenEnc: string;
  readonly accessExpiresAt: number;
  readonly refreshTokenEnc: string;
  readonly refreshExpiresAt: number;
}

export interface SessionRecord extends SealedTokens {
  readonly idHash: string;
  readonly userId: number;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
  /** +1 à chaque renouvellement des jetons (GitHub invalide alors les anciens). */
  readonly tokenGeneration: number;
  /** Dernier code à 6 chiffres accepté pour cette session, ou `null`. */
  readonly secondFactorAt: number | null;
}

/**
 * Sessions à fermer : une ; celles d'une personne (sauf éventuellement une) ; celles d'une personne
 * au-delà des `keepNewest` plus récentes ; les expirées ; ou toutes (connexion à GitHub changée).
 */
export type SessionSelection =
  | { readonly idHash: string }
  | { readonly userId: number; readonly keepNewest: number }
  | { readonly userId: number; readonly except?: string }
  | { readonly expiredAt: number }
  | { readonly all: true };

interface SessionRow {
  readonly id_hash: string;
  readonly user_id: number;
  readonly created_at: number;
  readonly last_seen_at: number;
  readonly expires_at: number;
  readonly token_generation: number;
  readonly access_token_enc: string;
  readonly access_expires_at: number;
  readonly refresh_token_enc: string;
  readonly refresh_expires_at: number;
  readonly second_factor_at: number | null;
}

export function insertSession(db: Database, session: SessionRecord): void {
  db.query(
    `INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, token_generation,
       access_token_enc, access_expires_at, refresh_token_enc, refresh_expires_at, second_factor_at)
     VALUES ($idHash, $userId, $createdAt, $lastSeenAt, $expiresAt, $tokenGeneration,
       $accessTokenEnc, $accessExpiresAt, $refreshTokenEnc, $refreshExpiresAt, $secondFactorAt)`,
  ).run({ ...session });
}

export function findSession(db: Database, idHash: string): SessionRecord | null {
  const row = db
    .query<SessionRow, { idHash: string }>("SELECT * FROM sessions WHERE id_hash = $idHash")
    .get({ idHash });
  return row ? toSession(row) : null;
}

/** Sessions d'une personne, de la plus récente à la plus ancienne. */
export function listSessionsOfUser(db: Database, userId: number): SessionRecord[] {
  return db
    .query<SessionRow, { userId: number }>(
      "SELECT * FROM sessions WHERE user_id = $userId ORDER BY created_at DESC, id_hash",
    )
    .all({ userId })
    .map(toSession);
}

export function markSessionSeen(db: Database, idHash: string, now: number): void {
  db.query("UPDATE sessions SET last_seen_at = $now WHERE id_hash = $idHash").run({ idHash, now });
}

/**
 * Enregistre des jetons renouvelés, SEULEMENT si la session existe encore à la génération lue avant
 * le renouvellement. Faux : elle a été fermée (ou renouvelée) entre-temps — l'appelant révoque alors
 * le jeton qu'il vient d'obtenir.
 */
export function saveRotatedTokens(
  db: Database,
  idHash: string,
  fromGeneration: number,
  tokens: SealedTokens,
): boolean {
  return (
    db
      .query(
        `UPDATE sessions SET token_generation = token_generation + 1,
           access_token_enc = $accessTokenEnc, access_expires_at = $accessExpiresAt,
           refresh_token_enc = $refreshTokenEnc, refresh_expires_at = $refreshExpiresAt
         WHERE id_hash = $idHash AND token_generation = $fromGeneration`,
      )
      .run({ ...tokens, idHash, fromGeneration }).changes === 1
  );
}

/** Ferme les sessions choisies et les rend (leurs jetons GitHub sont alors révoqués par l'appelant). */
export function deleteSessions(db: Database, selection: SessionSelection): SessionRecord[] {
  if ("idHash" in selection) {
    return db
      .query<SessionRow, { idHash: string }>("DELETE FROM sessions WHERE id_hash = $idHash RETURNING *")
      .all({ idHash: selection.idHash })
      .map(toSession);
  }
  if ("keepNewest" in selection) {
    return db
      .query<SessionRow, { userId: number; keep: number }>(
        `DELETE FROM sessions WHERE user_id = $userId AND id_hash NOT IN (
           SELECT id_hash FROM sessions WHERE user_id = $userId ORDER BY created_at DESC, id_hash LIMIT $keep
         ) RETURNING *`,
      )
      .all({ userId: selection.userId, keep: selection.keepNewest })
      .map(toSession);
  }
  if ("userId" in selection) {
    return db
      .query<SessionRow, { userId: number; except: string }>(
        "DELETE FROM sessions WHERE user_id = $userId AND id_hash <> $except RETURNING *",
      )
      .all({ userId: selection.userId, except: selection.except ?? "" })
      .map(toSession);
  }
  if ("expiredAt" in selection) {
    return db
      .query<SessionRow, { expiredAt: number }>("DELETE FROM sessions WHERE expires_at <= $expiredAt RETURNING *")
      .all({ expiredAt: selection.expiredAt })
      .map(toSession);
  }
  return db.query<SessionRow, []>("DELETE FROM sessions RETURNING *").all().map(toSession);
}

/**
 * Oublie le code du jour de toutes les sessions d'une personne : après le retrait de son application
 * d'authentification, chaque navigateur doit de nouveau prouver la possession du téléphone.
 */
export function clearSecondFactors(db: Database, userId: number): number {
  return db.query("UPDATE sessions SET second_factor_at = NULL WHERE user_id = $userId").run({ userId }).changes;
}

function toSession(row: SessionRow): SessionRecord {
  return {
    idHash: row.id_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    tokenGeneration: row.token_generation,
    accessTokenEnc: row.access_token_enc,
    accessExpiresAt: row.access_expires_at,
    refreshTokenEnc: row.refresh_token_enc,
    refreshExpiresAt: row.refresh_expires_at,
    secondFactorAt: row.second_factor_at,
  };
}
