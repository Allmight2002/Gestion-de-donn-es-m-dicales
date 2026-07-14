# Rapport d’audit consolidé — MedData

**Date :** 10 juillet 2026  
**Référence auditée :** branche `main`, commit `29030bc`  
**Décision finale : non prêt pour la production clinique.**

Le projet est techniquement solide sur la RLS, les RPC et la séparation des données, mais un défaut critique d’export, plusieurs pertes de données possibles et des prérequis d’exploitation non satisfaits empêchent l’usage avec des données médicales réelles. Il reste utilisable comme pilote à données fictives avec réserves.

## 1. Synthèse

| Niveau | Nombre | Principaux domaines |
|---|---:|---|
| Critique | 1 | Intégrité scientifique des exports |
| Élevé | 8 | Export, import, concurrence, atomicité, fichiers, déploiement, hors-ligne |
| Moyen | 3 | Suppression, modèles, tests et dépendances |

## 2. Carte du projet

- React 18, TypeScript strict, Vite/PWA, 31 routes.
- Repositories dans `src/data`, logique métier dans `src/domain`, 67 fichiers d’écrans.
- Supabase : 86 migrations, 31 tables avec RLS, 58 politiques finales, 47 triggers et 187 fonctions.
- Trois zones de données : identité, analytique et documents bruts.
- Quatre buckets privés et cinq Edge Functions.
- Service ClamAV séparé.
- Tests DB sur PostgreSQL réel embarqué et tests UI jsdom.

### Frontières de sécurité principales

- La zone identité contient notamment les noms, dates de naissance, coordonnées et pièces jointes cliniques.
- La zone analytique contient les codes patients, données structurées, rencontres et âges calculés.
- Les documents bruts et le cycle de curation constituent une troisième zone restreinte.
- Le frontend utilise uniquement la clé Supabase anonyme ; la clé `service_role` est limitée aux scripts et Edge Functions.
- Les octets des fichiers sont protégés séparément par les policies de `storage.objects` et délivrés par URL signée.

## 3. Constats prioritaires

### 3.1 L’export scientifique est silencieusement incomplet et l’âge est ambigu

- **Criticité :** Critique
- **Domaine :** export, intégrité scientifique, traçabilité
- **Fichiers et lignes :** `supabase/functions/generate-export/index.ts:133-154`, `:160-205`, `:236-257`
- **Comportement actuel :** l’export utilise uniquement `base.current_template_version_id`. Les versions historiques des patients et rencontres sont ignorées. Il exporte aussi `age_value` sous le nom `age_at_encounter`, sans `age_unit`.
- **Comportement attendu :** exporter l’union déterministe des variables réellement présentes dans la cohorte, conserver leurs versions et toujours associer la valeur d’âge à son unité.
- **Scénario :** une cohorte contient des dossiers v1 ; une variable est supprimée ou renommée en v2. L’export produit avec la version courante omet les valeurs v1 sans erreur. Un âge `6` est par ailleurs indifféremment interprétable comme six jours, six mois ou six ans.
- **Impact :** fichier scientifiquement incomplet, non reproductible et potentiellement mal interprété ; `export_log.template_versions` devient faux.
- **Cause probable :** la génération Edge récente a été construite autour de la seule version courante de la base.
- **Correction recommandée :** relire `patient.template_version_id` et `encounter.template_version_id`, charger toutes les définitions correspondantes, préserver les clés historiques et exporter `age_value` avec `age_unit`.
- **Tests à ajouter :** cohorte v1/v2, variable retirée ou renommée, libellés dupliqués, âges en jours/mois/années, CSV et XLSX, vérification de `export_log.template_versions`.
- **Certitude :** élevée.
- **Historique :** régression récente introduite avec l’export Edge serveur du 9 juillet 2026.

### 3.2 Les exports restent falsifiables depuis un client authentifié

