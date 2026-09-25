/**
 * La dernière organisation ouverte dans ce navigateur (son login seulement), pour la présélectionner
 * dans la barre latérale. La seule préférence gardée par le navigateur ; elle ne survit pas à la
 * session : oubliée à la déconnexion et à l'effacement (`forgetSession`), et chaque fois que la page de
 * connexion s'ouvre sans session (session expirée ou fermée ailleurs, `app/pages/login.ts`).
 *
 * ÉCHEC OUVERT partout : un stockage refusé (navigation privée, quota, politique du navigateur) lève une
 * `DOMException` ; on continue sans mémoire, et la première organisation de la liste est choisie.
 */
const KEY = "easyactions.lastOrg";

export function rememberedOrg(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
    return null;
  }
}

export function rememberOrg(login: string): void {
  try {
    localStorage.setItem(KEY, login);
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
  }
}

export function forgetOrg(): void {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
  }
}
