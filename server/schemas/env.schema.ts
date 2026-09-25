import { z } from "zod";

/**
 * Variables d'environnement requises au démarrage (CLAUDE.md §6.3). Cette liste est la source unique :
 * `.env.example` la reprend, et `parseEnv` s'en sert pour nommer tout ce qui manque d'un coup.
 * Depuis M7, la connexion à GitHub et les plafonds sont des réglages du site (en base) : `.env` ne les
 * donne plus qu'une fois, à `bun run settings:import-env` (server/schemas/settings.schema.ts).
 */
export const REQUIRED_VARIABLES = [
  "HOST",
  "PORT",
  "APP_ORIGIN",
  "SESSION_SECRET",
  "DATA_ENCRYPTION_KEY",
  "DATABASE_PATH",
  "HTTP_IDLE_TIMEOUT_SECONDS",
  "SESSION_MAX_DAYS",
  "SESSIONS_PER_USER_MAX",
  "AUDIT_RETENTION_DAYS",
  "TWO_FACTOR_EVERY_HOURS",
  "TWO_FACTOR_MAX_ATTEMPTS",
  "TWO_FACTOR_LOCK_MINUTES",
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
export function isSafeHttpUrl(value: string): boolean {
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
const integer = (min: number, max: number) =>
  present.transform((value) => Number(value)).pipe(z.number().int().min(min).max(max));

export const EnvSchema = z.object({
  HOST: present,
  PORT: integer(1, 65_535),
  APP_ORIGIN: present.refine(isBareOrigin).transform((value) => new URL(value).origin),
  // 32 caractères au moins : la clé de chiffrement du cookie de connexion en dérive (SHA-256).
  SESSION_SECRET: present.min(32),
  // 32 caractères au moins : la clé qui chiffre les jetons GitHub gardés en base en dérive (HKDF).
  DATA_ENCRYPTION_KEY: present.min(32),
  // Fichier SQLite de Pipliner, créé par `bun run db:migrate`.
  DATABASE_PATH: present,
  // Silence toléré sur une connexion HTTP avant que Bun ne la coupe (10 s sans réglage, 255 au plus) :
  // un lot de lancements attend GitHub bien plus de 10 s.
  HTTP_IDLE_TIMEOUT_SECONDS: integer(30, 255),
  // Durée de vie d'une session « rester connecté » ; le jeton de rafraîchissement GitHub vit 6 mois.
  SESSION_MAX_DAYS: integer(1, 180),
  // Sessions ouvertes au plus par personne : au-delà, les plus anciennes sont fermées.
  SESSIONS_PER_USER_MAX: integer(1, 10),
  // Conservation de l'historique (connexions, actions de sécurité), en jours.
  AUDIT_RETENTION_DAYS: integer(30, 3_650),
  // Heures pendant lesquelles un code à 6 chiffres accepté vaut pour la session (24 : une fois par jour).
  TWO_FACTOR_EVERY_HOURS: integer(1, 168),
  // Codes faux tolérés avant un blocage (chaque blocage suivant dure deux fois plus, 24 h au plus).
  TWO_FACTOR_MAX_ATTEMPTS: integer(3, 20),
  // Durée du premier blocage, en minutes.
  TWO_FACTOR_LOCK_MINUTES: integer(1, 1_440),
});