- **Criticité :** Élevée
- **Domaine :** sécurité, intégrité, stockage
- **Fichiers et lignes :** `supabase/migrations/20260616090400_rls.sql:131-134`, `supabase/storage.sql:150-155`, `supabase/migrations/20260616098000_upload_tickets.sql:59-99`, `supabase/migrations/20260616098500_server_generated_exports.sql:14-25`
- **Comportement actuel :** un utilisateur doté de `can_export_data` peut encore créer un ticket, déposer un CSV/XLSX arbitraire et insérer directement un `export_log`. Le trigger le marque seulement `client` et l’UI ne distingue pas clairement ce fichier des exports serveur. Le CSV serveur ne neutralise pas non plus les cellules commençant par `=`, `+`, `-` ou `@`.
- **Comportement attendu :** seuls les composants serveur doivent pouvoir créer un fichier et une trace d’export conservé.
- **Scénario :** un collaborateur forge un fichier ou injecte une formule dans une valeur clinique ; un autre utilisateur le télécharge depuis l’historique.
- **Impact :** falsification de données scientifiques, fichier trompeur et risque de formule CSV à l’ouverture.
- **Cause probable :** la voie historique d’export client a été conservée après l’introduction de la génération serveur.
- **Correction recommandée :** supprimer les écritures client sur le bucket et `export_log`, réserver la création au service serveur et neutraliser les formules CSV.
- **Tests à ajouter :** refus du ticket et de l’insert direct avec JWT, distinction de génération dans l’historique, cas de CSV injection.
- **Certitude :** élevée.
- **Historique :** faiblesse historique non fermée par la migration récente.

### 3.3 La reprise d’un import chunké peut condamner définitivement le lot

- **Criticité :** Élevée
- **Domaine :** import, interruption réseau, idempotence
- **Fichiers et lignes :** `src/screens/member/ImportData.tsx:153-189`, `supabase/migrations/20260616098600_import_source_idempotence.sql:109-131`, `:290-301`
- **Comportement actuel :** après interruption, l’UI recommence au premier chunk dans le même lot. Les hashes déjà inscrits provoquent des erreurs, tandis que `row_count` est réincrémenté et peut dépasser `expected_rows`.
- **Comportement attendu :** reprendre exactement aux lignes non traitées ou reconnaître idempotemment les lignes déjà réussies du même lot.
- **Scénario :** la réponse du premier chunk de 300 lignes est perdue ; le serveur a validé le chunk, puis le retry le renvoie.
- **Impact :** lot partiellement écrit, impossible à clôturer, avec une reprise manuelle dangereuse.
- **Cause probable :** incohérence entre la boucle client historique et la provenance source ajoutée récemment.
- **Correction recommandée :** gérer la progression côté serveur par numéro de ligne, ou ne pas recompter les hashes déjà réussis.
- **Tests à ajouter :** réponse perdue après commit, refresh, reprise du même lot et clôture exacte sans doublon.
- **Certitude :** élevée.
- **Historique :** régression récente liée à la migration de provenance du 9 juillet 2026.

### 3.4 Les éditions concurrentes d’un patient s’écrasent

- **Criticité :** Élevée
- **Domaine :** concurrence, intégrité clinique
- **Fichiers et lignes :** `src/screens/member/EditPatient.tsx:41-80`, `src/data/patients.ts:414-418`, `supabase/migrations/20260616093200_field_attrs_and_patient_edit.sql:78-107`
- **Comportement actuel :** `update_patient` remplace tout le JSON sans paramètre `expected_updated_at`, contrairement à `update_encounter`.
- **Comportement attendu :** détecter le conflit et imposer un rechargement ou une fusion explicite.
- **Scénario :** deux médecins ouvrent le même patient ; chacun modifie un champ différent ; la seconde sauvegarde restaure aussi les anciennes valeurs des autres champs.
- **Impact :** perte silencieuse d’une correction clinique.
- **Cause probable :** le verrou optimiste n’a été implémenté que pour les rencontres.
- **Correction recommandée :** exposer `patient.updated_at`, ajouter `p_expected_updated_at` à la RPC et verrouiller la ligne avant comparaison.
- **Tests à ajouter :** deux updates depuis le même timestamp, conflit garanti, puis fusion ou rechargement.
- **Certitude :** élevée.
- **Historique :** dette historique.

### 3.5 La création « patient + soumission de curation » n’est pas atomique

