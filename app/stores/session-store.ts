import { createStore } from "@tinijs/store";
import type { SessionBody } from "../../domain/apiContract.ts";
import { api } from "../services/api-client.ts";

interface SessionState {
  session: SessionBody | null;
  loaded: boolean;
}

/** Session connue de l'interface : login, avatar, expiration — jamais le jeton GitHub. */
export const sessionStore = createStore<SessionState>({ session: null, loaded: false });

/** Charge la session au premier besoin ; les appels suivants relisent le magasin. */
export async function ensureSession(): Promise<SessionBody | null> {
  if (!sessionStore.loaded) {
    sessionStore.commit("session", await api.session());
    sessionStore.commit("loaded", true);
  }
  return sessionStore.session;
}

/** Après une déconnexion réussie côté serveur. */
export function forgetSession(): void {
  sessionStore.commit("session", null);
}
