/**
 * Le pipeline choisi pour chaque dépôt dans sa liste déroulante (clé `owner/name` → identifiant du
 * workflow), gardé par ce navigateur. Des noms de dépôts d'organisation et des nombres, aucune donnée
 * personnelle ; comme l'organisation retenue (`last-org.ts`), oublié à la fin de la session
 * (`forgetSession`, et la page de connexion ouverte sans session).
 *
 * ÉCHEC OUVERT partout : un stockage refusé (navigation privée, quota, politique du navigateur) lève une
 * `DOMException`, une valeur illisible est ignorée ; on continue sans mémoire, et un dépôt à plusieurs
 * pipelines redemande son choix (rien n'y part sans lui : `domain/dispatchPlan.ts`).
 */
const KEY = "easyactions.pipelines";

/** Relit la valeur stockée ; tout ce qui n'est pas un couple `texte → entier positif` est écarté. */
export function parsePipelineChoices(raw: string | null): Map<string, number> {
  const choices = new Map<string, number>();
  if (!raw) return choices;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    return choices;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return choices;
  for (const [repo, id] of Object.entries(parsed)) {
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) choices.set(repo, id);
  }
  return choices;
}

export function rememberedPipelines(): Map<string, number> {
  try {
    return parsePipelineChoices(localStorage.getItem(KEY));
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
    return new Map();
  }
}

export function rememberPipelines(choices: ReadonlyMap<string, number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(choices)));
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
  }
}

export function forgetPipelines(): void {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
  }
}