- **Criticité :** Élevée
- **Domaine :** création, curation, atomicité
- **Fichiers et lignes :** `src/screens/member/NewPatient.tsx:114-142`, `src/data/curation.ts:293-300`
- **Comportement actuel :** le patient est créé par une RPC, puis la soumission par une seconde transaction.
- **Comportement attendu :** patient, soumission et tâche doivent être créés dans une transaction unique et idempotente.
- **Scénario :** la deuxième RPC échoue ou sa réponse est perdue ; le patient existe, mais le retry est refusé par l’unicité du code.
- **Impact :** patient orphelin, demande bloquée et risque de recréation sous un autre code.
- **Cause probable :** orchestration d’un flux métier critique dans le navigateur.
- **Correction recommandée :** créer une RPC transactionnelle avec clé d’idempotence.
- **Tests à ajouter :** échec de la seconde étape, réponse perdue, double clic et retry après refresh.
- **Certitude :** élevée.
- **Historique :** comportement historique.

### 3.6 Un timeout d’inspection produit une issue ambiguë et des doublons

- **Criticité :** Élevée
- **Domaine :** upload, inspection antivirus, robustesse réseau
- **Fichiers et lignes :** `src/data/attachments.ts:124-160`, `src/data/curation.ts:322-355`, `src/screens/member/AddImage.tsx:59-78`
- **Comportement actuel :** l’objet Storage et la ligne métier sont persistés avant l’attente d’`inspect-upload`. Une réponse perdue est présentée comme un échec, alors que le document peut déjà exister ou être accepté.
- **Comportement attendu :** distinguer un échec de persistance d’une inspection en attente et permettre une reprise idempotente.
- **Scénario :** ClamAV termine, mais la réponse réseau disparaît ; l’utilisateur réessaie et crée un second chemin aléatoire.
- **Impact :** doublons, fichiers `pending`, consommation Storage et confusion de curation.
- **Cause probable :** absence de clé d’opération et ambiguïté entre commit et réponse.
- **Correction recommandée :** retourner l’ID dès la persistance, afficher l’état pending et permettre la réinspection de la ligne existante.
- **Tests à ajouter :** timeout avant et après verdict, refresh et retry pour pièce jointe et document brut.
- **Certitude :** élevée sur le comportement ; le déclencheur réseau reste hypothétique.
- **Historique :** pipeline remanié récemment sans traiter ce cas.

### 3.7 L’inspection antivirus stricte n’est pas déclarée active en production

- **Criticité :** Élevée
- **Domaine :** sécurité opérationnelle, fichiers
- **Fichiers et lignes :** `supabase/functions/signed-read/index.ts:20-30`, `docs/brief-audit-prochain.md:41-49`
- **Comportement actuel :** le brief indique que le scanner passe par un tunnel temporaire et que la production ne force pas encore `require_server_inspection=true`. Hors mode strict, `accepted_client` reste lisible.
- **Comportement attendu :** toute lecture clinique doit exiger un verdict serveur `accepted`.
- **Scénario :** un document Office/PDF malveillant est téléversé puis téléchargé par un curateur sans verdict serveur.
- **Impact :** distribution de contenu malveillant à des utilisateurs internes.
- **Cause probable :** scanner non hébergé durablement.
- **Correction recommandée :** hébergement stable, activation coordonnée DB/Edge/frontend et gate `env:check:cloud`.
- **Tests à ajouter :** EICAR staging, panne scanner, héritage `accepted_client`, redémarrage et quarantaine.
- **Certitude :** élevée sur l’état documenté ; l’état cloud doit être confirmé manuellement.
- **Historique :** préalable d’exploitation, pas une régression du code.

### 3.8 La release ne garantit pas la cohérence frontend/Supabase

