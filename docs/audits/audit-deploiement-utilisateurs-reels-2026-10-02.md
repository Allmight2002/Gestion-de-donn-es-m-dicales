# Audit de préparation aux utilisateurs et aux données réelles

Date : 2 octobre 2026. Référence examinée : `747adef4363ec4720e9ef79c9c9e3a691af6b057`.

## Avis

Le dépôt présente un socle de sécurité et d'intégrité conséquent. Je recommande maintenant un chantier de mise en service, puis un pilote fermé avec des utilisateurs représentatifs. Je ne recommande pas encore l'ouverture aux données patients réelles sur la seule base de cette revue.

Les principaux obstacles relèvent de l'exploitation, du traitement de texte clinique par l'IA et de la sécurité des sessions. Plusieurs mécanismes existent déjà : les activer et les exercer est plus utile que multiplier les fonctionnalités.

Cet audit est une revue statique ciblée du code et des configurations versionnées, pas un audit de pénétration ni une certification. Aucun accès aux projets Supabase, Vercel ou GitHub déployés n'était configuré dans cette session. L'état courant des secrets, des dérogations et des services externes n'a donc pas été vérifié. Les décisions anciennes sont des indications documentaires, pas une preuve de l'état cloud actuel.

## Acquis à préserver

- Contrôle des droits côté PostgreSQL, séparation identité/analytique/documents, comptes de mission bornés et tests de cloisonnement dans le dépôt.
- Validation serveur, versions de gabarits, traces de modification, imports idempotents et gestion des conflits.
- Lecture signée auditée, inspection/quarantaine et export serveur déjà implémentés.
- Sauvegarde coordonnée DB + octets Storage, chiffrement et outils de vérification/restauration déjà présents.
- Pipeline de release avec contrôles du commit, cible, dérive de schéma et preuves de staging.
- Journalisation client avec réduction des contenus sensibles (`src/lib/reportError.ts`).

Leur présence ne prouve pas leur activation ou leur réussite sur la cible qui recevra les utilisateurs.

## Priorités avant la première donnée réelle

| Priorité | Constat et preuve | Action recommandée | Critère de sortie |
|---|---|---|---|
| Bloquant | Le cron de `continuity-backup.yml:27` sélectionne seulement staging. Les alertes d'échec spécifiques sont également limitées au staging. | Automatiser les sauvegardes production, les alertes et le détecteur indépendant d'absence. Définir RPO/RTO avec le responsable métier. | Restaurer DB et fichiers dans une cible isolée ; vérifier liens, comptes, droits et intégrité ; mesurer perte maximale et durée réelle. Contrôler également le PITR du fournisseur. |
| Bloquant | `coordinated-release.yml:26` propose `paused` par défaut. Les gates de gouvernance, reprise et exploitation admettent l'absence de preuve avec `PILOT_EVIDENCE_WAIVER`. | Créer un profil de lancement réel refusant inspection suspendue et dispense de preuves. Réutiliser les validateurs existants. Héberger durablement le scanner. | Release du SHA choisi en strict, fichier sain accepté, EICAR refusé et illisible ; preuve cloud des trois drapeaux ; preuves actuelles validées. |
| Bloquant si IA externe active | `code-terminology/handler.ts:118-128` vérifie l'utilisateur puis appelle l'interpréteur configuré. Pas d'autorisation par base dans ce parcours. `index.ts` active l'interpréteur selon la présence d'une clé. | Ajouter une autorisation explicite côté serveur, par établissement/base, avec fournisseur approuvé et arrêt immédiat possible. Tant que le traitement externe n'est pas validé, garder le repli lexical. | Une clé configurée ne suffit plus à autoriser l'envoi. Base non autorisée, accès révoqué ou arrêt global : aucun appel externe. |
| Bloquant pour qualifier les transferts IA | `interpret.ts:24-29` retire e-mails, certaines dates et nombres. Il ne retire pas systématiquement noms, lieux ou descriptions identifiantes. | Traiter ce nettoyage comme réduction du risque ; définir les données transmissibles, pays, rétention, sous-traitants et accord de traitement. Limiter les textes transmis et prévenir la saisie d'identité. | Validation du traitement réel, essais de textes contenant noms/adresses, absence de contenu clinique dans les journaux. Ne pas présenter ce mécanisme comme une anonymisation garantie. |
| Haute, avant accès privilégié réel | `src/auth/backend.ts` expose connexion/mot de passe mais aucun parcours MFA ; aucun contrôle `aal2` identifié dans la recherche ciblée. Le validateur d'exploitation demande une preuve MFA organisationnelle. | Prévoir enrôlement, challenge et récupération MFA. Exiger le niveau adapté côté serveur pour opérations privilégiées ; protéger aussi Supabase, GitHub et hébergement. | Un compte privilégié à un seul facteur ne peut pas exécuter les opérations protégées, même par requête directe. Récupération testée. |
| Haute, avant postes partagés | Aucun verrouillage après inactivité identifié dans le parcours d'authentification. Les purges locales à la déconnexion existent déjà. | Ajouter verrouillage sur inactivité avec réauthentification et sauvegarde sûre de la saisie. Définir durée de session et comportement sur onglet masqué. | Sur poste partagé, identité et documents disparaissent au verrouillage ; reprise autorisée sans perte de travail ni exposition inter-comptes. |
| Bloquant organisationnel | `docs/deploiement.md`, `docs/derogations-readiness.md` et le dossier juridique réservent l'usage actuel aux données fictives. | Confirmer pays et établissements utilisateurs, responsable du traitement, base légale, notices, droits, conservation, transferts et validation éthique selon l'usage. | Dossier effectivement validé par les responsables compétents ; procédure de demande et d'incident exercée. Les modèles documentaires seuls ne suffisent pas. |

