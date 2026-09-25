import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import { ACCOUNT_EXPORT_URL, api, ApiError } from "../../services/api-client.ts";
import { forgetSession } from "../../stores/session-store.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { INPUT_CLASS } from "../../ui/field-classes.ts";
import { shieldLoader } from "../../ui/shield-loader.ts";
import "../confirm-dialog.ts";

/**
 * Les données qu'EasyActions garde sur la personne : les télécharger, ou les effacer (CLAUDE.md §7).
 * L'effacement demande de retaper son login GitHub, comme le lancement sur une branche par défaut.
 */
@Component({ name: "app-data-panel" })
export class AppDataPanel extends TiniComponent {
  static override styles = [sharedSheet];

  @Input() login = "";
  @Reactive() private confirming = false;
  @Reactive() private typed = "";
  @Reactive() private deleting = false;
  @Reactive() private failed = false;

  protected override render() {
    return html`
      <section class="rounded-lg border border-border bg-surface p-5 shadow-card" aria-labelledby="data-heading">
        <h2 id="data-heading" class="text-base font-semibold text-text-primary">Your data</h2>
        <p class="mt-1 text-sm text-text-secondary">
          EasyActions keeps your GitHub login and avatar, your sessions with the GitHub access they hold
          (encrypted), and a history of sign-ins and security actions. Nothing else.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <a href=${ACCOUNT_EXPORT_URL} download router-ignore class=${buttonClass({ variant: "outline", size: "sm" })}>
            Download my data
          </a>
          <button type="button" class=${buttonClass({ variant: "destructive", size: "sm" })} @click=${this.open}>
            Delete my data
          </button>
        </div>
        ${this.renderDialog()}
      </section>
    `;
  }

  private renderDialog() {
    const matches = this.typed.trim().toLowerCase() === this.login.toLowerCase();
    return html`
      <app-confirm-dialog .open=${this.confirming} heading="Delete your EasyActions data?" @dismiss=${this.close}>
        <div class="space-y-3">
          <p class="text-sm text-text-secondary">
            You are signed out on every browser, the GitHub access EasyActions holds for you is revoked, and
            your login, sessions and history are deleted from EasyActions. Your GitHub account and your
            repositories are not touched. You can sign in again later.
          </p>
          <label class="block space-y-1.5">
            <span class="text-xs text-text-secondary">
              Type <span class="font-mono font-semibold text-text-primary">${this.login}</span> to confirm
            </span>
            <input
              class=${INPUT_CLASS}
              autocomplete="off"
              spellcheck="false"
              .value=${live(this.typed)}
              @input=${(event: Event) => (this.typed = (event.target as HTMLInputElement).value)}
            />
          </label>
          ${this.failed
            ? html`<p role="alert" class="text-xs text-signal-danger-text">Deletion failed. Please try again.</p>`
            : nothing}
        </div>
        <div slot="footer" class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" class=${buttonClass({ variant: "outline" })} @click=${this.close}>Cancel</button>
          <button
            type="button"
            class=${buttonClass({ variant: "destructive" })}
            ?disabled=${!matches || this.deleting}
            aria-busy=${this.deleting ? "true" : "false"}
            @click=${this.deleteData}
          >
            ${this.deleting ? shieldLoader(16) : nothing} Delete my data
          </button>
        </div>
      </app-confirm-dialog>
    `;
  }

  private open(): void {
    this.typed = "";
    this.failed = false;
    this.confirming = true;
  }

  private close(): void {
    if (!this.deleting) this.confirming = false;
  }

  /**
   * ÉCHEC FERMÉ : tant que le serveur n'a pas confirmé l'effacement, rien n'est présenté comme effacé
   * et la boîte reste ouverte. Ensuite, rechargement complet vers la connexion.
   */
  private async deleteData(): Promise<void> {
    this.deleting = true;
    this.failed = false;
    try {
      await api.account.deleteData(this.typed.trim());
      forgetSession();
      location.assign("/login");
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.failed = true;
      this.deleting = false;
    }
  }
}