- **Criticité :** Élevée
- **Domaine :** CI/CD, configuration, déploiement
- **Fichiers et lignes :** `vite.config.ts:25-43`, `.github/workflows/ci.yml:23-53`, `docs/deploiement.md:20-39`, `:70-127`
- **Comportement actuel :** le build exige `VITE_USE_SIGNED_READ`, mais pas l’URL ni la clé anon Supabase. Migrations, `storage.sql`, Edge Functions, `env:check:cloud` et E2E staging ne forment pas une release obligatoire coordonnée.
- **Comportement attendu :** vérifier l’environnement complet, promouvoir le frontend en dernier et disposer d’un rollback testé.
- **Scénario :** frontend promu avant la migration ou avec une Edge absente ; le build passe mais l’application est inutilisable.
- **Impact :** indisponibilité générale ou rupture de parcours.
- **Cause probable :** outils de prévol existants mais non reliés à un gate de release.
- **Correction recommandée :** pipeline staging puis production, contrôle du drift DB/Storage/Edge et promotion finale du frontend.
- **Tests à ajouter :** variables absentes, migration en retard, Edge non déployée et rollback.
- **Certitude :** élevée pour le dépôt ; état distant invérifiable.
- **Historique :** dette actuelle de déploiement.

### 3.9 Les données analytiques hors-ligne restent en clair dans le navigateur

- **Criticité :** Élevée pour des données réelles
- **Domaine :** confidentialité locale, PWA
- **Fichiers et lignes :** `src/data/offline.ts:89-113`, `:159-209`, `:235-245`, `:254-290`
- **Comportement actuel :** les snapshots cliniques sont stockés en clair pendant sept jours ; l’outbox contenant les corrections est conservée après déconnexion sans TTL. Le filtrage `ownerUserId` est une séparation applicative et non une barrière contre DevTools ou un accès local.
- **Comportement attendu :** protéger les données locales selon un modèle de menace clinique et les purger de façon déterministe.
- **Scénario :** poste partagé sous le même profil navigateur ou appareil perdu.
- **Impact :** exposition locale de données pseudonymisées mais médicales.
- **Cause probable :** fonctionnalité hors-ligne conçue pour l’isolation UI, sans chiffrement local.
- **Correction recommandée :** désactivation par défaut en contexte clinique, chiffrement lié à une clé de session ou d’appareil, TTL de l’outbox et politique MDM.
- **Tests à ajouter :** logout, changement de compte, expiration, appareil partagé et outbox abandonnée.
- **Certitude :** élevée.
- **Historique :** comportement historique.

### 3.10 Les échecs de suppression sont silencieux

- **Criticité :** Moyenne
- **Domaine :** robustesse, retour utilisateur
- **Fichiers et lignes :** `src/screens/member/DeleteWithReason.tsx:36-42`, `src/screens/member/PatientDetail.tsx:183-190`
- **Comportement actuel :** le dialogue lance `void onConfirm`, ferme immédiatement et n’attend pas le rejet.
- **Comportement attendu :** attendre la réponse, conserver le motif et fermer uniquement après succès.
- **Scénario :** réseau coupé ou permission révoquée au clic.
- **Impact :** l’utilisateur croit l’action terminée alors que la donnée demeure ; rejection non gérée.
- **Cause probable :** composant conçu en fire-and-forget.
- **Correction recommandée :** état `busy/error`, `await onConfirm` et fermeture après succès.
- **Tests à ajouter :** rejet RPC, double clic et révocation concurrente.
- **Certitude :** élevée.
- **Historique :** comportement historique.

### 3.11 La création et le clonage des jeux de variables ne sont pas transactionnels

- **Criticité :** Moyenne
- **Domaine :** modèles, cohérence, maintenabilité
- **Fichiers et lignes :** `src/data/templates.ts:109-146`, `:192-220`, `src/screens/member/TemplateFromFile.tsx:60-87`
- **Comportement actuel :** création du modèle, de sa version et de chaque champ via des écritures séparées.
- **Comportement attendu :** création ou clonage bulk dans une transaction unique.
- **Scénario :** panne au champ 17 sur 30 ; un modèle partiel demeure et un retry en crée un second.
- **Impact :** modèles incomplets et doublons.
- **Cause probable :** orchestration multi-écritures côté client.
- **Correction recommandée :** RPC bulk transactionnelle avec clé d’idempotence.
- **Tests à ajouter :** rollback au milieu du lot, retry et création de base optionnelle.
- **Certitude :** élevée.
- **Historique :** primitives historiques, parcours étendu récemment.

### 3.12 Les Edge Functions critiques échappent aux contrôles statiques et E2E UI

