import type { Route } from "@tinijs/router";

/**
 * Table des routes (syntaxe path-to-regexp v6). Une route avec `children` est une mise en page : ses
 * pages s'affichent dedans. `'**'` est la page 404, cherchée en dernier recours.
 * `/` sert la page de connexion, qui redirige d'elle-même vers `/orgs` quand une session existe.
 */
export const routes: Route[] = [
  {
    path: "",
    component: "app-page-login",
    action: () => import("./pages/login.ts"),
  },
  {
    path: "login",
    component: "app-page-login",
    action: () => import("./pages/login.ts"),
  },
  {
    // L'installation (connexion à l'app GitHub, ouverte par un code du serveur) : sans la mise en page
    // connectée, puisque personne ne peut encore se connecter.
    path: "setup",
    component: "app-page-setup",
    action: () => import("./pages/setup.ts"),
  },
  {
    // Le code à 6 chiffres du jour, ou la mise en place de l'application : sans la mise en page
    // connectée, comme la connexion (rien du tableau de bord avant le code).
    path: "two-factor",
    component: "app-page-two-factor",
    action: () => import("./pages/two-factor.ts"),
  },
  {
    path: "orgs",
    component: "app-layout-dashboard",
    action: () => import("./layouts/dashboard.ts"),
    children: [
      {
        path: "",
        component: "app-page-orgs",
        action: () => import("./pages/orgs.ts"),
      },
      {
        // Avant `:org` : le premier onglet d'une organisation, ouvert depuis la liste des organisations.
        path: ":org/dashboard",
        component: "app-page-dashboard",
        action: () => import("./pages/dashboard.ts"),
      },
      {
        path: ":org",
        component: "app-page-repos",
        action: () => import("./pages/repos.ts"),
      },
    ],
  },
  {
    // Même mise en page que /orgs : le routeur de TiniJS la garde telle quelle d'une page à l'autre
    // (router-outlet.js ne remplace que la page quand la balise de mise en page est la même).
    path: "account",
    component: "app-layout-dashboard",
    action: () => import("./layouts/dashboard.ts"),
    children: [
      {
        path: "",
        component: "app-page-account",
        action: () => import("./pages/account.ts"),
      },
    ],
  },
  {
    // Administration (Settings · Users · History), dans la même mise en page. Le serveur refuse (403)
    // quiconque n'est pas administrateur ; chaque page l'affiche.
    path: "settings",
    component: "app-layout-dashboard",
    action: () => import("./layouts/dashboard.ts"),
    children: [
      {
        path: "",
        component: "app-page-admin-settings",
        action: () => import("./pages/admin-settings.ts"),
      },
      {
        path: "users",
        component: "app-page-admin-users",
        action: () => import("./pages/admin-users.ts"),
      },
      {
        path: "history",
        component: "app-page-admin-history",
        action: () => import("./pages/admin-history.ts"),
      },
    ],
  },
  {
    path: "**",
    component: "app-page-not-found",
    action: () => import("./pages/not-found.ts"),
  },
];
