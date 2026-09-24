/**
 * Environnement des tests, posé AVANT tout import de `server/config/env.ts`, qui lit
 * l'environnement au chargement (échec fermé au démarrage). À importer en PREMIER dans chaque fichier
 * de test qui charge du code serveur. Valeurs fictives uniquement ; les adresses GitHub pointent vers
 * un port fermé, pour qu'un appel réseau imprévu échoue tout de suite au lieu de sortir.
 */
Object.assign(process.env, {
  HOST: "127.0.0.1",
  PORT: "8094",
  APP_ORIGIN: "http://127.0.0.1:8094",
  SESSION_SECRET: "not-a-real-secret-only-for-tests-000000",
  GITHUB_WEB_URL: "http://127.0.0.1:1",
  GITHUB_API_URL: "http://127.0.0.1:1",
  GITHUB_APP_CLIENT_ID: "Iv1.not-a-real-client",
  GITHUB_APP_CLIENT_SECRET: "not-a-real-client-secret",
  GITHUB_TIMEOUT_MS: "2000",
  REPOS_MAX: "1000",
  BRANCHES_MAX: "300",
  ACTIVE_BRANCH_DAYS: "90",
  DISPATCH_MAX_TARGETS: "50",
  DISPATCH_CONCURRENCY: "3",
  RUN_POLL_MIN_SECONDS: "10",
  RUN_TRACK_MAX_MINUTES: "30",
});
