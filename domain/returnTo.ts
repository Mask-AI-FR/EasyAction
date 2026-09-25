/**
 * Adresse de retour après la connexion ou le code du jour : un chemin de NOTRE origine seulement — un
 * seul `/` en tête, ni `//`, ni barre oblique inverse, ni espace, 512 caractères au plus. Sinon une
 * redirection ouverte vers un autre site deviendrait possible. Règle unique, partagée par le serveur
 * (`server/schemas/api.schema.ts`) et l'application (pages de connexion et du code) ; elle était
 * écrite deux fois, la page du code en aurait fait une troisième.
 */
export function isSameOriginPath(candidate: string): boolean {
  return candidate.length <= 512 && /^\/(?![/\\])[^\\\s]*$/.test(candidate);
}
