import { z } from "zod";

/**
 * Variables d'environnement requises au démarrage (CLAUDE.md §6.3). Cette liste est la source unique :
 * `.env.example` la reprend, et `parseEnv` s'en sert pour nommer tout ce qui manque d'un coup.
 */
export const REQUIRED_VARIABLES = [
  "HOST",
  "PORT",
  "APP_ORIGIN",
  "SESSION_SECRET",
  "GITHUB_WEB_URL",
  "GITHUB_API_URL",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_TIMEOUT_MS",
  "REPOS_MAX",
  "BRANCHES_MAX",
  "ACTIVE_BRANCH_DAYS",
  "DISPATCH_MAX_TARGETS",
  "DISPATCH_CONCURRENCY",
  "RUN_POLL_MIN_SECONDS",
  "RUN_TRACK_MAX_MINUTES",
] as const;

export type RequiredVariable = (typeof REQUIRED_VARIABLES)[number];

/** Environnement brut, tel que `process.env` le fournit. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Valeur de `.env.example` à remplacer : la laisser telle quelle équivaut à une variable absente. */
export const PLACEHOLDER = "<TO_PROVIDE>";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * `https:` partout ; `http:` seulement vers la boucle locale (développement, faux GitHub des tests).
 * Un cookie de session ou un jeton ne doit jamais circuler en clair sur le réseau.
 */
function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
    );
  } catch {
    return false;
  }
}

function isBareOrigin(value: string): boolean {
  return isSafeHttpUrl(value) && new URL(value).origin === value.replace(/\/$/, "");
}

const present = z.string().trim().min(1);
const safeUrl = present.refine(isSafeHttpUrl).transform((value) => value.replace(/\/+$/, ""));
const integer = (min: number, max: number) =>
  present.transform((value) => Number(value)).pipe(z.number().int().min(min).max(max));

export const EnvSchema = z.object({
  HOST: present,
  PORT: integer(1, 65_535),
  APP_ORIGIN: present.refine(isBareOrigin).transform((value) => new URL(value).origin),
  // 32 caractères au moins : la clé de chiffrement des cookies en dérive (SHA-256).
  SESSION_SECRET: present.min(32),
  GITHUB_WEB_URL: safeUrl,
  GITHUB_API_URL: safeUrl,
  GITHUB_APP_CLIENT_ID: present,
  GITHUB_APP_CLIENT_SECRET: present,
  GITHUB_TIMEOUT_MS: integer(1_000, 60_000),
  // Plafond de dépôts lus par organisation (pages de 100) : borne le coût d'un affichage.
  REPOS_MAX: integer(1, 10_000),
  // Plafond de branches lues par dépôt (pages de 100 en GraphQL).
  BRANCHES_MAX: integer(1, 1_000),
  // Au-delà de cet âge du dernier commit, une branche est « ancienne » (repliée dans la liste).
  ACTIVE_BRANCH_DAYS: integer(1, 3_650),
  // Pipelines lancés au plus par demande : chaque lancement peut être un déploiement.
  DISPATCH_MAX_TARGETS: integer(1, 200),
  // Lancements envoyés en parallèle à GitHub (limite secondaire : 80 créations par minute).
  DISPATCH_CONCURRENCY: integer(1, 10),
  // Intervalle minimum entre deux relevés du suivi en direct.
  RUN_POLL_MIN_SECONDS: integer(2, 300),
  // Durée maximale du suivi en direct d'un lancement.
  RUN_TRACK_MAX_MINUTES: integer(1, 720),
});