La planification staging n'est pas la preuve qu'aucune sauvegarde production n'existe ailleurs : il faut inventorier les mécanismes du fournisseur et les autres automatismes avant de conclure à une absence totale.

## Implémentations utiles avant un pilote utilisateur

1. **Limiter les appels coûteux.** Le handler de codage n'expose pas de quota applicatif par utilisateur/base. Ajouter limitation de débit côté serveur, plafond global, limite de concurrence et budget fournisseur avec alertes. Une session valide peut appeler directement l'API ; le debounce de l'interface ne protège pas les coûts. Tester la saturation et le repli lexical.
2. **Rendre l'état de saisie explicite.** Vérifier partout la distinction entre travail local, sauvegarde serveur réussie, conflit et échec. Une perte de réseau ou une erreur de stockage doit laisser à l'utilisateur une action compréhensible. Préserver les mécanismes de brouillons et conflits existants.
3. **Organiser le support.** Utiliser le journal technique existant pour produire un identifiant d'incident, une version de build et un canal de signalement. Éviter que les utilisateurs envoient des captures ou exports médicaux dans un canal général. Tester l'alerte jusqu'à sa réception et désigner un responsable et un suppléant.
4. **Préparer l'accueil des utilisateurs.** Provisionnement sans comptes de démo, invitations, récupération de mot de passe SMTP, expiration des missions, révocation et revue périodique des droits. Ajouter un parcours court de prise en main selon le rôle et une base d'exercice séparée.
5. **Définir le cycle de vie des données.** Vérifier suppression logique, purge des objets, exports, journaux et sauvegardes ; définir ce qui est récupérable et jusqu'à quand. La présence de `purge-deleted-base` ne règle pas à elle seule toute la politique de conservation.

## Tests terrain à exécuter sur une préproduction représentative

Utiliser des fixtures entièrement synthétiques représentant la complexité réelle, sans copier des dossiers patients. Chaque scénario doit laisser une preuve datée, associée au SHA déployé.

