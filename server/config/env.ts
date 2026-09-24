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
}

export interface PiplinerEnv {
  readonly host: string;
  readonly port: number;
  /** Origine publique exacte de l'application (redirection OAuth, contrôle `Origin`). */
  readonly appOrigin: string;
  readonly sessionSecret: string;
  readonly github: GitHubSettings;
  readonly limits: Limits;
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
  const data = checked.data;
  return {
    host: data.HOST,
    port: data.PORT,
    appOrigin: data.APP_ORIGIN,
    sessionSecret: data.SESSION_SECRET,
    github: {
      webUrl: data.GITHUB_WEB_URL,
      apiUrl: data.GITHUB_API_URL,
      clientId: data.GITHUB_APP_CLIENT_ID,
      clientSecret: data.GITHUB_APP_CLIENT_SECRET,
      timeoutMs: data.GITHUB_TIMEOUT_MS,
    },
    limits: {
      reposMax: data.REPOS_MAX,
      branchesMax: data.BRANCHES_MAX,
      activeBranchDays: data.ACTIVE_BRANCH_DAYS,
      dispatchMaxTargets: data.DISPATCH_MAX_TARGETS,
      dispatchConcurrency: data.DISPATCH_CONCURRENCY,
      runPollMinSeconds: data.RUN_POLL_MIN_SECONDS,
      runTrackMaxMinutes: data.RUN_TRACK_MAX_MINUTES,
    },
  };
}

export const env: PiplinerEnv = parseEnv(process.env);
