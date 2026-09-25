import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Chiffrement des secrets gardés en base (jetons GitHub des sessions, secrets des applications
 * d'authentification) : AES-256-GCM, IV aléatoire de 12 octets, et des données associées (AAD) =
 * usage + clé de la ligne. Une valeur recopiée dans une autre colonne ou une autre ligne ne se
 * déchiffre donc pas. Format stocké : `v1.<base64url(IV |
 * chiffré | tag)>` — le préfixe de version permet de changer d'algorithme sans deviner (précédent :
 * jetons de buzz-push-gateway, même organisation).
 * La clé dérive de `DATA_ENCRYPTION_KEY` par HKDF-SHA256 : distincte de celle des cookies, elle peut
 * changer sans rien d'autre (tout le monde se reconnecte alors : les jetons ne se déchiffrent plus).
 */
export type SealedPurpose =
  | "session.access_token"
  | "session.refresh_token"
  | "two_factor.secret"
  | "two_factor.pending_secret"
  | "settings.github_client_secret";

/** Valeur illisible : format inconnu, modifiée, venue d'une autre ligne, ou clé changée. */
export class DataCipherError extends Error {
  constructor() {
    super("Stored value cannot be decrypted");
    this.name = "DataCipherError";
  }
}

const IV_BYTES = 12;
const TAG_BYTES = 16;
const SEALED_FORMAT = /^v1\.([A-Za-z0-9_-]+)$/;

export function deriveDataKey(secret: string): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", secret, "", "pipliner:data-encryption:v1", 32));
}

/**
 * Clé HMAC des codes de secours, distincte de la clé de chiffrement (même secret, autre usage HKDF) :
 * sans elle, une copie de la base ne permet pas de retrouver un code par essais hors ligne.
 */
export function deriveRecoveryCodeKey(secret: string): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", secret, "", "pipliner:recovery-codes:v1", 32));
}

/**
 * Clé HMAC des codes d'installation (`server/auth/setupCode.ts`), elle aussi à part : un code
 * d'installation ne peut être fabriqué qu'avec le secret du serveur.
 */
export function deriveSetupCodeKey(secret: string): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", secret, "", "pipliner:setup-code:v1", 32));
}

function associatedData(purpose: SealedPurpose, rowKey: string): Buffer {
  return Buffer.from(`${purpose}:${rowKey}`, "utf8");
}

export function sealValue(key: Uint8Array, purpose: SealedPurpose, rowKey: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData(purpose, rowKey));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url")}`;
}

/** ÉCHEC FERMÉ : toute valeur qui ne s'authentifie pas lève `DataCipherError`, jamais un texte faux. */
export function openValue(key: Uint8Array, purpose: SealedPurpose, rowKey: string, sealed: string): string {
  const payload = SEALED_FORMAT.exec(sealed)?.[1];
  const bytes = payload ? Buffer.from(payload, "base64url") : Buffer.alloc(0);
  if (bytes.length < IV_BYTES + TAG_BYTES) throw new DataCipherError();
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
  decipher.setAAD(associatedData(purpose, rowKey));
  decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
  try {
    const body = bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch (err) {
    // node:crypto signale un tag faux par une `Error` générique, sans code stable.
    if (err instanceof Error) throw new DataCipherError();
    throw err;
  }
}
