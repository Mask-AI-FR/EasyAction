import { html, nothing } from "lit";
import { Page, Reactive, TiniComponent } from "@tinijs/core";
import type { OnBeforeEnter } from "@tinijs/router";
import {
  LOGIN_ERROR_CODES,
  type LoginErrorCode,
} from "../../domain/apiContract.ts";
import { isSameOriginPath } from "../../domain/returnTo.ts";
import { signInUrl } from "../services/api-client.ts";
import { forgetOrg } from "../stores/last-org.ts";
import { ensureSession } from "../stores/session-store.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { buttonClass } from "../ui/button-classes.ts";
import { cn } from "../ui/class-names.ts";
import { brandMark, brandSpinner, wordmark } from "../ui/brand-mark.ts";

const ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  expired: "The sign-in took too long or was interrupted. Please try again.",
  denied: "You cancelled the authorization on GitHub.",
  github: "GitHub did not complete the sign-in. Please try again in a moment.",
  config:
    "The GitHub App must have “Expire user authorization tokens” enabled. Ask the maintainer to fix its settings.",
  unavailable: "EasyActions could not check your session. Please try again.",
  ended: "Your session has ended. Please sign in again.",
};

/**
 * Paramètre de l'adresse courante. Lu dans `location.search`, pas avec `getQuery()` : le routeur de
 * TiniJS 0.21 met ses résultats en cache par chemin seul et rendrait la requête d'une visite antérieure.
 */
function queryParam(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}

/** Ce que l'application apporte, en trois lignes : la page de connexion est aussi sa présentation. */
const FEATURES: readonly string[] = [
  "Every repository, branch and workflow of your organizations in one list",
  "Run many pipelines at once, with a clear confirmation before production",
  "Follow every run live, with a link to it on GitHub",
];

/** Coche de la liste des avantages (décorative : le texte porte le sens). */
const CHECK_ICON = html`<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="mt-0.5 size-4 shrink-0 text-primary-text">
  <path d="M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z" stroke="currentColor" stroke-width="1.4"></path>
  <path d="M5.5 8.25l1.75 1.75 3.25-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>`;

/** Page où aller après connexion : celle que la garde a notée, si elle est de notre origine. */
function requestedReturnTo(): string {
  const candidate = queryParam("returnTo");
  return candidate && isSameOriginPath(candidate) ? candidate : "/orgs";
}

function signInError(): LoginErrorCode | null {
  const code = queryParam("error");
  return LOGIN_ERROR_CODES.find((known) => known === code) ?? null;
}

/** Connexion par GitHub. Sert aussi `/`, pour que « Back to start » mène quelque part. */
@Page({ name: "app-page-login" })
export class AppPageLogin extends TiniComponent implements OnBeforeEnter {
  static override styles = [sharedSheet];

  @Reactive() private redirecting = false;

  /**
   * Déjà connecté : on va directement à la destination. ÉCHEC OUVERT si le serveur ne répond pas :
   * on affiche simplement la page de connexion, qui ne donne accès à rien.
   * Toute fin de session passe par ici (déconnexion, effacement, session expirée ou fermée ailleurs) :
   * sans session, l'organisation retenue est oubliée — la personne suivante sur ce navigateur ne la
   * verra pas.
   */
  async onBeforeEnter(): Promise<string | undefined> {
    const session = await ensureSession().catch(() => null);
    if (session) return requestedReturnTo();
    forgetOrg();
    return undefined;
  }

  protected override render() {
    const error = signInError();
    return html`
      <main class="grid min-h-dvh place-items-center bg-background px-6 py-10">
        <section
          class="animate-login-entry w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-card sm:p-10"
        >
          <div class="flex items-center gap-3.5">
            ${brandMark(48)}
            <div>
              ${wordmark("lg")}
              <p class="mt-0.5 text-2xs font-semibold tracking-[0.16em] text-primary-text uppercase">
                Repository pipeline automation
              </p>
            </div>
          </div>
          <h1 class="mt-8 text-lg font-semibold tracking-tight text-text-primary">Sign in</h1>
          <p class="mt-1 text-sm text-text-secondary">
            Run and follow the GitHub Actions pipelines of your organizations, in one place.
          </p>
          <ul class="mt-5 space-y-2.5">
            ${FEATURES.map((feature) => html`<li class="flex gap-2.5 text-sm text-text-secondary">${CHECK_ICON}${feature}</li>`)}
          </ul>
          ${error
            ? html`<p
                role="alert"
                class="mt-5 rounded-md bg-signal-danger-soft px-3 py-2 text-xs text-signal-danger-text"
              >
                ${ERROR_MESSAGES[error]}
              </p>`
            : nothing}
          <a
            href=${signInUrl(requestedReturnTo())}
            router-ignore
            aria-busy=${this.redirecting ? "true" : "false"}
            class=${cn(buttonClass({ size: "lg" }), "mt-7 w-full")}
            @click=${this.onSignIn}
          >
            ${this.redirecting ? brandSpinner(16) : nothing} Sign in with GitHub
          </a>
          <p class="mt-4 text-2xs text-text-tertiary">
            Only organizations where the GitHub App is installed will appear.
          </p>
        </section>
      </main>
    `;
  }

  /** La navigation vers GitHub suit son cours ; on montre seulement qu'elle a démarré. */
  private onSignIn(): void {
    this.redirecting = true;
  }
}
