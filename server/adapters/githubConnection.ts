import { z } from "zod";

/**
 * Test de la connexion à GitHub depuis la page Settings, AVANT d'enregistrer : l'API répond-elle, et
 * est-ce bien une API GitHub ? `GET /meta` est public : AUCUN jeton ni secret n'est envoyé, et une
 * redirection n'est pas suivie (un autre hôte ne reçoit rien). L'identifiant et le secret de l'app ne
 * sont pas vérifiés ici : GitHub ne documente pas sa réponse à de mauvais identifiants.
 */
export type ConnectionProblem = "unreachable" | "timeout" | "not_github";

/** Sous-ensemble de la réponse de `GET /meta` (github.com comme GitHub Enterprise Server). */
const Meta = z.object({ verifiable_password_authentication: z.boolean() });

export async function testGitHubApi(apiUrl: string, timeoutMs: number): Promise<ConnectionProblem | null> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/meta`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") return "timeout";
    // Réseau injoignable : `Error` à `code` texte chez Bun, `TypeError` ailleurs.
    const code: unknown = err instanceof Error ? (err as { code?: unknown }).code : undefined;
    if (err instanceof TypeError || typeof code === "string") return "unreachable";
    throw err;
  }
  if (!response.ok) return "not_github";
  return Meta.safeParse(await response.json().catch(() => null)).success ? null : "not_github";
}
