import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { Store } from "@tinijs/store";

/**
 * Abonne UN composant à une clé d'un magasin TiniJS, le temps de sa connexion au document.
 *
 * Remplace le décorateur `@Subscribe` de @tinijs/store 0.21 : sa liste de désabonnements vit sur le
 * prototype de la classe, si bien que déconnecter une instance désabonnait toutes les autres.
 */
export class StoreController<States, Key extends keyof States>
  implements ReactiveController
{
  value: States[Key];
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly store: Store<States>,
    private readonly key: Key,
  ) {
    this.value = store[key];
    host.addController(this);
  }

  hostConnected(): void {
    this.value = this.store[this.key];
    this.unsubscribe = this.store.subscribe<States[Key]>(this.key, (next) => {
      this.value = next;
      this.host.requestUpdate();
    });
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
