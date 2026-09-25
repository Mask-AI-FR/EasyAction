import type { Database } from "bun:sqlite";
import { AUDIT_ACTIONS, type AuditAction } from "../../domain/auditActions.ts";

/**
 * Table `audit_events` : l'historique des connexions et des actions de sécurité. On y écrit dans la
 * MÊME transaction que l'action : si l'historique ne s'écrit pas, l'action est annulée (échec fermé).
 * Aucune donnée personnelle hors des deux identifiants, que l'effacement d'une personne remet à NULL ;
 * `detail` ne garde que des NOMS de réglages (`{"keys": [...]}`), jamais une valeur.
 */
export interface AuditEventRecord {
  readonly id: number;
  /** Secondes depuis l'époque Unix (UTC). */
  readonly at: number;
  readonly action: AuditAction;
  readonly actorId: number | null;
  readonly targetId: number | null;
}

interface AuditEventRow {
  readonly id: number;
  readonly at: number;
  readonly action: string;
  readonly actor_id: number | null;
  readonly target_id: number | null;
}

export function recordAuditEvent(
  db: Database,
  event: Pick<AuditEventRecord, "action" | "actorId" | "targetId"> & { readonly keys?: readonly string[] },
  now: number,
): void {
  db.query(
    `INSERT INTO audit_events (at, action, actor_id, target_id, detail)
     VALUES ($now, $action, $actorId, $targetId, $detail)`,
  ).run({
    now,
    action: event.action,
    actorId: event.actorId,
    targetId: event.targetId,
    detail: event.keys ? JSON.stringify({ keys: event.keys }) : null,
  });
}

/** Une entrée de l'historique pour la page des administrateurs : logins à la place des identifiants. */
export interface HistoryRecord {
  readonly id: number;
  readonly at: number;
  readonly action: AuditAction;
  readonly actorLogin: string | null;
  readonly targetLogin: string | null;
  readonly keys: readonly string[] | null;
}

/** Historique du plus récent au plus ancien, `limit` entrées avant l'identifiant `before`, filtré par action. */
export function listHistory(
  db: Database,
  query: { readonly before: number | null; readonly action: AuditAction | null; readonly limit: number },
): HistoryRecord[] {
  const rows = db
    .query<
      { id: number; at: number; action: string; actor: string | null; target: string | null; detail: string | null },
      { before: number; action: string | null; limit: number }
    >(
      `SELECT e.id, e.at, e.action, a.login AS actor, t.login AS target, e.detail FROM audit_events e
       LEFT JOIN users a ON a.id = e.actor_id LEFT JOIN users t ON t.id = e.target_id
       WHERE e.id < $before AND ($action IS NULL OR e.action = $action)
       ORDER BY e.id DESC LIMIT $limit`,
    )
    .all({ before: query.before ?? Number.MAX_SAFE_INTEGER, action: query.action, limit: query.limit });
  return rows.flatMap((row) => {
    const action = AUDIT_ACTIONS.find((known) => known === row.action);
    if (!action) return [];
    const keys = row.detail ? (JSON.parse(row.detail) as { keys?: string[] }).keys ?? null : null;
    return [{ id: row.id, at: row.at, action, actorLogin: row.actor, targetLogin: row.target, keys }];
  });
}

/** Historique où la personne est l'auteur ou la cible, du plus récent au plus ancien (export). */
export function listAuditEventsAbout(db: Database, userId: number): AuditEventRecord[] {
  return db
    .query<AuditEventRow, { userId: number }>(
      `SELECT id, at, action, actor_id, target_id FROM audit_events
       WHERE actor_id = $userId OR target_id = $userId ORDER BY at DESC, id DESC`,
    )
    .all({ userId })
    .flatMap((row) => {
      // Une action inconnue de ce code (base plus récente) est omise plutôt que mal nommée.
      const action = AUDIT_ACTIONS.find((known) => known === row.action);
      return action ? [{ id: row.id, at: row.at, action, actorId: row.actor_id, targetId: row.target_id }] : [];
    });
}

/** Efface l'historique plus ancien que `cutoff` (durée de conservation `AUDIT_RETENTION_DAYS`). */
export function deleteAuditEventsBefore(db: Database, cutoff: number): number {
  return db.query("DELETE FROM audit_events WHERE at < $cutoff").run({ cutoff }).changes;
}
