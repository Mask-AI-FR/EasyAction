/**
 * Actions de l'historique (table `audit_events`), au format `ressource.verbe` des services MaskAI.
 * Ce module en est le propriétaire unique : le serveur les écrit, l'interface les montre (export du
 * compte ; page d'historique des administrateurs ensuite).
 */
export const AUDIT_ACTIONS = [
  /** Connexion par GitHub : une session s'ouvre. */
  "session.create",
  /** Déconnexion de ce navigateur. */
  "session.end",
  /** « Sign out other sessions ». */
  "session.end_others",
  /** « Sign out everywhere ». */
  "session.end_all",
  /** Téléchargement de ses données. */
  "account.export",
  /** Effacement de ses données. */
  "account.delete",
  /** Application d'authentification mise en place (ou changée). */
  "two_factor.enroll",
  /** Code du jour accepté. */
  "two_factor.verify",
  /** Code faux. */
  "two_factor.fail",
  /** Trop de codes faux : codes bloqués pour un temps. */
  "two_factor.lock",
  /** Code de secours utilisé à la place du code du jour. */
  "two_factor.recovery_used",
  /** Nouveaux codes de secours (les anciens ne valent plus rien). */
  "two_factor.recovery_regenerated",
  /** Application d'authentification retirée (par un administrateur ou en ligne de commande). */
  "two_factor.reset",
  /** Plafonds modifiés sur la page Settings. */
  "settings.update",
  /** Connexion à GitHub modifiée sur la page Settings. */
  "settings.github_update",
  /** Réglages importés de `.env` (ligne de commande). */
  "settings.import",
  /** Rôle changé (administrateur ↔ membre). */
  "user.role_change",
  /** Un administrateur ferme toutes les sessions de quelqu'un. */
  "user.sign_out",
  /** Un administrateur efface quelqu'un. */
  "user.remove",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
