/**
 * Journal JSON d'une ligne par événement, sur stdout (stderr pour les erreurs).
 *
 * C'est une LISTE BLANCHE, pas un masquage : seuls les champs ci-dessous sortent, recopiés un par un.
 * Un objet plus large passé en variable (que TypeScript ne refuse que sur un littéral) perd donc ses
 * clés en trop à l'exécution. On ne journalise jamais un objet d'erreur, un corps, un en-tête, une URL
 * amont complète, un jeton ni une donnée personnelle (login GitHub compris) — contrat repris de
 * `~/.claude/AGENTS.md` §7. Les noms d'événements sont en anglais pointé, comme dans les services MaskAI.
 */
type Level = "info" | "warn" | "error";

export interface LogFields {
  /** Motif de route (`/api/orgs/:org/repos`), jamais l'URL concrète. */
  readonly route?: string;
  readonly method?: string;
  readonly status?: number;
  readonly durationMs?: number;
  readonly requestId?: string;
  readonly upstream?: "github";
  /** `err.name` uniquement. */
  readonly errName?: string;
  /** `err.code` uniquement. */
  readonly errCode?: string;
}

const ALLOWED_FIELDS = [
  "route",
  "method",
  "status",
  "durationMs",
  "requestId",
  "upstream",
  "errName",
  "errCode",
] as const satisfies readonly (keyof LogFields)[];

function pickAllowedFields(fields: LogFields): Record<string, string | number> {
  const picked: Record<string, string | number> = {};
  for (const name of ALLOWED_FIELDS) {
    const value = fields[name];
    if (value !== undefined) picked[name] = value;
  }
  return picked;
}

function emit(level: Level, event: string, fields: LogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "pipliner",
    event,
    ...pickAllowedFields(fields),
  });
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  info: (event: string, fields: LogFields = {}): void => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}): void => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}): void => emit("error", event, fields),
};

/** N'extrait que `name` et `code` d'une erreur ; ne renvoie jamais l'objet d'origine ni son message. */
export function errorFields(err: unknown): Pick<LogFields, "errName" | "errCode"> {
  if (typeof err !== "object" || err === null) return { errName: "UnknownError" };
  const { name, code } = err as { name?: unknown; code?: unknown };
  return {
    errName: typeof name === "string" ? name : "UnknownError",
    ...(typeof code === "string" ? { errCode: code } : {}),
  };
}
