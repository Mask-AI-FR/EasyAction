import { html, nothing } from "lit";
import { Layout, Reactive, TiniComponent } from "@tinijs/core";
import { getParams, go, ROUTE_CHANGE_EVENT, type OnBeforeEnter } from "@tinijs/router";
import type { SessionBody } from "../../domain/apiContract.ts";
import type { OrgSummary } from "../../domain/githubTypes.ts";
import { api, ApiError } from "../services/api-client.ts";
import { ensureSession, forgetSession, sessionStore } from "../stores/session-store.ts";
import { StoreController } from "../stores/store-controller.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { buttonClass } from "../ui/button-classes.ts";
import { SELECT_CLASS } from "../ui/field-classes.ts";
import { brandMark, wordmark } from "../ui/brand-mark.ts";
import { shieldLoader } from "../ui/shield-loader.ts";

/** Avatar GitHub à la taille affichée (paramètre `s`), sans perdre ses autres paramètres. */
function sizedAvatar(url: string, size: number): string {
  const sized = new URL(url);
  sized.searchParams.set("s", String(size));
  return sized.toString();
}

function currentOrgParam(): string {
  const org: unknown = getParams().org;
  return typeof org === "string" ? org : "";
}

/**
 * Coque des pages connectées : en-tête (marque, organisation, onglets, compte, déconnexion) et
 * emplacement de la page. Le routeur de TiniJS place la page comme enfant de cette mise en page,
 * projetée par `<slot>` ; la mise en page reste la même d'une organisation à l'autre.
 */
@Layout({ name: "app-layout-dashboard" })
export class AppLayoutDashboard extends TiniComponent implements OnBeforeEnter {
  static override styles = [sharedSheet];

  private readonly session = new StoreController(this, sessionStore, "session");
  @Reactive() private orgs: readonly OrgSummary[] = [];
  @Reactive() private currentOrg = "";
  @Reactive() private signingOut = false;
  @Reactive() private signOutFailed = false;

  private readonly onRouteChange = (): void => {
    this.currentOrg = currentOrgParam();
  };

  /**
   * ÉCHEC FERMÉ : pas de tableau de bord sans session vérifiée. Sans session → connexion, puis retour
   * ici ; si la vérification elle-même échoue → connexion avec un message. N'est appelée que lorsque
   * la mise en page change ; une expiration en cours de route arrive par les 401 de l'API.
   */
  async onBeforeEnter(): Promise<string | undefined> {
    try {
      if (await ensureSession()) return undefined;
      return `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
    } catch (err) {
      if (err instanceof ApiError || err instanceof TypeError) return "/login?error=unavailable";
      throw err;
    }
  }

  onCreate(): void {
    addEventListener(ROUTE_CHANGE_EVENT, this.onRouteChange);
    this.currentOrg = currentOrgParam();
    void this.loadOrgs();
  }

  onDestroy(): void {
    removeEventListener(ROUTE_CHANGE_EVENT, this.onRouteChange);
  }

  protected override render() {
    const session = this.session.value;
    return html`
      <div class="flex min-h-dvh flex-col bg-background">
        <header class="chrome sticky top-0 z-10 border-b border-border">
          <div class="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
            <a href="/orgs" class="flex items-center gap-2.5" aria-label="EasyActions: organizations">
              ${brandMark(28)} ${wordmark("md")}
            </a>
            ${this.currentOrg ? this.renderOrgNav() : nothing}
            <div class="ml-auto">${session ? this.renderAccount(session) : nothing}</div>
          </div>
        </header>
        <main class="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <slot></slot>
        </main>
      </div>
    `;
  }

  private renderOrgNav() {
    const current = this.currentOrg;
    const known = this.orgs.some((org) => org.login.toLowerCase() === current.toLowerCase());
    const logins = known ? this.orgs.map((org) => org.login) : [current];
    return html`
      <nav aria-label="Organization" class="flex items-center gap-4">
        <label>
          <span class="sr-only">Organization</span>
          <select class=${SELECT_CLASS} @change=${this.onOrgChange}>
            ${logins.map(
              (login) =>
                html`<option value=${login} ?selected=${login.toLowerCase() === current.toLowerCase()}>${login}</option>`,
            )}
          </select>
        </label>
        <a
          href=${`/orgs/${encodeURIComponent(current)}`}
          aria-current="page"
          class="border-b-2 border-primary py-4 text-sm font-medium text-text-primary"
        >Repositories</a>
      </nav>
    `;
  }

  private renderAccount(session: SessionBody) {
    return html`
      <div class="flex items-center gap-3">
        ${this.signOutFailed
          ? html`<span role="alert" class="text-xs text-signal-danger-text">
              Sign-out failed. Please try again.
            </span>`
          : nothing}
        <img
          src=${sizedAvatar(session.user.avatarUrl, 64)}
          alt=""
          width="28"
          height="28"
          class="size-7 rounded-full border border-border"
        />
        <span class="text-sm font-medium text-text-primary">${session.user.login}</span>
        <button
          type="button"
          class=${buttonClass({ variant: "ghost", size: "sm" })}
          ?disabled=${this.signingOut}
          aria-busy=${this.signingOut ? "true" : "false"}
          @click=${this.onSignOut}
        >
          ${this.signingOut ? shieldLoader(16) : nothing} Sign out
        </button>
      </div>
    `;
  }

  /**
   * ÉCHEC OUVERT : le sélecteur n'est qu'un raccourci. Sans liste, il montre l'organisation courante
   * seule ; la page /orgs reste la voie principale et affiche l'erreur elle-même.
   */
  private async loadOrgs(): Promise<void> {
    try {
      this.orgs = (await api.orgs()).orgs;
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.orgs = [];
    }
  }

  private onOrgChange(event: Event): void {
    go(`/orgs/${encodeURIComponent((event.target as HTMLSelectElement).value)}`);
  }

  /**
   * ÉCHEC FERMÉ : si le serveur n'a pas effacé la session, on ne prétend pas être déconnecté — le
   * message reste affiché et l'utilisateur peut réessayer. Une fois déconnecté, rechargement complet :
   * sélection, exécutions suivies et leur minuterie ne survivent pas à la session (sinon le prochain
   * relevé tomberait sur un 401 et renverrait vers la connexion avec « session ended »).
   */
  private async onSignOut(): Promise<void> {
    this.signingOut = true;
    this.signOutFailed = false;
    try {
      await api.signOut();
      forgetSession();
      location.assign("/login");
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.signOutFailed = true;
    } finally {
      this.signingOut = false;
    }
  }
}
