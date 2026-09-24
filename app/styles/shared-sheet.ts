/**
 * Feuille de style adoptée par TOUS les shadow roots de l'application.
 *
 * TiniJS impose le shadow DOM : `TiniElement.createRenderRoot()` attache toujours une racine, et
 * `TiniComponent.firstUpdated()` lit `this.shadowRoot` sans garde (@tinijs/core 0.21.1) — un rendu
 * en light DOM ferait planter chaque composant. La CSS globale compilée (globals.css + Tailwind)
 * n'atteint donc pas l'intérieur des composants : on en recopie les règles, une seule fois, dans cette
 * feuille construite, que chaque composant déclare par `static override styles = [sharedSheet]`.
 *
 * Les jetons (`:root`, `html.dark`, `html[data-density]`) restent au niveau du document et descendent
 * par héritage des propriétés personnalisées ; les `@font-face` aussi, car un shadow root les ignore.
 * La feuille est vivante : la remplir après coup met à jour tous les composants qui l'ont adoptée.
 */
export const sharedSheet = new CSSStyleSheet();

/**
 * Remplit `sharedSheet` avec les règles des feuilles du document, une fois celles-ci chargées.
 *
 * ÉCHEC FERMÉ : une feuille qui ne charge pas rejette la promesse et l'application ne démarre pas.
 * Une interface sans le système de design (badges d'état sans couleur, boutons sans état) ne doit pas
 * servir à déclencher des déploiements ; l'erreur reste visible dans la console du navigateur.
 */
export async function fillSharedSheet(doc: Document): Promise<void> {
  const links = Array.from(
    doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  );
  await Promise.all(links.map(waitUntilLoaded));
  const cssText = Array.from(doc.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule) => !(rule instanceof CSSFontFaceRule))
    .map((rule) => rule.cssText)
    .join("\n");
  sharedSheet.replaceSync(cssText);
}

function waitUntilLoaded(link: HTMLLinkElement): Promise<void> {
  if (link.sheet) return Promise.resolve();
  return new Promise((resolve, reject) => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error(`Feuille de style non chargée : ${link.href}`)),
      { once: true },
    );
  });
}
