# 11 — Charte d'utilisation de MedData et engagement de confidentialité

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider** ; signature obligatoire avant tout accès à des données réelles |
| S'applique à | Tout titulaire d'un compte : médecins, curateurs, administrateurs système, ainsi qu'aux personnes techniques ayant accès à l'infrastructure |
| Références | Code de déontologie des médecins (décret n° 83-166 du 12/04/1983) ; Code pénal, art. 310 (secret professionnel) ; lois n° 2024/017 et n° 2022/008 ; [PSSI (06)](06-politique-securite.md) |

---

## 1. Esprit de la charte

MedData donne accès à des données de santé de patients qui ont fait confiance à leurs
médecins. Chaque utilisateur est personnellement responsable de l'usage qu'il fait de
son compte et des données auxquelles il accède. La règle générale est simple :
**n'accéder qu'à ce qui est nécessaire à sa mission, n'en faire que l'usage prévu par
le protocole approuvé, et ne rien faire sortir des canaux prévus.**

## 2. Compte et authentification

- Le compte est **strictement personnel** : ne jamais partager son mot de passe, ne
  jamais laisser autrui utiliser sa session, ne jamais utiliser le compte d'un autre.
- Mot de passe fort et unique ; **MFA activée** ; signalement immédiat en cas de
  suspicion de compromission.
- Se **déconnecter** en fin d'utilisation (la déconnexion purge les données locales du
  navigateur).
- Verrouiller son poste dès qu'on le quitte ; **interdiction d'utiliser un poste
  public ou partagé** (cybercafé, ordinateur familial non maîtrisé) pour accéder à
  MedData.

## 3. Secret professionnel et confidentialité

- Toute personne accédant à MedData est tenue au **secret professionnel** (art. 310 du
  Code pénal : 3 mois à 3 ans d'emprisonnement ; déontologie médicale), y compris les
  non-soignants (curateurs, techniciens), par l'engagement en annexe.
- Ne jamais évoquer un patient identifiable en dehors du cadre autorisé ; ne jamais
  photographier, capturer ou copier un écran affichant la **zone identité** ou une
  image clinique.
- Les accès aux identités et aux documents sont **journalisés de manière
  infalsifiable** ; les journaux sont revus périodiquement.

## 4. Règles d'usage des données — les interdits absolus

1. **Interdiction de saisir des identifiants directs hors zone identité** : jamais de
   nom, coordonnées, numéro de dossier hospitalier ou date de naissance dans les
   variables analytiques, champs libres, commentaires, motifs de correction, questions
   de clarification ou noms de cohortes.
2. **Interdiction de téléverser un document non dé-identifié** : avant tout envoi en
   curation, retirer/masquer noms, dates de naissance, adresses, numéros de dossier et
   visages sur les documents sources. Le médecin soumetteur en est responsable.
3. **Interdiction de toute tentative de ré-identification** d'un patient à partir des
   données pseudonymisées (croisements, recoupements), sauf procédure légitime via la
   zone identité par un compte autorisé.
4. **Interdiction de contourner les mécanismes de l'application** : pas d'extraction
   par copie manuelle massive, capture ou automatisation ; les seules sorties de
   données autorisées sont les **exports officiels** (tracés, sans identité).
5. **Interdiction d'utiliser les données à d'autres fins** que la recherche approuvée
   (jamais à des fins commerciales, assurantielles, disciplinaires ou personnelles).
6. **Interdiction d'introduire des données réelles** tant que le cadre juridique n'est
   pas validé (règle produit : données fictives uniquement — la levée de cette règle
   fait l'objet d'une décision écrite du responsable du traitement).

## 5. Règles par rôle

- **Médecin propriétaire d'une base** : n'accorde à chaque collaborateur que les
  permissions **minimales** nécessaires ; revoit les accès tous les `[6 mois]` ;
  retire les accès dès la fin d'une collaboration ; répond aux demandes des patients
  ([procédure (07)](07-droits-personnes.md)).
- **Collaborateur invité** : n'utilise que les permissions reçues, pour la base et la
  finalité prévues ; ne redistribue jamais un export sans l'accord du propriétaire et
  du protocole.
- **Curateur** : structure fidèlement les documents ; s'il découvre un élément
  identifiant dans un document (nom lisible…), il **interrompt la structuration et le
  signale** (procédure incident) au lieu de le recopier ; ne cherche jamais à savoir
  qui est le patient.
- **Administrateur système** : n'a aucun accès aux données patients et ne doit jamais
  chercher à en obtenir ; gère comptes et gabarits ; applique le principe des quatre
  yeux pour toute action massive `[si second admin disponible]`.
- **Titulaire d'un export** (`can_export_data`) : stocke le fichier sur un support
  chiffré de l'établissement, le partage uniquement avec les personnes prévues au
  protocole, le détruit en fin d'analyse (la version de référence hashée reste dans la
  plateforme).

