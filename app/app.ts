import { html } from "lit";
import { App, ComponentTypes, LifecycleHooks, registerGlobalHook, TiniComponent } from "@tinijs/core";
import { createRouter, type AppWithRouter } from "@tinijs/router";
import { routes } from "./routes.ts";
import { sharedSheet } from "./styles/shared-sheet.ts";
import "./components/nav-indicator.ts";
import "./components/toaster.ts";

/**
 * L'écran de démarrage (app/index.html) disparaît dès qu'une page est prête — connexion, erreur et 404
 * comprises —, puis ce crochet ne fait plus rien. Pas `hideSplashscreen` de TiniJS : il lève une erreur
 * à chaque page suivante, quand l'élément n'existe plus.
 */
registerGlobalHook(ComponentTypes.Page, LifecycleHooks.OnChildrenReady, () => {
  document.getElementById("boot-screen")?.remove();
});

/**
 * Racine TiniJS. `@App()` enregistre toujours la balise `<app-root>` et doit exister avant que le
 * moindre `TiniComponent` ne se connecte. Le routeur vit ici : `getRouter()` le lit sur l'application.
 * Les toasts aussi : ils survivent aux changements de page (un lancement peut finir ailleurs).
 * `navIndicator` : un changement de page de plus de 500 ms affiche `<app-nav-indicator>` (le routeur
 * appelle son `show()`, puis `hide()` quand la page est prête).
 */
@App()
export class AppRoot extends TiniComponent implements AppWithRouter {
  static override styles = [sharedSheet];

  readonly router = createRouter(routes, { linkTrigger: true, navIndicator: true });

  protected override render() {
    return html`<router-outlet .router=${this.router}></router-outlet><app-nav-indicator></app-nav-indicator
      ><app-toaster></app-toaster>`;
  }
}
