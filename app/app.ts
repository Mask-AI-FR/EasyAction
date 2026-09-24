import { html } from "lit";
import { App, TiniComponent } from "@tinijs/core";
import { createRouter, type AppWithRouter } from "@tinijs/router";
import { routes } from "./routes.ts";
import { sharedSheet } from "./styles/shared-sheet.ts";
import "./components/toaster.ts";

/**
 * Racine TiniJS. `@App()` enregistre toujours la balise `<app-root>` et doit exister avant que le
 * moindre `TiniComponent` ne se connecte. Le routeur vit ici : `getRouter()` le lit sur l'application.
 * Les toasts aussi : ils survivent aux changements de page (un lancement peut finir ailleurs).
 */
@App()
export class AppRoot extends TiniComponent implements AppWithRouter {
  static override styles = [sharedSheet];

  readonly router = createRouter(routes, { linkTrigger: true });

  protected override render() {
    return html`<router-outlet .router=${this.router}></router-outlet><app-toaster></app-toaster>`;
  }
}
