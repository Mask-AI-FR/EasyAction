import type { z } from "zod";
import {
  EnvSchema,
  PLACEHOLDER,
  REQUIRED_VARIABLES,
  type EnvSource,
} from "../schemas/env.schema.ts";

/**
 * Configuration du serveur, lue une seule fois au chargement de ce module.
 *
 * ÉCHEC FERMÉ AU DÉMARRAGE (CLAUDE.md §6.3) : une variable requise absente, laissée à `<TO_PROVIDE>`
 * ou invalide arrête le processus avec la liste complète des noms en cause, plutôt qu'un défaut
 * littéral pointant vers une vraie machine. Les messages nomment les variables, jamais leurs valeurs
 * (qui peuvent être des secrets). Ce module doit être le PREMIER import des points d'entrée.
 */
/**
 * Connexion à GitHub et plafonds : depuis M7, des réglages du site lus en base à chaque requête
 * (`services/settings.ts`), plus des variables d'environnement. Leurs types restent ici, au plus bas
 * des couches, pour que les adaptateurs n'aient pas à dépendre des services.
 */
export interface GitHubSettings {
  /** https://github.com, ou l'adresse d'un GitHub Enterprise Server ; sans barre finale. */
  readonly webUrl: string;
  /** https://api.github.com, ou https://<ghes>/api/v3 ; sans barre finale. */
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly timeoutMs: number;
}

/** Plafonds et rythmes (CLAUDE.md §6.3 : aucune limite codée en dur). */
export interface Limits {
  /** Dépôts lus au plus par organisation. */
  readonly reposMax: number;
  /** Branches lues au plus par dépôt. */
  readonly branchesMax: number;
  /** Âge (jours) du dernier commit au-delà duquel une branche est ancienne. */
  readonly activeBranchDays: number;
  /** Pipelines lancés au plus par demande. */
  readonly dispatchMaxTargets: number;
  /** Lancements envoyés en parallèle à GitHub. */
  readonly dispatchConcurrency: number;
  /** Intervalle minimum (secondes) du suivi en direct. */
  readonly runPollMinSeconds: number;
  /** Durée maximale (minutes) du suivi en direct. */
  readonly runTrackMaxMinutes: number;
  /** Tableau de bord : dépôts lus au plus (les plus récemment poussés d'abord). */
  readonly statsMaxRepos: number;
  /** Tableau de bord : exécutions lues au plus par dépôt et par période (GitHub : 1 000 au plus). */
  readonly statsMaxRunsPerRepo: number;
  /** Tableau de bord : commits lus au plus par dépôt, toutes branches, deux périodes. */
  readonly statsMaxCommitsPerRepo: number;
  /** Tableau de bord : secondes pendant lesquelles un résultat est resservi (0 : jamais). */
  readonly statsCacheSeconds: number;
  /** Tableau de bord : secondes accordées à la lecture de GitHub (bornées par l'inactivité HTTP). */
  readonly statsDeadlineSeconds: number;
}

/** Sessions « rester connecté », gardées en base (CLAUDE.md §6.3 : aucune limite codée en dur). */
export interface SessionPolicy {
  /** Durée de vie maximale d'une session, en jours. */
  readonly maxDays: number;
  /** Sessions ouvertes au plus par personne. */
  readonly perUserMax: number;
}

/** Code à 6 chiffres d'une application d'authentification (CLAUDE.md §6.3 : aucune limite codée en dur). */
export interface TwoFactorPolicy {
  /** Heures pendant lesquelles un code accepté vaut pour la session. */
  readonly everyHours: number;
  /** Codes faux tolérés avant un blocage. */
  readonly maxAttempts: number;
  /** Durée du premier blocage, en minutes (doublée à chaque blocage suivant, 24 h au plus). */
  readonly lockMinutes: number;
}

export interface PiplinerEnv {
  readonly host: string;
  readonly port: number;
  /** Origine publique exacte de l'application (redirection OAuth, contrôle `Origin`). */
  readonly appOrigin: string;
  /** Chiffre le cookie du flux de connexion (10 minutes). */
  readonly sessionSecret: string;
  /** Secret dont dérive la clé qui chiffre les jetons GitHub gardés en base. */
  readonly dataEncryptionKey: string;
  readonly databasePath: string;
  /** Silence toléré (secondes) sur une connexion HTTP avant que Bun ne la coupe. */
  readonly httpIdleTimeoutSeconds: number;
  readonly sessions: SessionPolicy;
  /** Conservation de l'historique, en jours. */
  readonly auditRetentionDays: number;
  readonly twoFactor: TwoFactorPolicy;
}

export function parseEnv(source: EnvSource): PiplinerEnv {
  const missing = REQUIRED_VARIABLES.filter((name) => {
    const value = (source[name] ?? "").trim();
    return value === "" || value === PLACEHOLDER;
  });
  if (missing.length > 0) {
    throw new Error(
      "Pipliner refuse de démarrer, variable(s) d'environnement manquante(s) : " +
        `${missing.join(", ")}. Ajoutez-les à votre .env (rôle et valeur d'exemple de chacune ` +
        "dans .env.example) ; sans .env encore : copiez .env.example vers .env. Bun lit .env au démarrage.",
    );
  }
  const checked = EnvSchema.safeParse(source);
  if (!checked.success) {
    const invalid = [
      ...new Set(checked.error.issues.map((issue) => String(issue.path[0]))),
    ];
    throw new Error(
      "Pipliner refuse de démarrer, variable(s) d'environnement invalide(s) : " +
        `${invalid.join(", ")}. Le format attendu est décrit dans .env.example.`,
    );
  }
  return toPiplinerEnv(checked.data);
}

/** Variables validées → configuration typée. */
function toPiplinerEnv(data: z.infer<typeof EnvSchema>): PiplinerEnv {
  return {
    host: data.HOST,
    port: data.PORT,
    appOrigin: data.APP_ORIGIN,
    sessionSecret: data.SESSION_SECRET,
    dataEncryptionKey: data.DATA_ENCRYPTION_KEY,
    databasePath: data.DATABASE_PATH,
    httpIdleTimeoutSeconds: data.HTTP_IDLE_TIMEOUT_SECONDS,
    sessions: { maxDays: data.SESSION_MAX_DAYS, perUserMax: data.SESSIONS_PER_USER_MAX },
    auditRetentionDays: data.AUDIT_RETENTION_DAYS,
    twoFactor: {
      everyHours: data.TWO_FACTOR_EVERY_HOURS,
      maxAttempts: data.TWO_FACTOR_MAX_ATTEMPTS,
      lockMinutes: data.TWO_FACTOR_LOCK_MINUTES,
    },
  };
}

export const env: PiplinerEnv = parseEnv(process.env);