- **Criticité :** Moyenne
- **Domaine :** tests, qualité du code, dépendances
- **Fichiers et lignes :** `supabase/functions/generate-export/index.ts:1-5`, `eslint.config.js:14-18`, `vitest.workspace.ts:7-45`
- **Comportement actuel :** les Edge Functions utilisent `@ts-nocheck`, sont exclues d’ESLint et ne sont pas couvertes par un vrai E2E navigateur. Les tests d’export portent sur une autre implémentation dans `src/domain/export.ts`. L’Edge utilise aussi `xlsx@0.18.5`, version affectée par la ReDoS SheetJS ; l’exploitabilité précise dans le chemin d’écriture n’a pas été démontrée.
- **Comportement attendu :** vérifier statiquement et tester contractuellement le code réellement déployé.
- **Scénario :** l’implémentation de domaine reste verte tandis que l’Edge dérive ou qu’un parcours réel casse après navigation ou refresh.
- **Impact :** régressions non détectées dans les fonctions les plus privilégiées.
- **Cause probable :** séparation des runtimes Vite et Deno sans pipeline spécifique.
- **Correction recommandée :** `deno check`, lint Edge, tests des cinq fonctions, mise à jour ou remplacement de SheetJS et petit E2E Playwright staging.
- **Tests à ajouter :** export multi-version, uploads, cleanup, reconciliation, login, rôles, refresh et offline.
- **Certitude :** élevée pour l’absence de contrôles ; exploitabilité SheetJS à confirmer.
- **Historique :** dette actuelle.

## 4. Points forts vérifiés

- RLS activée sur les 31 tables ; aucun contournement d’autorisation majeur démontré.
- Cloisonnement identité, analytique et documents bruts bien conçu.
- `service_role` absent du frontend et aucun secret réel suivi par Git.
- Fonctions `SECURITY DEFINER` généralement associées à un `search_path` fixe.
- Upload tickets, chemins par base, quarantaine physique et URL signée auditée bien structurés.
- Verrou optimiste déjà correct pour les rencontres.
- CI locale exige typage, lint, tests et recherche de secrets dans le bundle.
- Documentation technique et QA particulièrement complète.

## 5. Vérifications exécutées

| Vérification | Résultat |
|---|---|
| `npm run typecheck` | Réussi |
| `npm run lint` | Réussi sans avertissement |
| `npm test` | Réussi, exit 0, en 12 min 42 s |
| État Git après audit | Worktree propre |
| Build | Non relancé : aurait modifié `dist`, contraire à la lecture seule |
| `npm audit` | Endpoint npm inaccessible |
| Interrogation supplémentaire du catalogue PostgreSQL | Timeout ; migrations déjà appliquées avec succès par les tests |
| E2E staging/ClamAV cloud | Non exécuté |

La suite produit néanmoins des avertissements `act(...)`, React Router v7, routes de test absentes et navigation jsdom non simulée.

## 6. Limites de l’audit

- Trois des quatre sous-agents ont été interrompus par une limite de crédits avant restitution. Le quatrième audit fonctionnel a abouti ; les périmètres manquants ont été repris manuellement par l’agent principal.
- Aucun accès au projet Supabase cloud, à Vercel, aux protections GitHub, aux sauvegardes, au SMTP, au MFA ni au scanner réellement déployé.
- Les vrais fichiers `.env`, `.env.local` et `.env.staging` n’ont pas été lus.
- Le résultat staging `13/13` documenté le 9 juillet 2026 n’a pas été revalidé.
- L’audit npm exhaustif n’a pas pu être réalisé à cause de l’indisponibilité de l’endpoint.

## 7. Notes

| Axe | Note | Justification principale |
|---|---:|---|
| Sécurité | 6/10 | RLS solide ; exports client falsifiables, mode antivirus non strict et cache local en clair |
| Architecture | 6/10 | Bonne séparation ; workflows critiques encore orchestrés dans le navigateur |
| Qualité du code | 7/10 | TypeScript strict et lint verts ; Edge non typées et erreurs parfois ignorées |
| Fonctionnalités | 6/10 | Couverture riche ; plusieurs parcours échouent mal sous panne ou concurrence |
| Base de données | 7/10 | Contraintes, RLS et RPC poussées ; défauts de reprise et verrou patient absent |
| Tests | 6/10 | Suite DB/UI large ; aucun vrai E2E navigateur et couverture Edge insuffisante |
| Performance | 6/10 | Pagination présente ; export charge des listes entières avec de grands filtres `.in(...)` |
| Maintenabilité | 6/10 | Repositories injectables ; duplication export domaine/Edge et 86 migrations complexes |
| Robustesse | 5/10 | Non-atomicité, réponses perdues et suppressions silencieuses |
| Préparation production | 4/10 | Scanner durable, release coordonnée, monitoring, sauvegardes testées et MFA non prouvés |