## 6. Signalement

Tout utilisateur signale **sans délai** à `[contact incident]` : anomalie d'accès
(données visibles qui ne devraient pas l'être), document identifiant, perte/vol d'un
appareil connecté, suspicion de compromission de compte, ou erreur de sa part.
**Un signalement de bonne foi n'est jamais sanctionné** — c'est le silence qui l'est.

## 7. Manquements

Selon la gravité : rappel, retrait de permissions, suspension ou suppression du compte
(décision du responsable du traitement) ; signalement à l'employeur/l'Ordre des
médecins le cas échéant ; poursuites civiles et pénales prévues par les lois
n° 2024/017 (jusqu'à 10 ans d'emprisonnement pour les atteintes les plus graves) et
art. 310 du Code pénal. Les journaux d'audit font foi.

## 8. Vie de la charte

Remise et expliquée avant le premier accès (avec la session de sensibilisation PSSI
§14) ; signée en deux exemplaires ; re-signée à chaque révision majeure. Version en
vigueur publiée dans l'application `[écran À propos / documentation]`.

---

## ANNEXE — Engagement individuel de confidentialité et de bon usage

*(Une page, à signer avant le premier accès. Original conservé par le référent
protection des données ; copie remise au signataire.)*

Je soussigné(e) **`[nom, prénom]`**, exerçant en qualité de **`[fonction]`** au sein de
**`[établissement/service]`**, disposant d'un compte MedData avec le rôle
**`[medecin / curateur / system_admin / accès technique]`** :

1. reconnais avoir reçu, lu et compris la **charte d'utilisation de MedData**
   (version `[1.0]` du `[date]`) et la politique de sécurité qui l'accompagne ;
2. m'engage à respecter le **secret professionnel** et la confidentialité de toute
   information dont je pourrais avoir connaissance via MedData, y compris après la fin
   de ma mission, conformément à l'article 310 du Code pénal et, le cas échéant, au
   Code de déontologie de ma profession ;
3. m'engage à utiliser mon compte de façon **strictement personnelle**, à n'accéder
   qu'aux données nécessaires à ma mission, et à n'utiliser les données qu'aux fins de
   recherche approuvées ;
4. m'engage à ne **jamais** tenter de ré-identifier un patient, à ne jamais introduire
   d'identifiant direct hors de la zone identité, à ne téléverser que des documents
   dé-identifiés, et à ne faire sortir aucune donnée hors des canaux prévus ;
5. m'engage à **signaler sans délai** tout incident, anomalie ou erreur au contact
   désigné ;
6. suis informé(e) que mes actions dans MedData sont **journalisées**, que ces journaux
   peuvent être audités, et que tout manquement m'expose aux sanctions prévues par la
   charte, par mon statut professionnel et par la loi.

Fait à `[lieu]`, le `[date]`, en deux exemplaires.

| | Nom | Date | Signature |
|---|---|---|---|
| L'utilisateur | | | |
| Pour le responsable du traitement | | | |