| Situation | Résultat attendu |
|---|---|
| Réseau interrompu pendant la sauvegarde, reprise et double clic | Aucune saisie silencieusement perdue ; aucun patient ou rencontre dupliqué ; statut exact et reprise explicite. |
| Deux utilisateurs modifient le même dossier | Conflit détecté et résolu ; aucune modification écrasée sans information ; auteur et modification traçables. |
| Droit identité/export retiré pendant une session ouverte | Les nouvelles requêtes sont refusées ; comportement des documents déjà ouverts et URL signées documenté et borné. |
| Mission expirée et onglet laissé ouvert | Accès refusé côté serveur ; état de travail expliqué à l'utilisateur. |
| Changement de compte sur ordinateur partagé | Aucun brouillon, aperçu ou cache du compte précédent accessible. |
| Doublons patient, code répété, identité incomplète, date impossible, CSV avec encodage inattendu | Anomalies signalées ; import partiel et reprise expliqués ; règles métier de rapprochement définies avec les utilisateurs. |
| Document trop volumineux, extension trompeuse, EICAR, scanner indisponible | Refus/quarantaine ; en strict, aucune lecture sans verdict ; reprise après panne supervisée. |
| IA indisponible, diagnostic ambigu, faux positif, quota atteint | Texte conservé ; repli sûr ; code douteux soumis au choix humain ; fournisseur et modèle identifiables pour l'évaluation. |
| Mise à jour PWA pendant saisie et retour à la version précédente | Proposition de mise à jour explicite ; saisie préservée ; compatibilité frontend/Edge/schéma vérifiée. |
| Perte du backend et restauration complète | DB + Storage restaurés ensemble ; droits corrects et fichiers ouvrables ; RPO/RTO mesurés. |
| Volume nominal, puis pic et croissance | Mesurer listes, recherche, sauvegarde, import/export et coûts sur fixtures à 1×, 5× et 10× le volume prévu, avec utilisateurs simultanés. |
| Téléphone modeste, écran étroit, réseau lent | Parcours critique complet sans commande inaccessible ; retours d'erreur lisibles. |

Les exports sont déjà paginés et bornés dans `generate-export/handler.ts`. Valider leurs limites au volume cible avant de décider d'un traitement asynchrone. Le succès sur une petite base ne suffit pas à estimer la capacité.

Le hors-ligne est actuellement interdit dans un build de production ordinaire par `scripts/offline-build-policy.mjs`. C'est un garde-fou existant. Si le pilote exige la saisie hors connexion, en faire un chantier distinct : appareil perdu, cache local, expiration, révocation impossible hors réseau, conflits, reprise et perte de saisies après TTL. Ne pas simplement lever le drapeau de build.

## Ordre de lancement proposé

1. **Préparer la cible réelle** : hébergement/région, gouvernance, séparation des fixtures, comptes, sauvegardes/alertes, inspection stricte et profil de release sans dispense.
2. **Sécuriser sessions et IA** : MFA privilégiée, verrouillage, autorisation explicite des transferts et quotas.
3. **Exercer les scénarios** sur préproduction ; refaire les parcours critiques sur le commit candidat, avec vérification des migrations, Storage et neuf Edge Functions présentes dans le dépôt.
4. **Pilote fermé** avec un établissement et un petit groupe représentatif. Collecter incidents, taux de sauvegarde réussie, conflits, erreurs d'import, temps des parcours et qualité du codage. Fixer les seuils et la décision d'arrêt avant le début.
5. **Élargir progressivement** après correction des incidents bloquants et revue avec les responsables métier et exploitation.

La confirmation systématique du codage IA est une option prudente pour le premier pilote réel ; l'automatisation peut ensuite être autorisée sur les catégories suffisamment évaluées. La calibration fictive existante ne prouve pas la qualité sur toutes les populations et spécialités futures.

## Vérifications effectuées et limites

Lecture des guides de déploiement, dérogations, continuité, exploitation et mise en service du codage ; inspection des workflows de release/sauvegarde/monitoring, du parcours d'authentification, de la politique hors-ligne, du journal client et des fonctions de codage/export.

Cinq assertions statiques ciblées réussies via Node : build hors-ligne ordinaire accepté en mode désactivé, mode démo non autorisé rejeté, sélection staging du cron, authentification avant codage, présence de l'appel à l'interpréteur. L'interface d'authentification a également été contrôlée pour l'absence d'entrée MFA. Ces vérifications caractérisent le code, pas le comportement d'un serveur déployé.

Les suites Vitest/Playwright, migrations et tests Edge n'ont pas été relancés : dépendances absentes du checkout, Node disponible 24.19.0 contre 22.x demandé par le projet, et aucune cible cloud authentifiée. Aucun service distant ni paramètre de production n'a été modifié. Aucun défaut RLS ou fuite exploitable n'est affirmé sur la seule base de cet audit.