## 8. Ordre de correction recommandé

1. Corriger l’export multi-version et les unités d’âge.
2. Fermer définitivement les écritures client d’exports.
3. Corriger la reprise d’import dans le même lot.
4. Ajouter le verrou optimiste patient.
5. Rendre atomiques patient, soumission et tâche de curation.
6. Rendre les uploads et inspections idempotents.
7. Héberger durablement ClamAV et activer le mode strict.
8. Mettre en place un gate de release coordonné frontend, DB, Storage et Edge.
9. Définir la politique de sécurité du mode hors-ligne.
10. Ajouter les tests Edge et E2E navigateur.

## 9. Tests indispensables

- Export d’une cohorte mélangeant plusieurs versions de jeu de variables.
- Export d’âges en jours, mois et années.
- Refus des exports et uploads scientifiques directs depuis un JWT utilisateur.
- Reprise du même lot après réponse perdue sur un chunk déjà validé.
- Mise à jour concurrente d’un patient.
- Échec entre création patient et soumission de curation.
- Timeout d’inspection avant et après verdict ClamAV.
- Suppression rejetée après révocation de permission.
- Lecture hors-ligne sur panne Supabase avec `navigator.onLine === true`.
- Parcours navigateur multi-rôles contre staging.

## 10. Vérifications manuelles avant production

- État réel et ordre des migrations Supabase cloud.
- Checksum et application réelle de `supabase/storage.sql`.
- Déploiement et version des cinq Edge Functions.
- Activation cohérente de l’inspection stricte dans la DB, les Edge Functions et le frontend.
- Hébergement durable et supervision de ClamAV.
- Test de sauvegarde puis restauration.
- MFA, SMTP, alerting, centralisation des erreurs et rotation des secrets.
- Région d’hébergement, DPA, base légale, consentement et validation éthique.
- Protections de branche et gates de déploiement GitHub/Vercel.

## 11. Conclusion

### Problème critique

- Export scientifique incomplet, ambigu et non reproductible lorsque plusieurs versions de jeu de variables sont présentes.

### Problèmes élevés

- Falsification possible d’exports depuis un client autorisé.
- Reprise d’import same-batch défectueuse.
- Perte de modifications concurrentes patient.
- Création patient et curation non atomique.
- Issue ambiguë des uploads lors d’une réponse perdue.
- Inspection antivirus stricte non déclarée active en production.
- Release frontend/Supabase non coordonnée.
- Données analytiques hors-ligne conservées en clair.

### Cinq corrections prioritaires

1. Export multi-version et unités d’âge.
2. Suppression de la voie d’export client.
3. Reprise d’import idempotente dans le même lot.
4. Verrou optimiste patient.
5. Atomicité patient, curation et uploads.

### Risques avant production

- Résultats scientifiques incomplets ou faux.
- Perte silencieuse de corrections.
- Fichiers non inspectés ou dupliqués.
- Fuite locale de données médicales.
- Incompatibilité entre frontend, migrations, Storage et Edge Functions.

### Améliorations non bloquantes

- Nettoyer les avertissements des tests React.
- Paginer ou joindre côté serveur les grands exports.
- Découper les fichiers les plus volumineux.
- Réduire les désactivations de `react-hooks/exhaustive-deps`.
- Centraliser et persister les erreurs applicatives.

## Décision finale

**Non prêt pour la production.**

Un pilote limité à des données entièrement fictives reste possible avec réserves. Aucune donnée médicale réelle ne devrait être introduite avant correction du défaut critique, traitement des risques élevés et vérification manuelle des contrôles d’exploitation.
