/**
 * L'organisation choisie par défaut dans la barre latérale : la dernière ouverte dans ce navigateur si
 * elle est encore dans la liste (les logins GitHub ne distinguent pas la casse), sinon la première de
 * la liste ; `null` sans aucune organisation.
 */
export function defaultOrgOf(logins: readonly string[], remembered: string | null): string | null {
  const wanted = remembered?.toLowerCase();
  const match = wanted ? logins.find((login) => login.toLowerCase() === wanted) : undefined;
  return match ?? logins[0] ?? null;
}
