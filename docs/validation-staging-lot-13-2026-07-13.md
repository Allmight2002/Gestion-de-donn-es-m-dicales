# LOT 13 — Rapport final de validation staging

> **Archive datée.** Ce rapport conserve le verdict du candidat du 13 juillet. Ne pas le
> confondre avec la preuve staging du 1er août, décrite dans
> [`etat-actuel-2026-08-01.md`](etat-actuel-2026-08-01.md).

Date : 2026-07-13 (Africa/Douala)

Décision : **staging non validé**

Portée validée : **socle automatisé de release staging vert**

Portée non validée : **matrice LOT 13 complète et promotion production**

## Synthèse

La release coordonnée du commit `fba4d926eee378655318f9cb4d120e79c999a6da` a réussi de bout en bout sur le staging : variables, 99 migrations, RLS, Storage, six Edge Functions, scanner strict, frontend preview, 13 contrôles documentaires cloud et 9 parcours navigateur critiques.

Le LOT 13 complet reste toutefois **non validé**. Plusieurs scénarios déclarés obligatoires n'ont pas été exécutés sur le cloud, notamment les matrices import, réseau, hors-ligne, concurrence/retry et modèles/suppression. Le scanner staging dépend en outre d'un ClamAV local exposé par un tunnel Cloudflare éphémère. Ces lacunes interdisent de conclure « staging validé » et bloquent toute promotion production.

## Cible et release

| Élément | Valeur vérifiée |
|---|---|
| Supabase | projet staging `gmsxrniiclrheehhoakn`, PostgreSQL 17.6 |
| Branche de la release | `develop` |
| Commit déployé | `fba4d926eee378655318f9cb4d120e79c999a6da` |
| Frontend | `registre-clinique@0.1.0` |
| Preview Vercel | `https://gestion-de-donn-es-m-dicales-1ykbf9p11-med-data.vercel.app` |
| Workflow | `Coordinated release`, run `29268409342`, conclusion `success` |
| Durée du workflow | environ 9 min 20 s |
| Production | job explicitement `skipped`; aucun déploiement production |
| Données | uniquement comptes et données synthétiques de staging |

Preuve GitHub : <https://github.com/Allmight2002/Gestion-de-donn-es-m-dicales/actions/runs/29268409342>

Artefacts conservés :

- `release-29268409342` : manifeste de release, rétention GitHub 30 jours ;
- `browser-e2e-29268409342` : rapport Playwright et JUnit, rétention GitHub 14 jours ;
- copie locale : `C:\Users\USER\AppData\Local\MedData\lot13-artifacts\29268409342` ;
- sauvegarde logique antérieure à la dernière migration : `C:\Users\USER\AppData\Local\MedData\staging-backups\20260713T094158Z-8eeecbb7f1bf`.

## Prérequis et variables

Le gate `release:env --target=staging` a réussi sans afficher les valeurs. Les noms requis présents dans l'environnement GitHub staging sont :

