# Cohérence des exports pendant les modifications concurrentes

Branche : `fix/export-snapshot-consistency`. Chantier indépendant de sauvegarde/restauration.

## Contrat

Une cohorte figée conserve ses membres, mais les valeurs de ses fiches peuvent évoluer.
Les comptes exacts et les contrôles de pagination ne détectaient pas un `UPDATE`, ni un
remplacement de membre à cardinalité constante. Les différentes lectures pouvaient alors
mélanger données, complétude et dictionnaire provenant de plusieurs états.

`generate-export` lit désormais un jeton avant toutes les lectures restituées, puis le
relit après la génération et le hash des octets, avant l'upload. Un changement entraîne
HTTP 409 / `EXPORT_SOURCE_CHANGED`, sans objet Storage ni ligne `export_log`.
L'utilisateur peut relancer l'export. Une RPC absente, en erreur ou un jeton invalide
refusent également l'export ; aucun retour au seul contrôle des comptes.

La première lecture de cohorte sert à vérifier l'autorisation. Le nom, le rattachement
et le type sont relus après le premier jeton, ainsi que le nom de base et sa révision
active. Un déplacement de cohorte vers une autre base est refusé.
Les exports réussis gardent le jeton dans `export_log.export_options.source_revision`.

Les compteurs sont incrémentés **dans la transaction de modification** : les changements
non validés restent invisibles aux autres connexions et un rollback annule le compteur.
Un aller-retour A → B → A validé augmente toujours le compteur. Les valeurs `bigint`
sont transportées en texte, sans arrondi JavaScript.

L'égalité des jetons établit une fenêtre sans modification validée des sources surveillées.
Après le dernier jeton, une saisie peut reprendre : seuls les octets déjà construits sont
publiés, sans nouvelle lecture clinique. Il s'agit d'un refus explicite en cas de concurrence,
pas d'une copie historique persistante ni d'une promesse que le fichier contient les valeurs
les plus récentes au moment du téléchargement.

## Migration additive

`supabase/migrations/20261002214653_export_source_revision_guard.sql` ajoute :

- le schéma interne `export_consistency` et la table de compteurs `revision` ;
- une fonction trigger interne et des triggers par instruction avec tables de transition ;
- la RPC `public.export_source_revision(uuid)`, `STABLE`, `SECURITY INVOKER`, réservée à `service_role`.

Aucune migration antérieure n'est modifiée, aucun backfill clinique n'est nécessaire.
Une ressource sans compteur vaut zéro et sa première modification est détectée.
La table est sous RLS, fermée aux clients ; `service_role` peut lire les compteurs mais
ne dispose pas d'INSERT/UPDATE/DELETE. Le trigger utilise des droits internes, un
`search_path` vide et n'est pas exécutable par les rôles applicatifs.

| Compteur | Sources surveillées |
| --- | --- |
| Par base | `base`, `patient`, `encounter`, `cohort`, `cohort_member`, `cohort_encounter_member`, `record_field_provenance` |
| Catalogue partagé | `template_version`, `template_field`, `template_section`, `template_common_group`, `validation_rule` |
| Acteurs partagés | `profiles` |
| Époque globale | `TRUNCATE` d'une table surveillée |

Les insertions/suppressions sont couvertes, ainsi que les cascades et les anciens/nouveaux
rattachements d'une instruction. Un import de 501 patients dans une base n'incrémente son
compteur qu'une fois. Les écritures d'une même base peuvent attendre brièvement la ligne
commune de compteur jusqu'à la fin d'une transaction d'écriture ; aucun verrou n'est
conservé par l'export. Les modifications du catalogue ou des profils refusent par prudence
les exports en cours d'autres bases. Une modification clinique d'une autre base ne les refuse pas.

La garantie suppose les triggers actifs et les lectures sur la base primaire. Une opération
d'administration qui désactive les triggers ou restaure des données doit suspendre les
exports. Le jeton identifie une fenêtre locale de cohérence, pas une preuve de restauration
ou un identifiant global entre deux instances/restaurations.

## Impact sur la restauration et vérification commune obligatoire

Les scripts de sauvegarde/restauration et leurs workflows restent inchangés dans cette branche.
La migration n'a été appliquée que sur des PostgreSQL embarqués jetables.

Le nouveau schéma **`export_consistency` doit exister dans la cible restaurée**, avec la
table, le trigger interne, ses ACL, les triggers des tables métier et la RPC publique.
Une sauvegarde limitée à `public` ne contient pas ce schéma interne. Dans la version de
référence, `coordinated-backup.mjs` produit des dumps de schéma/données sans filtre et un
fichier supplémentaire `public-data.sql` limité à `public` : leur couverture effective du
nouveau schéma doit être vérifiée dans le chantier restauration. Le snapshot généré
`schema-etat-final.md` ne décrit que `public` ; cette note décrit la dépendance interne.

Les valeurs historiques des compteurs ne sont pas nécessaires à une nouvelle fenêtre
d'export, tant que la restauration est hors ligne et que toutes les dépendances/triggers
sont correctement recréés. Restaurer uniquement `public-data.sql` sans reconstruire le
schéma interne serait insuffisant. Restaurer un ancien schéma impose de prévoir cette
nouvelle migration sur la cible isolée, avant de rendre les exports disponibles.

**Aucune intégration avant une vérification commune des deux branches**, sur une nouvelle
base isolée et avec des données synthétiques :

1. Vérifier que le dump/restauration final inclut ou recrée le schéma interne, la RPC et les 52 triggers.
2. Générer CSV et XLSX après restauration sans changement concurrent : succès, contenu et hash vérifiés.
3. Pendant les lectures, modifier une valeur, un membre de cohorte, un libellé et une provenance :
   refus explicite avant upload/journalisation, même si les comptes restent identiques.
4. Vérifier rollback, retour A → B → A, suppression en cascade, refus des clients de modifier les compteurs
   et fonctionnement avec le vrai rôle `service_role`/PostgREST.
5. Confirmer qu'aucun export n'est servi pendant la restauration ou la désactivation des triggers.

Cette vérification commune reste **à effectuer** ; cette branche n'est ni fusionnée ni déployée.

## Validation locale

- Tests DB ciblés : 82 tests passés dans 7 fichiers, dont 23 nouveaux tests de révisions.
  Ils utilisent des PostgreSQL embarqués neufs, des répertoires temporaires, des ports
  aléatoires et les données entièrement fictives du seed et des fixtures.
- Suite Edge `generate-export` : 219 tests passés, dont refus CSV/XLSX, erreur du jeton,
  mutation pendant la dernière lecture de provenance et changement de rattachement après autorisation.
- Vérification TypeScript, lint des fichiers modifiés, format Deno et snapshot de schéma régénéré.
- Le test d'upgrade installe la nouvelle migration après les anciennes migrations et le seed fictif.
  La génération du snapshot vérifie aussi l'application des migrations depuis zéro.

Le réseau de cet environnement bloque `cdn.sheetjs.com` et JSR : les validations ont utilisé
un outillage installé sous `/tmp/export-consistency-tools`, le module SheetJS 0.20.3 déjà
vendorié dans le dépôt, les assertions officielles Deno std 0.224.0 obtenues sur GitHub et une
import-map temporaire. Les déclarations SheetJS utilisées pour TypeScript proviennent de
la version officielle 0.18.5 sur GitHub. Aucun manifeste ni lockfile du dépôt n'a été modifié.
Les commandes habituelles du dépôt devront être rejouées dans l'environnement CI normal
avant intégration, en plus de la vérification commune de restauration.
