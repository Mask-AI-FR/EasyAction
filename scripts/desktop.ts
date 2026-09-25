import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { env } from "../server/config/env.ts";
import { schemaStateOf } from "../server/db/database.ts";
import { buildWebApp } from "./buildApp.ts";

/**
 * `bun run desktop` : EasyActions dans sa propre fenêtre, comme une application de bureau.
 *
 * 1. Si EasyActions répond déjà sur `APP_ORIGIN` (par exemple sous `bun run dev`), on s'en sert.
 * 2. Sinon : build de production, puis `bun server/index.ts` détaché du terminal (journal :
 *    `desktop-server.log`, ignoré par git), et l'on attend que `/health` réponde.
 * 3. Un navigateur Chromium ouvre `/orgs` en mode application (`--app=`) : une fenêtre sans onglets
 *    ni barre d'adresse. Sans navigateur Chromium, l'adresse est seulement affichée (Firefox ne sait
 *    pas ouvrir une application web sous Linux, septembre 2026).
 */
export const CHROMIUM_BROWSERS = [
  "brave",
  "brave-browser",
  "chromium",
  "chromium-browser",
  "google-chrome-stable",
  "google-chrome",
  "microsoft-edge-stable",
  "vivaldi-stable",
] as const;

/** Temps laissé au serveur pour démarrer ; au-delà, ÉCHEC FERMÉ : pas de fenêtre sur un serveur absent. */
const START_TIMEOUT_MS = 20_000;
const SERVER_LOG = "desktop-server.log";

const say = (line: string): void => void process.stdout.write(`${line}\n`);

/** Premier navigateur Chromium installé, dans l'ordre de `CHROMIUM_BROWSERS`. */
export function pickBrowser(which: (name: string) => string | null): string | null {
  for (const name of CHROMIUM_BROWSERS) {
    const path = which(name);
    if (path) return path;
  }
  return null;
}

/**
 * Vrai si c'est bien EasyActions qui répond sur `origin` (et pas un autre service sur ce port).
 * ÉCHEC OUVERT (sonde) : personne ne répond → faux, et l'appelant démarre le serveur. Bun signale une
 * connexion refusée par une `Error` à `code` texte (pas un `TypeError` comme les navigateurs).
 */
export async function isEasyActionsUp(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1_000) });
    const body = (await response.json().catch(() => null)) as { service?: unknown } | null;
    return response.ok && body?.service === "pipliner";
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    const unreachable = err instanceof Error && typeof (err as { code?: unknown }).code === "string";
    if (timedOut || unreachable || err instanceof TypeError) return false;
    throw err;
  }
}

/** `bun server/index.ts`, détaché : le serveur survit au terminal. Rend son PID pour pouvoir l'arrêter. */
function startServer(): number | undefined {
  const log = openSync(SERVER_LOG, "a");
  const child = spawn(process.execPath, ["server/index.ts"], { detached: true, stdio: ["ignore", log, log] });
  child.unref();
  return child.pid;
}

async function waitUntilUp(origin: string): Promise<boolean> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isEasyActionsUp(origin)) return true;
    await Bun.sleep(300);
  }
  return false;
}

/** Build + démarrage quand rien ne répond encore ; faux si le serveur n'a pas démarré. */
async function ensureServer(origin: string): Promise<boolean> {
  if (await isEasyActionsUp(origin)) return true;
  // Le serveur refuserait de démarrer (base absente ou pas à jour) : on le dit tout de suite, au lieu
  // d'attendre 20 s une fenêtre qui ne viendra pas.
  if (schemaStateOf(env.databasePath) !== "ready") {
    say("The EasyActions database is missing or out of date. Run: bun run db:migrate");
    return false;
  }
  say("Building EasyActions…");
  const build = await buildWebApp("./dist/app");
  if (!build.success) {
    for (const log of build.logs) say(log.message);
    return false;
  }
  const pid = startServer();
  say(`Starting the server on ${origin} (log: ${SERVER_LOG})…`);
  if (!(await waitUntilUp(origin))) {
    say(`EasyActions did not start within ${START_TIMEOUT_MS / 1000} s. See ${SERVER_LOG}.`);
    return false;
  }
  say(`Server running in the background (PID ${pid}). Stop it with: kill ${pid}`);
  return true;
}

async function main(): Promise<number> {
  const origin = env.appOrigin;
  if (!(await ensureServer(origin))) return 1;
  const url = `${origin}/orgs`;
  const browser = pickBrowser((name) => Bun.which(name));
  if (!browser) {
    say(`No Chromium browser found. Open ${url} in Brave, Chrome or Edge.`);
    return 0;
  }
  spawn(browser, [`--app=${url}`], { detached: true, stdio: "ignore" }).unref();
  say(`EasyActions opened in its own window (${url}).`);
  return 0;
}

if (import.meta.main) process.exit(await main());
