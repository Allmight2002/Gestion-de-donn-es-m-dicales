# Évaluation de sécurité XLSX

## Versions et exposition

- Vite/Node résout `xlsx` 0.20.3 depuis l'archive officielle SheetJS. Ce chemin lit des CSV/XLSX fournis par l'utilisateur dans un Web Worker.
- Deno/Edge résout l'ESM officiel SheetJS 0.20.3 depuis une copie locale versionnée. Son SHA-256 est vérifié par les tests de déploiement et sa licence Apache 2.0 est conservée avec l'artefact. L'Edge Function écrit seulement des classeurs issus de données serveur validées; elle ne lit pas de classeur utilisateur.
- L'ancien import Deno `npm:xlsx@0.18.5` était affecté par CVE-2024-22363 (ReDoS). Le scénario direct était surtout le parsing navigateur; l'Edge d'export n'appelait pas le parseur, mais conservait un composant vulnérable et un risque de consommation CPU/mémoire sur un export démesuré.

## Solution retenue

La même API SheetJS 0.20.3 est conservée pour limiter les régressions. Le parsing utilisateur reste isolé dans un Worker avec un timeout de 30 secondes et ajoute des plafonds de feuilles, lignes, colonnes, cellules et longueur de cellule. L'export Edge ajoute des plafonds de lignes, colonnes, cellules, longueur, taille sérialisée (64 Mio) et budget de génération (10 s).

Les tests couvrent le nominal, Unicode, formules neutralisées, valeurs codifiées, classeur corrompu, largeur, volume de lignes, chaîne longue/pathologique, taille mémoire et budget temps. L'ouverture automatisée dans Excel et LibreOffice n'est pas disponible dans la CI actuelle : elle reste une vérification manuelle de staging avant promotion.

## Risques résiduels

- Le timeout du Worker protège la réactivité, mais ne remplace pas une limite de taille décompressée ZIP avant parsing; les limites d'upload et de cellules réduisent ce risque sans l'annuler.
- Le contrôle de temps Edge constate un dépassement après l'appel synchrone SheetJS; le timeout dur du runtime reste le dernier coupe-circuit.
- La copie locale ajoute environ 1 Mio au dépôt et doit être mise à jour explicitement avec son hash, sa provenance et sa licence. Elle supprime toutefois la dépendance au CDN SheetJS pendant le bundling Supabase.
