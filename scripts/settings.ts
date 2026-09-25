import { env } from "../server/config/env.ts";
import { issueSetupCode, SETUP_CODE_MINUTES } from "../server/auth/setupCode.ts";
import { openDatabase } from "../server/db/database.ts";
import { deriveDataKey, deriveSetupCodeKey } from "../server/security/dataCipher.ts";
import { clearGitHubConnection, isConfigured } from "../server/services/settings.ts";

/**
 * `bun run settings:setup-code` : un code d'installation, pour ouvrir la page /setup et y saisir la
 * connexion à GitHub (adresses, identifiant et secret de l'app) — rien de tout cela dans `.env`.
 * - Refuse tant qu'une connexion fonctionne : elle se change sur la page Settings.
 * - `--reset` l'efface d'abord (tout le monde est déconnecté) et remet le serveur en installation : la
 *   voie de secours après un mauvais identifiant enregistré, qui empêche tout le monde de se connecter.
 * Le code est le SEUL secret que cette commande affiche, une fois, dans le terminal de l'exploitant ;
 * il n'est ni journalisé ni stocké. Accès au serveur = racine de confiance (comme `users:promote`).
 */
const say = (line: string): void => void process.stdout.write(`${line}\n`);
const TIME = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

function setupCode(reset: boolean): number {
  const db = openDatabase(env.databasePath);
  try {
    if (isConfigured(db, deriveDataKey(env.dataEncryptionKey))) {
      if (!reset) {
        say("EasyActions is already set up: change the GitHub connection on the Settings page.");
        say("To clear it and set it up again (this signs everybody out), run: bun run settings:setup-code --reset");
        return 1;
      }
      const ended = clearGitHubConnection(db);
      say(`GitHub connection cleared. Signed out: ${ended} ${ended === 1 ? "session" : "sessions"}.`);
    }
    const { code, expiresAt } = issueSetupCode(deriveSetupCodeKey(env.dataEncryptionKey), Math.floor(Date.now() / 1000));
    say(`Setup code: ${code}`);
    say(`It works for ${SETUP_CODE_MINUTES} minutes (until ${TIME.format(new Date(expiresAt * 1000))} UTC).`);
    say(`Open ${env.appOrigin}/setup and type it there, with your GitHub App's client ID and secret.`);
    return 0;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  // Fichiers éventuellement créés ici (journaux SQLite) : lisibles par leur seul propriétaire.
  process.umask(0o077);
  const [command, ...args] = process.argv.slice(2);
  if (command === "setup-code") process.exit(setupCode(args.includes("--reset")));
  say("Usage: bun run settings:setup-code [--reset]");
  process.exit(2);
}
