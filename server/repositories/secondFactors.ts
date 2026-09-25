import type { Database } from "bun:sqlite";

/**
 * Table `second_factors` : l'application d'authentification de chaque personne. Les secrets n'y sont
 * que chiffrés. Les mises à jour qui décident d'un accès sont CONDITIONNELLES (`changes === 1`) : deux
 * requêtes simultanées ne peuvent pas accepter le même code, ni confirmer deux fois une mise en place.
 */
export interface SecondFactorRecord {
  readonly userId: number;
  /** Secret confirmé (chiffré), ou `null` tant que rien n'est confirmé. */
  readonly secretEnc: string | null;
  readonly confirmedAt: number | null;
  /** Secret d'une mise en place ou d'un changement en cours (chiffré). */
  readonly pendingSecretEnc: string | null;
  /** Dernier pas de 30 s accepté : un code ne sert qu'une fois. */
  readonly lastStep: number;
  readonly failedAttempts: number;
  readonly lockLevel: number;
  readonly lockedUntil: number | null;
}

interface SecondFactorRow {
  readonly user_id: number;
  readonly secret_enc: string | null;
  readonly confirmed_at: number | null;
  readonly pending_secret_enc: string | null;
  readonly last_step: number;
  readonly failed_attempts: number;
  readonly lock_level: number;
  readonly locked_until: number | null;
}

export function findSecondFactor(db: Database, userId: number): SecondFactorRecord | null {
  const row = db
    .query<SecondFactorRow, { userId: number }>("SELECT * FROM second_factors WHERE user_id = $userId")
    .get({ userId });
  return row
    ? {
        userId: row.user_id,
        secretEnc: row.secret_enc,
        confirmedAt: row.confirmed_at,
        pendingSecretEnc: row.pending_secret_enc,
        lastStep: row.last_step,
        failedAttempts: row.failed_attempts,
        lockLevel: row.lock_level,
        lockedUntil: row.locked_until,
      }
    : null;
}

/** Nouveau secret en attente ; le secret confirmé, s'il existe, reste valable jusqu'à la confirmation. */
export function savePendingSecret(db: Database, userId: number, pendingSecretEnc: string): void {
  db.query(
    `INSERT INTO second_factors (user_id, pending_secret_enc) VALUES ($userId, $pending)
     ON CONFLICT (user_id) DO UPDATE SET pending_secret_enc = excluded.pending_secret_enc`,
  ).run({ userId, pending: pendingSecretEnc });
}

/** Le secret en attente devient LE secret, s'il n'a pas changé entre-temps. */
export function confirmPendingSecret(
  db: Database,
  change: { readonly userId: number; readonly pendingSecretEnc: string; readonly secretEnc: string; readonly step: number },
  now: number,
): boolean {
  return (
    db
      .query(
        `UPDATE second_factors SET secret_enc = $secretEnc, confirmed_at = $now, pending_secret_enc = NULL,
           last_step = $step, failed_attempts = 0, lock_level = 0, locked_until = NULL
         WHERE user_id = $userId AND pending_secret_enc = $pendingSecretEnc`,
      )
      .run({ ...change, now }).changes === 1
  );
}

/** Code accepté pour le pas `step`, seulement s'il est plus récent que le dernier accepté. */
export function recordCodeSuccess(db: Database, userId: number, step: number): boolean {
  return (
    db
      .query(
        `UPDATE second_factors SET last_step = $step, failed_attempts = 0, lock_level = 0, locked_until = NULL
         WHERE user_id = $userId AND last_step < $step`,
      )
      .run({ userId, step }).changes === 1
  );
}

/** Compteurs après un code faux (calculés par l'appelant), écrits d'un bloc. */
export function saveFailureCounters(
  db: Database,
  userId: number,
  counters: Pick<SecondFactorRecord, "failedAttempts" | "lockLevel" | "lockedUntil">,
): void {
  db.query(
    `UPDATE second_factors SET failed_attempts = $failedAttempts, lock_level = $lockLevel,
       locked_until = $lockedUntil WHERE user_id = $userId`,
  ).run({ userId, ...counters });
}

export function deleteSecondFactor(db: Database, userId: number): boolean {
  return db.query("DELETE FROM second_factors WHERE user_id = $userId").run({ userId }).changes === 1;
}
