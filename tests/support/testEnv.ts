/**
 * Environnement des tests, posé AVANT tout import de `server/config/env.ts`, qui lit
 * l'environnement au chargement (échec fermé au démarrage). À importer en PREMIER dans chaque fichier
 * de test qui charge du code serveur. Valeurs fictives uniquement. La connexion à GitHub n'est plus
 * une variable d'environnement : c'est un réglage du site, posé par `support/testDatabase.ts`.
 */
Object.assign(process.env, {
  HOST: "127.0.0.1",
  PORT: "8094",
  APP_ORIGIN: "http://127.0.0.1:8094",
  SESSION_SECRET: "not-a-real-secret-only-for-tests-000000",
  DATA_ENCRYPTION_KEY: "not-a-real-data-key-only-for-tests-00000",
  // Jamais ouvert par les tests : chaque test passe sa propre base en mémoire (support/testDatabase.ts).
  DATABASE_PATH: "./data/never-opened-by-tests.sqlite",
  HTTP_IDLE_TIMEOUT_SECONDS: "240",
  SESSION_MAX_DAYS: "30",
  SESSIONS_PER_USER_MAX: "5",
  AUDIT_RETENTION_DAYS: "365",
  TWO_FACTOR_EVERY_HOURS: "24",
  TWO_FACTOR_MAX_ATTEMPTS: "5",
  TWO_FACTOR_LOCK_MINUTES: "15",
});
