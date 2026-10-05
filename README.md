# Chamilo Refresh

Extension Chrome / Edge (Manifest V3) pour https://chamilo.grenoble-inp.fr/.

- **Recherche en tête de « Mes cours »** : grande barre qui filtre les cours en direct (titre, enseignants, sans tenir compte des accents). `/` la focalise, `↑ ↓` naviguent, `Entrée` ouvre le cours, `Échap` efface. Sans résultat, `Entrée` lance la recherche native de Chamilo.
- **Favoris** : étoile à côté de chaque cours, favoris remontés en tête, filtre « Favoris ». Synchronisés via le compte du navigateur.
- **Thème sombre / clair / auto**, couleur d'accent au choix ; les contrastes sont calculés pour rester lisibles quelle que soit la couleur.
- **Correction des textes illisibles** : les couleurs écrites en dur dans le contenu des cours (collées depuis Word, etc.) sont remplacées lorsqu'elles sont illisibles sur le nouveau fond.
- Aucune donnée envoyée à l'extérieur, aucune police ou ressource distante ([confidentialité](PRIVACY.md)).

## Installation

1. Télécharger le zip de la dernière [release](../../releases) et le décompresser, ou cloner ce dépôt.
2. `chrome://extensions` → activer le mode développeur.
3. « Charger l'extension non empaquetée » → choisir le dossier décompressé (ou la racine du dépôt).
4. Cliquer sur l'icône de l'extension pour régler le thème.

`npm run build` produit `dist/chamilo-refresh-<version>.zip`. Une release GitHub est créée à chaque tag `vX.Y.Z` correspondant à la version de `manifest.json` et `package.json`.

## Tests

`test/e2e.cjs` lance Chromium avec l'extension, vérifie le thème et le contraste WCAG AA sur la vraie page de connexion, puis sur `test/mock-portal.html` (maquette de « Mes cours » servie sous l'origine Chamilo) : recherche, raccourcis, favoris, thèmes.

```
npm ci
npx playwright-core install chromium
npm test
```

Variables : `CHROME_PATH` (binaire Chromium à utiliser), `BC_OUT` (dossier où écrire les captures d'écran).

## Limites connues

Les pages protégées par CAS n'ont pas pu être inspectées : les cartes de cours sont détectées par leurs liens `/courses/<code>/index.php`, pas par des classes CSS, et la maquette de test est reconstruite d'après une capture. Si une carte est mal découpée sur une page réelle, le correctif se trouve dans `collectUnits()` de `src/courses.js`.

## Licence

MIT, voir [LICENSE](LICENSE).
