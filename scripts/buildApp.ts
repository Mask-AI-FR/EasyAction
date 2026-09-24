import { cp, rm } from "node:fs/promises";
import tailwind from "bun-plugin-tailwind";

/**
 * Build de production de l'application (`bun run build`) : `app/index.html` et tout ce qu'il
 * référence → `dist/app`, servi ensuite par Hono (`server/index.ts`) avec les en-têtes de sécurité.
 *
 * - Le plugin Tailwind est passé ici explicitement : `bunfig.toml [serve.static]` ne vaut que pour le
 *   serveur de développement.
 * - `process.env.NODE_ENV` est défini parce que @tinijs/core 0.21.1 le lit dans le navigateur
 *   (decorators/app.js, utils/component.js) : sans définition, `process` n'existe pas côté client.
 * - `publicPath: "/"` : les fichiers sont référencés depuis la racine. Avec les chemins relatifs par
 *   défaut (`./chunk-….js`), une adresse profonde ouverte directement (`/orgs/Mask-AI-FR`) cherchait
 *   `/orgs/chunk-….js`, recevait la page HTML de repli, et l'application ne démarrait pas. Une balise
 *   `<base>` n'est pas une option : la CSP l'interdit (`base-uri 'none'`).
 * - Les polices finissent incrustées en `data:` dans la CSS : le bundler CSS de Bun incruste les
 *   « petits » fichiers référencés par `url()` sans option pour l'éviter (un `loader` .woff2 → "file"
 *   ne change rien). La CSP l'autorise pour les seules polices (`font-src`, server/app.ts).
 * - Le dossier de sortie est vidé d'abord : les noms de fichiers sont hachés, un ancien build
 *   s'accumulerait.
 * - Les icônes de l'application installable sont copiées telles quelles vers `/icons/` : Bun copie le
 *   manifeste sous un nom haché mais ne réécrit pas les chemins écrits DEDANS, et un chemin absolu
 *   dans `index.html` fait échouer le build (« Could not resolve »). Elles gardent donc une adresse fixe.
 */
export async function buildWebApp(outDir: string): Promise<Bun.BuildOutput> {
  await rm(outDir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: ["./app/index.html"],
    outdir: outDir,
    target: "browser",
    minify: true,
    publicPath: "/",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [tailwind],
  });
  if (result.success) await cp("./app/public/icons", `${outDir}/icons`, { recursive: true });
  return result;
}

if (import.meta.main) {
  const result = await buildWebApp("./dist/app");
  if (!result.success) {
    for (const log of result.logs) process.stderr.write(`${log.message}\n`);
    process.exit(1);
  }
  process.stdout.write(`dist/app : ${result.outputs.length} fichier(s) écrit(s)\n`);
}
