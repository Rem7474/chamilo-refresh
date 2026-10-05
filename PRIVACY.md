# Politique de confidentialité

Chamilo Refresh ne collecte, ne transmet et ne partage aucune donnée.

- L'extension ne s'exécute que sur `https://chamilo.grenoble-inp.fr/*`.
- Elle n'effectue aucune requête réseau et ne charge aucune ressource distante (polices, scripts, statistiques).
- Les réglages (thème, couleur d'accent, options) et la liste des cours favoris sont enregistrés avec `chrome.storage.sync`. Ils sont synchronisés par le navigateur entre vos appareils si la synchronisation est activée, et ne sont jamais lus par le développeur.
- Une copie des réglages d'apparence est conservée dans le `localStorage` de la page Chamilo pour éviter un flash de thème au chargement.
- Le contenu des pages (cours, notes, messages) est lu localement pour filtrer la liste de cours et corriger les contrastes ; il n'est ni stocké ni envoyé.

Permission demandée : `storage` uniquement.
