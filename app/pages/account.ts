import { html, nothing } from "lit";
import { Page, TiniComponent } from "@tinijs/core";
import { sessionStore } from "../stores/session-store.ts";
import { StoreController } from "../stores/store-controller.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import "../components/account/data-panel.ts";
import "../components/account/session-list.ts";
import "../components/account/two-factor-panel.ts";

const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/**
 * Le compte de la personne connectée : ses sessions « rester connecté » et ses données. La garde de
 * la mise en page a déjà vérifié la session ; le magasin la tient (login, fin de session).
 */
@Page({ name: "app-page-account" })
export class AppPageAccount extends TiniComponent {
  static override styles = [sharedSheet];

  private readonly session = new StoreController(this, sessionStore, "session");

  protected override render() {
    const session = this.session.value;
    if (!session) return nothing;
    return html`
      <section class="mx-auto max-w-3xl space-y-5">
        <header>
          <p class="t-eyebrow">Your account</p>
          <h1 class="mt-1 text-xl font-semibold tracking-tight text-text-primary">${session.user.login}</h1>
          <p class="mt-1 text-sm text-text-secondary">
            Signed in with GitHub. This browser stays signed in until ${DATE.format(new Date(session.expiresAt))}.
          </p>
        </header>
        <app-session-list class="block"></app-session-list>
        <app-two-factor-panel class="block"></app-two-factor-panel>
        <app-data-panel class="block" login=${session.user.login}></app-data-panel>
      </section>
    `;
  }
}
