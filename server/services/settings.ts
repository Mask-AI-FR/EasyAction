import type { Database } from "bun:sqlite";
import { isPairedApiUrl } from "../../domain/githubHosts.ts";
import { defaultLimits, GITHUB_SETTING_KEYS, LIMIT_SETTINGS, type LimitSettingKey, type LimitValues } from "../../domain/settingsCatalog.ts";
import type { SettingsBody } from "../../domain/settingsContract.ts";
import type { GitHubSettings, Limits } from "../config/env.ts";
import { recordAuditEvent } from "../repositories/auditEvents.ts";
import { deleteSessions } from "../repositories/sessions.ts";
import { deleteSettings, readAllSettings, writeSettings } from "../repositories/settings.ts";
import { DataCipherError, openValue, sealValue } from "../security/dataCipher.ts";

/**
 * Réglages du site (page Settings) : connexion à GitHub et plafonds, lus EN BASE À CHAQUE REQUÊTE
 * (une vingtaine de lignes, lecture synchrone). Pas de copie en mémoire : une commande d'exploitation
 * (autre processus) qui écrit la base serait sinon ignorée jusqu'au redémarrage.
 */
export interface EffectiveSettings {
  readonly github: GitHubSettings;
  readonly limits: Limits;
}

/** La connexion à GitHub (adresses, identifiant, secret) manque ou ne se lit pas. */
export class SettingsMissingError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`GitHub connection not configured: ${missing.join(", ")}`);
    this.name = "SettingsMissingError";
  }
}

