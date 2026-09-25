/**
 * L'adresse de l'API GitHub découle de l'adresse web ; les laisser diverger enverrait les jetons des
 * personnes connectées à un autre hôte que celui qui les a délivrés. Règle partagée par le serveur
 * (qui refuse une paire qui ne va pas) et la page Settings (qui propose l'adresse d'API).
 * - github.com → https://api.github.com
 * - <nom>.ghe.com (GitHub Enterprise Cloud, résidence des données) → https://api.<nom>.ghe.com
 * - tout autre hôte (GitHub Enterprise Server) → <origine>/api/v3
 * - boucle locale (faux GitHub de développement et des tests) : l'adresse d'API doit rester locale.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Adresse d'API attendue pour une adresse web, sans barre finale ; `null` si l'adresse est invalide. */
export function apiUrlFor(webUrl: string): string | null {
  const web = parse(webUrl);
  if (!web) return null;
  if (web.hostname === "github.com") return "https://api.github.com";
  if (web.hostname.endsWith(".ghe.com")) return `${web.protocol}//api.${web.host}`;
  return `${web.origin}/api/v3`;
}

/** Vrai si `apiUrl` est bien l'API de `webUrl` (ou si les deux visent la boucle locale). */
export function isPairedApiUrl(webUrl: string, apiUrl: string): boolean {
  const web = parse(webUrl);
  const api = parse(apiUrl);
  if (!web || !api) return false;
  if (LOOPBACK.has(web.hostname)) return LOOPBACK.has(api.hostname);
  return apiUrl.replace(/\/+$/, "") === apiUrlFor(webUrl);
}
