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
        path: ":org",
        component: "app-page-repos",
        action: () => import("./pages/repos.ts"),
      },
    ],
  },
  {
    path: "**",
    component: "app-page-not-found",
    action: () => import("./pages/not-found.ts"),
  },
];
