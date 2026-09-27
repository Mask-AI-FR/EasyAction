import { REQUIRED_VARIABLES } from "../server/schemas/env.schema.ts";

/**
 * Garde d'assemblage : le lanceur du paquet (`packaging/deb/easyactions`) écrit un fichier de
 * configuration à la main, mais la liste des variables a UN SEUL propriétaire,
 * `server/schemas/env.schema.ts` (CLAUDE.md §6.1). Une 14e variable ajoutée là-bas sans être écrite
 * ici donnerait un paquet qui refuse de démarrer, au premier lancement, chez l'utilisateur.
 * ÉCHEC FERMÉ : on n'assemble pas un paquet dont la configuration est incomplète.
 *
 * Seul le bloc `<<ENVEOF … ENVEOF` est lu : le reste du script a ses propres variables de shell.
 */
const LAUNCHER = new URL("./deb/easyactions", import.meta.url);
const OPENING = /<<ENVEOF$/;
const CLOSING = /^ENVEOF$/;

function envBlockOf(script: string): string[] {
  const lines = script.split("\n");
  const start = lines.findIndex((line) => OPENING.test(line));
  const end = lines.findIndex((line, index) => index > start && CLOSING.test(line));
  if (start === -1 || end === -1) throw new Error("No <<ENVEOF … ENVEOF block in packaging/deb/easyactions");
  return lines.slice(start + 1, end);
}

const written = new Set(
  envBlockOf(await Bun.file(LAUNCHER).text())
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined),
);

const missing = REQUIRED_VARIABLES.filter((name) => !written.has(name));
const extra = [...written].filter((name) => !(REQUIRED_VARIABLES as readonly string[]).includes(name));

if (missing.length > 0 || extra.length > 0) {
  if (missing.length > 0) process.stderr.write(`Missing from packaging/deb/easyactions: ${missing.join(", ")}\n`);
  if (extra.length > 0) process.stderr.write(`Unknown variable(s) in packaging/deb/easyactions: ${extra.join(", ")}\n`);
  process.stderr.write("The list is owned by server/schemas/env.schema.ts. Update the launcher.\n");
  process.exit(1);
}

process.stdout.write(`Launcher writes all ${REQUIRED_VARIABLES.length} required variables.\n`);
