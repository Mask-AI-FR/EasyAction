import { describe, expect, test } from "bun:test";

/**
 * L'écran de démarrage (app/index.html) dessine le logo avant que le code ne soit chargé : c'est une
 * seconde copie du grand dessin de app/ui/brand-mark.ts. Ces tests empêchent les deux copies de
 * diverger et gardent la page compatible avec la CSP (`default-src 'self'` : aucun style en ligne).
 */
const ROOT = new URL("../../", import.meta.url).pathname;

function source(path: string): Promise<string> {
  return Bun.file(`${ROOT}${path}`).text();
}

interface Drawing {
  readonly gear: string | undefined;
  readonly coreR: string | undefined;
  readonly glyph: string | undefined;
}

/** Le grand dessin (`STANDARD`) tel qu'écrit dans app/ui/brand-mark.ts. */
function logoDrawing(module: string): Drawing {
  const block = /const STANDARD: Drawing = \{([\s\S]*?)\};/.exec(module)?.[1] ?? "";
  return {
    gear: /gear: "([^"]+)"/.exec(block)?.[1],
    coreR: /coreR: (\d+)/.exec(block)?.[1],
    glyph: /glyph: "([^"]+)"/.exec(block)?.[1],
  };
}

/** Le dessin de l'écran de démarrage, lu dans `#boot-screen` seulement. */
function bootDrawing(page: string): Drawing {
  const screen = /<div id="boot-screen"[\s\S]*?<\/svg>/.exec(page)?.[0] ?? "";
  return {
    gear: /class="boot-gear"\s+d="([^"]+)"/.exec(screen)?.[1],
    coreR: /<circle cx="256" cy="256" r="(\d+)"/.exec(screen)?.[1],
    glyph: /<path d="([^"]+)" fill="none"/.exec(screen)?.[1],
  };
}

describe("écran de démarrage", () => {
  test("présent avant le code de l'application, et annoncé aux lecteurs d'écran", async () => {
    const page = await source("app/index.html");
    expect(page).toMatch(/<div id="boot-screen" class="boot-screen" role="status">/);
    expect(page).toContain("Loading EasyActions");
    expect(page.indexOf('id="boot-screen"')).toBeLessThan(page.indexOf("<app-root>"));
  });

  test("le même engrenage, le même cœur et la même flèche que le logo de l'application", async () => {
    const logo = logoDrawing(await source("app/ui/brand-mark.ts"));
    expect(Object.values(logo).every((part) => part !== undefined)).toBe(true);
    expect(bootDrawing(await source("app/index.html"))).toEqual(logo);
  });

  test("compatible avec la CSP : styles dans un fichier, ni bloc <style> ni attribut style", async () => {
    const page = await source("app/index.html");
    expect(page).toContain('<link rel="stylesheet" href="./styles/boot-screen.css" />');
    expect(page).not.toMatch(/<style[\s>]/i);
    expect(page).not.toMatch(/\sstyle=/i);
  });
});
