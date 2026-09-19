# Harness de vérification navigateur L68

Ce harness rend les vrais composants `EncounterFields` et `RepeatableGroup` dans le navigateur. Il injecte un dépôt `PatientRepository` uniquement en mémoire, avec des enregistrements fabriqués, et le bandeau de la page l'indique. Les changements disparaissent au rechargement. Le contexte Playwright bloque les requêtes HTTP qui ne ciblent pas localhost.

Depuis la racine du dépôt, démarrer Vite puis lancer le scénario navigateur :

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 4173 --strictPort
$env:L68_BROWSER_ARTIFACT_DIR = 'D:\Temp\l68-browser-artifacts'
node verification/l68-browser/verify.mjs
```

Le scénario vérifie l'ajout, la correction avec motif, la suppression avec motif, l'état vide, le tableau à 768 px et les cartes à 767 px et 390 px. Il vérifie aussi que le document ne déborde pas horizontalement avec un texte de fixture long. Cette preuve porte sur le comportement navigateur local et le dépôt mémoire injecté; elle ne valide ni le serveur, ni RLS, ni une écriture clinique.
