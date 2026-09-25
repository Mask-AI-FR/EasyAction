import { html } from "lit";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";

/**
 * Codes de secours, montrés UNE seule fois : à garder dans un gestionnaire de mots de passe. On peut
 * les télécharger en texte ou les copier ; ils ne sont gardés nulle part dans la page ensuite.
 */
@Component({ name: "app-recovery-codes" })
export class AppRecoveryCodes extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) codes: readonly string[] = [];
  @Reactive() private copied = false;

  protected override render() {
    return html`<div class="space-y-3">
      <p class="text-sm text-text-secondary">
        Keep these recovery codes somewhere safe, like a password manager. If you lose your phone, each one
        replaces the daily code once. They are shown only now.
      </p>
      <ol class="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-border bg-surface-secondary p-4 font-mono text-sm text-text-primary" aria-label="Recovery codes">
        ${this.codes.map((code) => html`<li>${code}</li>`)}
      </ol>
      <div class="flex flex-wrap gap-2">
        <button type="button" class=${buttonClass({ variant: "outline", size: "sm" })} @click=${this.download}>Download</button>
        <button type="button" class=${buttonClass({ variant: "outline", size: "sm" })} @click=${this.copy}>
          ${this.copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>`;
  }

  private get text(): string {
    return `EasyActions recovery codes (each works once)\n\n${this.codes.join("\n")}\n`;
  }

  /** Fichier créé dans le navigateur (lien `blob:` éphémère) : rien ne repasse par le serveur. */
  private download(): void {
    const url = URL.createObjectURL(new Blob([this.text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "easyactions-recovery-codes.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** ÉCHEC OUVERT : si le presse-papiers est refusé, le téléchargement et la liste restent là. */
  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text);
      this.copied = true;
    } catch (err) {
      if (!(err instanceof DOMException)) throw err;
      this.copied = false;
    }
  }
}
