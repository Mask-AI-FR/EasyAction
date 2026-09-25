import "../support/testEnv.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDatabase } from "../support/testDatabase.ts";
import { buildApp, serveBuiltApp } from "../../server/app.ts";
import { parseEnv } from "../../server/config/env.ts";
import { buildWebApp } from "../../scripts/buildApp.ts";

const outDir = await mkdtemp(join(tmpdir(), "pipliner-build-"));
const installableDir = await mkdtemp(join(tmpdir(), "pipliner-installable-"));

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
  await rm(installableDir, { recursive: true, force: true });
});

describe("build de production de l'application", () => {
  test("référence ses fichiers depuis la racine : une adresse profonde ouverte directement démarre", async () => {
    const result = await buildWebApp(outDir);
    expect(result.success).toBe(true);
    const html = await Bun.file(join(outDir, "index.html")).text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(assets.length).toBeGreaterThanOrEqual(2);
    // Régression : `./chunk-….js` se résolvait en `/orgs/chunk-….js` depuis `/orgs/Mask-AI-FR`.
    for (const asset of assets) expect(asset).toMatch(/^\/(?!\/)/);
  });

  test("ne laisse aucune référence à `process` dans le code livré au navigateur", async () => {
    const scripts = [...new Bun.Glob("*.js").scanSync({ cwd: outDir })];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(await Bun.file(join(outDir, script)).text()).not.toContain("process.env");
    }
  });
});

interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose: string;
}

/** Largeur × hauteur lues dans l'en-tête IHDR du PNG (octets 16 à 23). */
async function pngSize(path: string): Promise<string> {
  const bytes = Buffer.from(await Bun.file(path).arrayBuffer());
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("application installable sur le bureau", () => {
  let manifestHref = "";

  beforeAll(async () => {
    expect((await buildWebApp(installableDir)).success).toBe(true);
    const html = await Bun.file(join(installableDir, "index.html")).text();
    manifestHref = /<link rel="manifest" href="(\/manifest-[a-z0-9]+\.webmanifest)"/.exec(html)?.[1] ?? "";
  });

  test("la page lie un manifeste de fenêtre autonome, ouverte sur /orgs, et un favicon", async () => {
    expect(manifestHref).not.toBe("");
    const html = await Bun.file(join(installableDir, "index.html")).text();
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon-[a-z0-9]+\.svg"/);
    expect(await Bun.file(join(installableDir, manifestHref)).json()).toMatchObject({
      id: "/",
      name: "EasyActions",
      short_name: "EasyActions",
      start_url: "/orgs",
      scope: "/",
      display: "standalone",
    });
  });

  test("chaque icône du manifeste existe à l'adresse fixe /icons/, à la taille annoncée", async () => {
    const { icons } = (await Bun.file(join(installableDir, manifestHref)).json()) as { icons: ManifestIcon[] };
    for (const icon of icons) {
      expect(icon.src).toMatch(/^\/icons\/[a-z0-9-]+\.png$/);
      expect(await pngSize(join(installableDir, icon.src))).toBe(icon.sizes);
    }
    // Chromium exige 192 et 512 px pour l'installation ; « maskable » pour les lanceurs qui découpent.
    expect(icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  test("en production, manifeste et icônes sont servis avec leur type et revalidés à chaque visite", async () => {
    const instance = buildApp(parseEnv(process.env), testDatabase());
    serveBuiltApp(instance, installableDir);
    const manifest = await instance.request(manifestHref);
    expect(manifest.headers.get("content-type")).toContain("application/manifest+json");
    expect(manifest.headers.get("cache-control")).toBe("no-cache");
    const icon = await instance.request("/icons/icon-192.png");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/png");
  });
});