/** La connexion à GitHub : les quatre ensemble (le secret en clair ici, chiffré en base). */
export interface GitHubConnection {
  readonly webUrl: string;
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

const SECRET_KEY = "githubClientSecret";
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * Réglages de l'identité de l'app (adresses, identifiant) qui changent. Les jetons des sessions ouvertes
 * viennent de l'app enregistrée : si l'un de ces réglages change, ils partiraient vers un autre hôte ou
 * une autre app — toutes les sessions doivent alors être fermées.
 */
function identityChanges(rows: ReturnType<typeof readAllSettings>, connection: GitHubConnection): string[] {
  const next = { githubWebUrl: connection.webUrl, githubApiUrl: connection.apiUrl, githubClientId: connection.clientId };
  return (Object.keys(next) as (keyof typeof next)[]).filter((key) => rows.get(key)?.value !== next[key]);
}

/** Plafonds : valeur en base si elle est un entier dans les bornes, sinon la valeur par défaut. */
function limitsOf(rows: ReturnType<typeof readAllSettings>): LimitValues {
  const values: Record<string, number> = { ...defaultLimits() };
  for (const setting of LIMIT_SETTINGS) {
    const stored = Number(rows.get(setting.key)?.value);
    if (Number.isInteger(stored) && stored >= setting.min && stored <= setting.max) values[setting.key] = stored;
  }
  return values as LimitValues;
}

/**
 * Réglages en vigueur. ÉCHEC FERMÉ : connexion à GitHub incomplète ou secret illisible (clé de
 * chiffrement changée) → `SettingsMissingError` ; au démarrage, le serveur refuse alors de démarrer.
 */
export function readSettings(db: Database, dataKey: Uint8Array): EffectiveSettings {
  const rows = readAllSettings(db);
  const value = (key: string) => rows.get(key)?.value ?? "";
  const missing = ["githubWebUrl", "githubApiUrl", "githubClientId", SECRET_KEY].filter((key) => !value(key));
  if (missing.length > 0) throw new SettingsMissingError(missing);
  let clientSecret: string;
  try {
    clientSecret = openValue(dataKey, "settings.github_client_secret", SECRET_KEY, value(SECRET_KEY));
  } catch (err) {
    if (!(err instanceof DataCipherError)) throw err;
    throw new SettingsMissingError([SECRET_KEY]);
  }
  const limits = limitsOf(rows);
  return {
    github: {
      webUrl: value("githubWebUrl"),
      apiUrl: value("githubApiUrl"),
      clientId: value("githubClientId"),
      clientSecret,
      timeoutMs: limits.githubTimeoutMs,
    },
    limits,
  };
}

/** Pour la page Settings : tout sauf le secret, dont seule la présence est dite. */
export function settingsBodyOf(db: Database): SettingsBody {
  const rows = readAllSettings(db);
  const connection = rows.get("githubWebUrl");
  return {
    github: {
      webUrl: connection?.value ?? "",
      apiUrl: rows.get("githubApiUrl")?.value ?? "",
      clientId: rows.get("githubClientId")?.value ?? "",
      clientSecretSet: rows.has(SECRET_KEY),
      updatedAt: connection?.updatedBy ? new Date(connection.updatedAt * 1000).toISOString() : null,
    },
    limits: limitsOf(rows),
  };
}

/** Plafonds modifiés (déjà vérifiés contre le catalogue), avec l'historique, en une transaction. */
export function updateLimits(db: Database, values: Partial<Record<LimitSettingKey, number>>, actorId: number): void {
  const entries = Object.entries(values).map(([key, value]) => [key, String(value)] as const);
  if (entries.length === 0) return;
  db.transaction(() => {
    writeSettings(db, entries, actorId, nowSeconds());
    recordAuditEvent(db, { action: "settings.update", actorId, targetId: null, keys: entries.map(([key]) => key) }, nowSeconds());
  })();
}

/** Les quatre réglages de la connexion, le secret chiffré (refus d'une paire d'adresses qui ne va pas). */
function connectionEntries(dataKey: Uint8Array, connection: GitHubConnection): (readonly [string, string])[] {
  if (!isPairedApiUrl(connection.webUrl, connection.apiUrl)) throw new Error("Unpaired GitHub addresses");
  const sealed = sealValue(dataKey, "settings.github_client_secret", SECRET_KEY, connection.clientSecret);
  return [["githubWebUrl", connection.webUrl], ["githubApiUrl", connection.apiUrl], ["githubClientId", connection.clientId], [SECRET_KEY, sealed]];
}

/**
 * Enregistre la connexion à GitHub depuis la page Settings (déjà validée : https, paire web/API, test de
 * connexion passé). Rend `changedIdentity` : l'adresse ou l'identifiant de l'app a changé — les jetons
 * délivrés par l'ancienne app ne valent plus rien ici, l'appelant ferme alors toutes les sessions.
 */
export function saveGitHubConnection(
  db: Database,
  dataKey: Uint8Array,
  connection: GitHubConnection,
  actorId: number,
): { readonly changedIdentity: boolean } {
  const entries = connectionEntries(dataKey, connection);
  const rows = readAllSettings(db);
  const changed = identityChanges(rows, connection);
  db.transaction(() => {
    writeSettings(db, entries, actorId, nowSeconds());
    recordAuditEvent(db, { action: "settings.github_update", actorId, targetId: null, keys: [...changed, SECRET_KEY] }, nowSeconds());
  })();
  return { changedIdentity: changed.length > 0 && rows.has("githubWebUrl") };
}

/**
 * Enregistre la connexion saisie sur la page d'installation, en une transaction : les quatre réglages,
 * l'historique (`settings.setup`, sans auteur : ouvert par un code du serveur), et la fermeture de toute
 * session restante. En installation, aucune ne peut servir, et ses jetons viendraient d'une autre app :
 * ils ne doivent jamais partir vers la nouvelle adresse.
 */
export function completeSetup(db: Database, dataKey: Uint8Array, connection: GitHubConnection): void {
  const entries = connectionEntries(dataKey, connection);
  db.transaction(() => {
    const now = nowSeconds();
    writeSettings(db, entries, null, now);
    recordAuditEvent(db, { action: "settings.setup", actorId: null, targetId: null, keys: entries.map(([key]) => key) }, now);
    const ended = deleteSessions(db, { all: true });
    if (ended.length > 0) recordAuditEvent(db, { action: "session.end_all", actorId: null, targetId: null }, now);
  })();
}

/**
 * Vrai si une connexion à GitHub est enregistrée ET lisible. Sinon, le serveur est en mode installation
 * (`server/middleware/setupGate.ts`) : première installation, connexion effacée, ou secret illisible
 * après un changement de DATA_ENCRYPTION_KEY.
 */
export function isConfigured(db: Database, dataKey: Uint8Array): boolean {
  try {
    readSettings(db, dataKey);
    return true;
  } catch (err) {
    if (!(err instanceof SettingsMissingError)) throw err;
    return false;
  }
}

/**
 * Efface la connexion à GitHub (`bun run settings:setup-code --reset`) : le serveur repasse en mode
 * installation. Toutes les sessions sont fermées dans la même transaction — leurs jetons viennent de
 * l'app effacée — sans révocation (hors ligne, et la connexion effacée est peut-être la cassée) : nos
 * seules copies sont effacées, et les jetons d'accès expirent dans les 8 heures. Rend le nombre de
 * sessions fermées.
 */
export function clearGitHubConnection(db: Database): number {
  return db.transaction(() => {
    const now = nowSeconds();
    deleteSettings(db, GITHUB_SETTING_KEYS);
    recordAuditEvent(db, { action: "settings.reset", actorId: null, targetId: null, keys: [...GITHUB_SETTING_KEYS] }, now);
    const ended = deleteSessions(db, { all: true });
    if (ended.length > 0) recordAuditEvent(db, { action: "session.end_all", actorId: null, targetId: null }, now);
    return ended.length;
  })();
}
