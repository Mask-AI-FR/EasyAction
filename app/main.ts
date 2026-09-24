import { fillSharedSheet } from "./styles/shared-sheet.ts";

// Ordre de démarrage : la feuille partagée est remplie AVANT que les composants ne se définissent et
// ne s'affichent, sinon ils apparaîtraient un instant sans style (voir styles/shared-sheet.ts).
await fillSharedSheet(document);
await import("./app.ts");