- frontend : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, avec `VITE_USE_SIGNED_READ=true` et `VITE_REQUIRE_SERVER_INSPECTION=true` forcés par le workflow ;
- Supabase : `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ;
- scanner : `CLAMAV_SCAN_URL`, `CLAMAV_SCAN_TOKEN`, `REQUIRE_SERVER_INSPECTION=true`, `DB_REQUIRE_SERVER_INSPECTION=true` ;
- Vercel : `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` ;
- E2E : comptes médecin, curateur et administrateur, plus les identifiants des fixtures patient/export.

Quatre comptes de test sont présents : un médecin, deux curateurs et un administrateur système. Aucun identifiant, mot de passe, token ou clé n'est reproduit dans ce rapport.

## Ordre de validation exécuté

| Étape | Résultat | Preuve principale |
|---|---|---|
| 1. Variables | Réussi | gate `release:env` et cible staging |
| 2. État migrations | Réussi | drift détecté puis historique distant vérifié |
| 3. Migrations manquantes | Réussi | application additive de `20260713000100_pgcrypto_rpc_search_path.sql` |
| 4. RLS | Réussi structurellement | 34/34 tables `public` avec RLS, 58 policies |
| 5. Storage | Réussi | 4 buckets privés, 2 policies d'insert, hash complet ci-dessous |
| 6. Edge Functions | Réussi | 6/6 actives et inventaire sans drift |
| 7. Scanner | Réussi au moment du test | santé, fichier sain, EICAR isolé, mode DB strict |
| 8. Frontend | Réussi | preview Vercel construit depuis le même SHA |
| 9. Smoke tests | Réussi | shell applicatif réel et parcours login |
| 10. E2E critiques | Réussi | 9/9 Playwright, aucun skip |
| 11. Tests manuels critiques | Non exécuté | plan QA disponible, aucune session manuelle complète |
| 12. Rapport de version | Produit | présent document + artefacts |

## État des composants déployés

### Base, migrations et RLS

- 99 migrations distantes, dernière : `20260713000100_pgcrypto_rpc_search_path.sql`.
- La liste complète et ordonnée est conservée dans `deploy-manifest.json` de l'artefact `release-29268409342`.
- 34 tables `public`, toutes avec RLS activée.
- 58 policies `public`.
- `require_server_inspection() = true`.
- Application depuis zéro des 99 migrations et du seed fictif : réussie.
- Deux appels réels de contrôle, dans des transactions annulées, ont réussi après la migration : `create_patient_curation_submission` et `create_template_bundle`. Aucun patient ou gabarit de sonde ne subsiste.

### Storage

Buckets privés vérifiés, limite 20 Mio :

- `clinical-attachments` ;
- `raw-documents` ;
- `scientific-exports` ;
- `quarantined-uploads`.

Policies `storage.objects` vérifiées : `clinical_attachments_insert` et `raw_documents_insert`, rôle `authenticated`. Aucune policy utilisateur de lecture sur la quarantaine et aucune lecture directe des exports conservés.

Hash Git du fichier appliqué : `sha256:b9e87377b04b85a77a4a0b5382b105fc59cba615d2cfb667c40c294939878367`.

### Edge Functions

| Fonction | État | Version distante |
|---|---:|---:|
| `cleanup-upload` | ACTIVE | 21 |
| `finalize-upload` | ACTIVE | 15 |
| `generate-export` | ACTIVE | 15 |
| `inspect-upload` | ACTIVE | 21 |
| `reconcile-quarantine` | ACTIVE | 15 |
| `signed-read` | ACTIVE | 21 |

Toutes ont été redéployées par le run depuis le même checkout `fba4d926…`; `release:drift` a confirmé l'inventaire.

### Scanner

- ClamAV isolé, conteneur sain au moment du test.
- Préflight strict : santé, fichier PDF synthétique sain et EICAR isolé réussis.
- EICAR dans un DOCX : verdict `Eicar-Test-Signature`, quarantaine physique, original supprimé, lecture signée refusée, bucket de quarantaine illisible pour l'utilisateur.
- Réserve opérationnelle : le scanner est hébergé sur ce poste et exposé par un tunnel Cloudflare à URL éphémère. Le processus et les deux conteneurs ClamAV sont volontairement laissés actifs tant que la base staging reste en mode strict.

## Tests réussis

### Gates locaux et CI

- TypeScript strict et ESLint : réussis.
- Vitest : 74 fichiers, 524 tests réussis, 0 échec, durée 79,65 s dans le run final.
- PostgreSQL/RLS/RPC : inclus dans les 524 tests ; application réelle des 99 migrations depuis zéro réussie.
- Edge : format, lint, typecheck et 64/64 tests Deno réussis.
- Build Vite/PWA : réussi en 8,39 s.
- Image scanner : build, démarrage et santé réussis dans la CI de la PR 19.
- `supabase db lint` après correctif : 0 erreur.

### Staging réel — backend et fichiers

Les 13/13 scénarios suivants ont réussi :

- upload sain, inspection `accepted`, URL signée et relecture des octets ;
- EICAR DOCX détecté par ClamAV et déplacé en quarantaine ;
- refus de lecture signée d'un fichier quarantined ;
- refus de lecture utilisateur du bucket quarantaine ;
- EICAR brut déguisé en PDF rejeté par les magic bytes ;
- upload sans ticket refusé par la policy Storage ;
- objet de 21 Mio refusé par la limite du bucket ;
- ancien statut `accepted_client` illisible en strict puis réinspecté avec succès.

### Staging réel — navigateur

Playwright Chromium : 9/9 réussis, 0 échec, 0 erreur, 0 skip ; 30,6 s de temps mur, 53,662 s cumulées dans JUnit.

- route protégée refusée sans session ;
- connexion invalide refusée ;
- connexion médecin et persistance après refresh ;
- expiration de session puis retour au login ;
- connexion curateur et refus de la zone admin ;
- connexion administrateur et refus de la zone patient ;
- export CSV réel par un médecin, présence dans l'historique et téléchargement ;
- export refusé à un rôle sans droit ;
- création, lecture, mise à jour, refresh, persistance et suppression logique d'un patient fictif.

## Tests échoués

Aucun test n'a échoué dans l'exécution finale `29268409342`.

Une anomalie bloquante avait été découverte après le run précédent : deux RPC transactionnelles échouaient sur staging avec `digest(...) does not exist`. Elle a été corrigée par la migration additive `20260713000100`, puis prouvée par le lint distant, deux appels transactionnels réussis et la release complète finale.

## Tests non exécutés sur staging

Les suites locales couvrent une grande partie de ces invariants, mais ne constituent pas une preuve cloud ou navigateur.

### Authentification et rôles

- révocation d'une permission pendant une session active ;
- second médecin authentifié sans aucun accès à la base, avec essais directs base/patient ;
- bouton Précédent après logout et vérification qu'aucune donnée en cache ne réapparaît.

### Export

- cohorte contenant plusieurs versions de gabarit ;
- variable retirée, variable renommée et libellés identiques ;
- âges en jours, mois et années ;
- export XLSX réel sur staging ;
- client forgé appelant directement le backend ;
- inspection du contenu CSV/XLSX pour la neutralisation des formules.

Le CSV, le refus par rôle, l'historique et le téléchargement ont en revanche réussi.

### Import

- import multi-chunks ;
- réponse perdue après commit ;
- retry du même chunk ;
- refresh et reprise du même lot ;
- double retry concurrent ;
- clôture exacte ;
- vérification distante de l'absence de doublons.

### Patients et curation

- conflit concurrent à deux comptes ;
- échec simulé au milieu de la création atomique et rollback distant ;
- double clic concurrent ;
- retry après réponse perdue ;
- vérification distante de l'absence de patient orphelin ;
- cycle manuel complet médecin vers curateur et finalisation.

Le parcours patient nominal et les deux RPC transactionnelles nominales ont réussi.

### Fichiers

- état `pending` et refus de lecture explicite ;
- timeout avant verdict et timeout après verdict ;
- retry du même fichier et absence de doublons ;
- déconnexion pendant l'upload ;
- double soumission du même upload.

Le fichier sain, le fichier rejeté/quarantined, EICAR, la lecture refusée en quarantaine, le ticket obligatoire et la limite de taille ont réussi.

### Hors-ligne

- activation autorisée et minimisation inspectée dans IndexedDB ;
- refresh hors-ligne ;
- reprise après reconnexion ;
- expiration du cache et de l'outbox ;
- logout, changement de compte et purge vérifiée.

### Modèles et suppression

- création transactionnelle complète avec champs et base ;
- clonage ;
- erreur au milieu de l'opération et rollback ;
- retry avec la même clé ;
- suppression réussie et suppression refusée ;
- conservation du motif après échec.

### Conditions réseau et manuel

- latence élevée ;
- réponse perdue ;
- timeout ;
- déconnexion pendant une écriture ;
- `navigator.onLine === true` alors que Supabase est inaccessible ;
- reconnexion et double soumission ;
- plan manuel critique complet `docs/qa-parcours-site.md`.

## Anomalies

1. **Majeure avant production — scanner non pérenne.** Le mode strict staging dépend d'un poste local, de Docker et d'un tunnel Cloudflare éphémère. Un arrêt du poste ou du tunnel bloque l'inspection et donc les uploads stricts.
2. **À qualifier — matrice fonctionnelle incomplète.** Les tests non exécutés ci-dessus empêchent de démontrer pertes nulles et idempotence sous conditions réseau réalistes.
3. **À qualifier — privilèges RPC.** 129 fonctions `SECURITY DEFINER` existent ; 82 sont exécutables par `anon` et 97 par `authenticated` selon les ACL PostgreSQL. Toutes ont un `search_path` attendu et les tests RLS passent, mais l'exposition doit être revue fonction par fonction avant production.
4. **Mineure — lint PostgreSQL.** Deux warnings signalent `is_strict_date_text` comme `IMMUTABLE` alors qu'il emploie des expressions classées `STABLE`. Sept warnings supplémentaires concernent les paramètres volontairement inutilisés de wrappers de compatibilité en échec fermé. Aucune erreur de lint ne subsiste.
5. **Opérationnelle — restauration complète non prouvée.** La restauration des données `public` a été exercée localement. Une restauration complète incluant Auth et tous les rôles sur une version PostgreSQL compatible n'est pas démontrée.
6. **Mineure — Actions GitHub.** Le runner avertit que certaines actions v4 ciblent encore Node.js 20 et sont forcées sous Node.js 24. Les jobs réussissent, mais les actions devront être mises à niveau.
7. **Résolue — bypass Vercel.** Le secret de bypass historique était désynchronisé. Le workflow utilise désormais un cookie `_vercel_jwt` éphémère, HttpOnly/Secure, limité au domaine exact puis supprimé. Le secret GitHub historique n'est plus référencé dans le dépôt.
8. **Résolue — RPC pgcrypto.** Les deux erreurs runtime `digest(...)` ont été corrigées et revalidées.

## Actions cloud restantes

1. Héberger ClamAV sur une URL stable et supervisée, puis remplacer le secret Edge et rejouer santé + EICAR avant d'arrêter le tunnel local.
2. Exécuter la matrice staging non exécutée : import, concurrence/retries, hors-ligne, réseau, modèles/suppression et QA manuelle.
3. Revoir et réduire les privilèges `EXECUTE` des fonctions `SECURITY DEFINER`, avec une migration additive et tests RLS si nécessaire.
4. Qualifier/corriger les warnings `supabase db lint`, en particulier la volatilité de `is_strict_date_text`.
5. Tester une restauration complète Supabase/Auth sur une version PostgreSQL compatible et documenter RTO/RPO.
6. Supprimer le secret GitHub `VERCEL_AUTOMATION_BYPASS_SECRET` uniquement après confirmation qu'aucun workflow externe ne l'utilise.
7. Nettoyer périodiquement les fixtures et objets EICAR synthétiques du staging selon une procédure de conservation explicite.
8. Mettre à niveau les actions GitHub qui ciblent Node.js 20.

## Rollback disponible et limites

- Frontend : redéployer le preview Vercel précédent, puis rejouer smoke et E2E critiques.
- Edge : redéployer les six fonctions depuis le SHA précédent, puis vérifier drift et scanner.
- Storage : réappliquer transactionnellement le `storage.sql` du SHA précédent et comparer son hash.
- Secrets : restaurer les valeurs précédentes hors logs/tickets.
- Base : migrations forward-only. `db push` n'est pas un rollback ; utiliser une migration corrective additive ou une restauration testée.
- Sauvegarde disponible : quatre dumps logiques (`schema.sql`, `data.sql`, `public-data.sql`, `roles.sql`). La restauration `public` est prouvée ; la restauration Auth complète ne l'est pas.
- La migration `20260713000100` ne modifie ni donnée ni corps de fonction : elle ajuste uniquement deux `search_path`. Revenir à l'état précédent réintroduirait le défaut runtime et n'est donc pas recommandé.

## Blocages avant production

- LOT 13 complet non exécuté ;
- scanner strict non pérenne ;
- tests réseau, hors-ligne, import et concurrence manquants sur le cloud ;
- privilèges `SECURITY DEFINER` non qualifiés ;
- restauration Auth complète non prouvée ;
- aucun rapport QA manuel complet ;
- aucune promotion production autorisée par ce rapport.

## Conclusion

**Staging non validé.** Le socle automatisé du commit `fba4d926…` est vert et cohérent sur tous les composants déployés, sans échec final ni donnée réelle. La validation complète demandée par le LOT 13 reste inachevée tant que la matrice obligatoire non exécutée, le scanner pérenne, la revue des privilèges et la restauration complète ne sont pas soldés.
