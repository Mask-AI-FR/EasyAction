import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

/**
 * Règles du système de design MASKAI et du shadow DOM de TiniJS, vérifiées mécaniquement sur `app/`.
 * Chaque règle nomme sa raison ; un échec liste les fichiers fautifs.
 */
const ROOT = new URL("../../", import.meta.url).pathname;

/** Les règles portent sur le code : les commentaires qui les expliquent ne doivent pas les déclencher. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

async function appSources(): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  for await (const path of new Glob("app/**/*.ts").scan({ cwd: ROOT })) {
    sources.set(path, withoutComments(await Bun.file(`${ROOT}${path}`).text()));
  }
  return sources;
}

async function filesMatching(pattern: RegExp): Promise<string[]> {
  const offenders: string[] = [];
  for (const [path, source] of await appSources()) {
    if (pattern.test(source)) offenders.push(path);
  }
  return offenders;
}

const STOCK_COLORS =
  "white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_UTILITIES =
  "bg|text|border|ring|ring-offset|fill|stroke|from|to|via|outline|divide|placeholder|decoration|shadow|accent|caret";

describe("système de design MASKAI", () => {
  test("aucune couleur de la palette Tailwind standard : uniquement les jetons sémantiques", async () => {
    const stock = new RegExp(`\\b(?:${COLOR_UTILITIES})-(?:${STOCK_COLORS})\\b`);
    expect(await filesMatching(stock)).toEqual([]);
  });

  test("aucune utilité inexistante : rounded-control / rounded-card n'existent pas (rounded-md / rounded-lg)", async () => {
    expect(await filesMatching(/\brounded-(?:control|card)\b/)).toEqual([]);
  });

  test("aucune classe construite dynamiquement : Tailwind ne génère que les classes écrites en entier", async () => {
    expect(await filesMatching(/\b(?:bg|text|border|ring|fill|stroke)-\$\{/)).toEqual([]);
  });
});

describe("shadow DOM de TiniJS", () => {
  test("aucune variante dark: — elle ne voit pas html.dark depuis un shadow root ; les jetons portent le thème", async () => {
    expect(await filesMatching(/(?:^|[\s"'`])dark:[a-z[&!-]/m)).toEqual([]);
  });

  test("aucun rendu en light DOM : TiniComponent.firstUpdated lit this.shadowRoot sans garde", async () => {
    expect(await filesMatching(/\bcreateRenderRoot\b/)).toEqual([]);
  });

  test("aucun @Subscribe : sa liste de désabonnements est partagée par toutes les instances", async () => {
    expect(await filesMatching(/@Subscribe\(/)).toEqual([]);
  });

  test("aucun getQuery / @UseQuery : le routeur met en cache par chemin seul, la requête serait périmée", async () => {
    expect(await filesMatching(/\bgetQuery\s*\(|@UseQuery\s*\(/)).toEqual([]);
  });

  test("chaque composant TiniJS adopte la feuille partagée", async () => {
    const offenders: string[] = [];
    for (const [path, source] of await appSources()) {
      const decorated = source.match(/@(?:App|Layout|Page|Component)\(/g)?.length ?? 0;
      const styled = source.match(/static override styles = \[sharedSheet\b/g)?.length ?? 0;
      if (decorated !== styled) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});

describe("frontières", () => {
  test("app/ n'importe jamais server/ : le jeton GitHub et les secrets restent côté serveur", async () => {
    expect(await filesMatching(/(?:from\s+|import\(\s*)["'][^"']*\/server\//)).toEqual([]);
  });
});
