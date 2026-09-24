import { describe, expect, test } from "bun:test";

/**
 * Contrastes de la couche de marque EasyActions (app/styles/theme-easyactions.css) sur les surfaces de
 * MASKAI (app/styles/globals.css), en thème clair et sombre. WCAG 2.2 AA : 4,5:1 pour du texte, 3:1
 * pour un élément d'interface (remplissage d'un bouton, anneau de focus).
 */
const ROOT = new URL("../../", import.meta.url).pathname;
const theme = await Bun.file(`${ROOT}app/styles/theme-easyactions.css`).text();
const globals = await Bun.file(`${ROOT}app/styles/globals.css`).text();

type Rgb = readonly [number, number, number];

/** Déclarations `--nom: valeur;` du bloc qu'ouvre `selector` (blocs sans imbrication). */
function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`bloc introuvable : ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return new Map([...body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]));
}

/** Valeurs MASKAI : la première déclaration est celle du thème clair, la seconde celle du sombre. */
function maskai(name: string, theme: "light" | "dark"): string {
  const values = [...globals.matchAll(new RegExp(`^\\s+${name}:\\s*([^;]+);`, "gm"))].map((m) => (m[1] ?? "").trim());
  const value = values[theme === "light" ? 0 : 1];
  if (!value) throw new Error(`jeton MASKAI introuvable : ${name} (${theme})`);
  return value;
}

function parse(color: string, over?: Rgb): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(color);
  if (!rgba || !over) throw new Error(`couleur non prise en charge : ${color}`);
  const alpha = Number(rgba[4]);
  return [1, 2, 3].map((i, k) => Math.round(alpha * Number(rgba[i]) + (1 - alpha) * (over[k] ?? 0))) as unknown as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

const WHITE: Rgb = [255, 255, 255];
const BLOCKS = { light: ":root", dark: 'html[data-theme="dark"]' } as const;

for (const mode of ["light", "dark"] as const) {
  describe(`couleurs EasyActions, thème ${mode === "light" ? "clair" : "sombre"}`, () => {
    const brand = declarations(theme, BLOCKS[mode]);
    const own = (name: string): string => {
      const value = brand.get(name);
      if (!value) throw new Error(`jeton de marque absent : ${name}`);
      return value;
    };
    const surface = parse(maskai("--surface", mode));
    const background = parse(maskai("--background", mode));

    test("texte blanc lisible sur le bouton principal, au repos et au survol (4,5:1)", () => {
      expect(contrast(WHITE, parse(own("--primary")))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(WHITE, parse(own("--primary-hover")))).toBeGreaterThanOrEqual(4.5);
    });

    test("le bouton principal se détache de la carte qui le porte (3:1)", () => {
      expect(contrast(parse(own("--primary")), surface)).toBeGreaterThanOrEqual(3);
    });

    test("liens et texte de marque lisibles sur les cartes et sur la page (4,5:1)", () => {
      for (const name of ["--primary-text", "--text-link", "--text-brand"]) {
        expect([name, contrast(parse(own(name)), surface) >= 4.5]).toEqual([name, true]);
        expect([name, contrast(parse(own(name)), background) >= 4.5]).toEqual([name, true]);
      }
    });

    test("anneau de focus visible sur une carte (3:1)", () => {
      expect(contrast(parse(own("--ring")), surface)).toBeGreaterThanOrEqual(3);
    });

    test("« en cours » reste bleu et lisible sur son badge (4,5:1)", () => {
      const badge = parse(maskai("--shield-blue-soft", mode), surface);
      expect(contrast(parse(own("--run-text")), badge)).toBeGreaterThanOrEqual(4.5);
    });
  });
}
