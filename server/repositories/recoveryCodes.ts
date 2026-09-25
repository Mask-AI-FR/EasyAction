import type { Database } from "bun:sqlite";

/**
 * Table `recovery_codes` : codes de secours à usage unique, gardés seulement hachés (HMAC). L'usage
 * d'un code est CONDITIONNEL (`used_at IS NULL`) : il ne sert qu'une fois, même à deux requêtes
 * simultanées.
 */

/** Remplace tous les codes de la personne (les anciens ne valent plus rien). */
export function replaceRecoveryCodes(db: Database, userId: number, hashes: readonly string[]): void {
  db.query("DELETE FROM recovery_codes WHERE user_id = $userId").run({ userId });
  const insert = db.query("INSERT INTO recovery_codes (user_id, code_hash) VALUES ($userId, $hash)");
  for (const hash of hashes) insert.run({ userId, hash });
}

/** Utilise un code s'il existe et n'a jamais servi. */
export function useRecoveryCode(db: Database, userId: number, hash: string, now: number): boolean {
  return (
    db
      .query(
        `UPDATE recovery_codes SET used_at = $now
         WHERE user_id = $userId AND code_hash = $hash AND used_at IS NULL`,
      )
      .run({ userId, hash, now }).changes === 1
  );
}

export function countUnusedRecoveryCodes(db: Database, userId: number): number {
  return (
    db
      .query<{ n: number }, { userId: number }>(
        "SELECT count(*) AS n FROM recovery_codes WHERE user_id = $userId AND used_at IS NULL",
      )
      .get({ userId })?.n ?? 0
  );
}

export function deleteRecoveryCodes(db: Database, userId: number): number {
  return db.query("DELETE FROM recovery_codes WHERE user_id = $userId").run({ userId }).changes;
}
