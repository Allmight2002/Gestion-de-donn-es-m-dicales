# Dépendances Edge intégrées

## SheetJS 0.20.3

- fichier : `xlsx-0.20.3.mjs`
- source : archive officielle `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
- chemin dans l'archive : `package/xlsx.mjs`
- SHA-256 : `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db`
- licence : Apache-2.0, conservée dans `LICENSE.sheetjs.txt`

Cette copie locale évite qu'un déploiement Edge dépende de la disponibilité du
CDN SheetJS au moment du bundling Supabase. Toute mise à jour doit remplacer le
fichier et la licence, puis mettre à jour le hash vérifié par
`test/deployment.test.ts`.
