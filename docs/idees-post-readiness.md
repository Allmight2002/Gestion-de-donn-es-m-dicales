# Idées produit post-readiness — file d'attente

- Tenu à jour à partir des échanges avec le porteur (Dr Mbassi)
- Dernière mise à jour : 2026-07-26

Cette liste rassemble les **chantiers concrets** identifiés mais **volontairement non commencés**. Elle est distincte des études `docs/strategie-produit-post-mvp*.md` (stratégie de marché et positionnement) : ici, ce sont des évolutions techniques précises, prêtes à être spécifiées puis construites.

## Cadre commun — à lire avant toute mise en œuvre

Depuis la décision de cadrage du 2026-07-26, la fermeture de B1–B10 n'est plus
une précondition au **développement local**. B2, B6, B7 et B10 sont explicitement
différés : ils restent ouverts et bloquants pour les données réelles, le pilote
clinique et la production, mais ils n'interdisent plus de construire et tester
avec des données entièrement fictives.

La mise en œuvre suit
[`feuille-route-developpement-post-readiness.md`](feuille-route-developpement-post-readiness.md).
Toute modification produit un nouveau SHA à revalider ; les preuves antérieures
restent historiques pour leur propre SHA et ne sont pas transférées au nouveau
candidat.

Ordre obligatoire ajouté le 2026-07-26 : aucune idée ni correction UX de cette
file ne commence avant la fin de la Phase 0 puis la finalisation du chantier
antérieur **B3 → B4 → B8 → B1 → B9** sur un même candidat traçable.

## File d'attente

| # | Idée | Ampleur | Où c'est bloqué aujourd'hui | Spécification | Statut |
|---|---|---|---|---|---|
| 1 | **Comptes de mission** (rôle `saisisseur`) — un médecin confie la saisie d'une seule base à un étudiant, pour une durée limitée, en création seule, révocable | Moyenne (base + Edge + UI) | — | [`spec-comptes-mission.md`](spec-comptes-mission.md) | Spec écrite ; 6 décisions en attente du demandeur |
| 2 | **Observabilité des erreurs** — être notifié automatiquement des bugs et de leurs causes, sans exposer de donnée patient | Moyenne (front + base + alerting) | Fait partie du blocage monitoring **B5** | [`spec-observabilite-erreurs.md`](spec-observabilite-erreurs.md) | Spec écrite ; 7 décisions en attente du demandeur |
| 3 | **Bouton de suppression de base** — surface dans l'interface la suppression déjà existante côté serveur | Petite (surtout UI) | — | *(à spécifier si besoin)* | Noté ; capacité serveur complète, UI absente |
| 4a | **Registre « Diagnostic urgences » (noyau)** — base à listes contrôlées (diagnostic, motif, issue) pour produire des diagnostics analysables | **Nulle (configuration, pas de code)** | — | *(canevas à préparer)* | Signal terrain fort (directrice des urgences, Tchad) ; faisable dès maintenant en données fictives |
| 4b | **Terminologie diagnostique (programme)** — typeahead searchable, IDs stables, synonymes, attributs par diagnostic, CIM | Grande (sous-système + UI) | Modèle actuel plat, pas de référentiel gouverné | *(à spécifier)* | Phase 2, seulement si le pilote 4a convainc |
| 5 | **Bibliothèque de jeux de valeurs** — listes prêtes à l'emploi insérables en un clic dans un champ `select`/`multiselect`, au lieu de saisir chaque valeur à la main | Petite (front, contenu pur) | — | *(cadrée en séance le 2026-07-26)* | **Mécanisme livré le 2026-07-26** ; jeux cliniques à enrichir au fil des retours |

## Notes par idée

### 1. Comptes de mission

Répond au cycle de vie des comptes étudiants (l'étudiant soutient sa thèse, le compte reste). Le socle existe déjà (`base_access`, invitations expirables, révocation, audit) ; il faut un rôle global dédié `saisisseur`, une permission de création séparée, une expiration d'accès et une Edge Function d'invitation. Décision métier la plus sensible : l'étudiant crée-t-il des patients minimaux, ou remplit-il seulement des consultations ? Détail complet dans la spec.

### 2. Observabilité des erreurs

Aujourd'hui, les plantages d'écran sont captés localement (console + tampon de 20 entrées) mais **rien ne remonte** au porteur, et les erreurs d'arrière-plan ne sont pas captées du tout (filet global manquant). La spec décrit un puits interne privacy-safe (table dédiée, écriture par RPC, épuration), la réutilisation du canal d'alerte du monitor (B5) et un écran « État du système » réservé à l'admin. À traiter dans le même chantier que B5.

### 3. Bouton de suppression de base

Constat du 2026-07-22 : la fonction serveur `soft_delete_base` est **complète et sécurisée** (réservée au propriétaire, suppression douce et réversible, cascade sur tout le contenu, révocation des accès, audit ; migration `20260616096000_soft_delete_base.sql`, inscrite à l'allowlist B9). Mais elle n'est **appelée nulle part dans le frontend** — aucun bouton, aucun câblage. C'est donc un travail d'interface non terminé, pas une fonctionnalité manquante.

Points d'attention pour l'implémentation future :
- action destructrice (emporte tout le contenu de la base) → garde-fous forts : confirmation explicite, saisie du motif, idéalement retaper le nom de la base ;
- prévoir aussi le pendant « restaurer » : la suppression est réversible en base, mais il n'existe ni RPC ni UI de restauration ;
- réservé au propriétaire de la base (déjà imposé côté serveur).

### 4. Registre « Diagnostic urgences » (urgences, Tchad)

Signalé le 2026-07-22 : la directrice des urgences d'un hôpital tchadien décrit le même problème que le neurochirurgien — diagnostics notés en termes globaux (« autres pathologies »), donc non analysables. Deuxième signal terrain indépendant.

**Distinction essentielle** (à ne pas confondre) :
- **4a — noyau, faisable en configuration, zéro code** : le modèle de gabarits gère déjà les listes contrôlées (`select`/`multiselect` + `allowed_values`, contrôlées serveur, `tables.sql:56`). Une base à liste contrôlée (diagnostic, motif, issue) résout l'uniformité par construction et se monte dès maintenant (données fictives). Règle d'or : diagnostic = `select`, **jamais** texte libre.
- **4b — programme, nouvelle ingénierie** : autocomplétion searchable (le `select` est un menu déroulant, inadapté au-delà de ~30 items), référentiel gouverné (ID stable ≠ libellé, synonymes, workflow de validation, historique de fusion, CIM), et plusieurs diagnostics **avec attributs par diagnostic** (principal/associé, certitude, admission/sortie) — impossible dans le modèle plat actuel.

**Corrections MedData au design proposé par un LLM tiers** : l'âge ne se stocke pas via « date de naissance » en zone analytique (calculé depuis l'identité, ou saisi comme âge déclaré si registre sans identité) ; l'ID stable n'existe pas aujourd'hui (le `select` stocke le libellé → un renommage casse l'historique).

Voir l'analyse complète et la solution proposée dans l'historique de conversation (2026-07-22).

### 5. Bibliothèque de jeux de valeurs

Née d'une objection du porteur le 2026-07-26, en cadrant le registre urgences : dans MedData, c'est l'**utilisateur** qui crée sa base et ses champs. Lui demander de taper trente ou quarante diagnostics à la main dans un champ de saisie revient à le renvoyer au texte libre — c'est-à-dire au problème que la liste contrôlée devait résoudre.

Le blocage était plus concret encore que prévu : les valeurs autorisées se saisissaient dans un `<input>` d'**une seule ligne**, séparées par des virgules, ce qui rendait impossible toute liste un peu longue et interdisait toute valeur contenant une virgule.

Décisions prises en séance :

- **insertion par copie, jamais par référence** : les valeurs sont recopiées dans le champ. Modifier un jeu de la bibliothèque ne peut donc pas changer rétroactivement le sens de données déjà saisies, ni faire disparaître une valeur présente dans un historique. Le prix assumé : les améliorations ne se propagent pas aux bases existantes ;
- **une valeur par ligne**, avec repli sur les virgules si la saisie tient sur une seule ligne, pour ne pas casser les champs créés auparavant ;
- **fusion sans doublon** : insérer un jeu complète la saisie en cours au lieu de l'écraser ;
- **la CIM sert de source de rédaction, pas de système de codage** : on s'en inspire hors ligne pour écrire des listes conventionnelles et vérifier qu'on n'a rien oublié ; on ne stocke ni code, ni version de référentiel. Les libellés CIM sont écrits pour la classification, pas pour la saisie rapide. **Leur licence reste à vérifier avant toute reprise de contenu** ;
- **aucun jeu de diagnostics livré pour l'instant** : une nomenclature clinique ne s'invente pas depuis le dépôt. Un test garantit d'ailleurs que la bibliothèque n'en contient pas.

Ce chantier dépasse les urgences : tout service qui recueille des données en texte libre pose le même problème. La bibliothèque est le niveau d'abstraction qui les couvre tous, sans anticiper les spécialités.

Reste ouvert : la **soupape** (« Autre (préciser) ») et la **boucle d'amélioration** (relire les « Autre » et promouvoir les valeurs récurrentes), tous deux nécessaires pour qu'une liste locale reste vivante. Au-delà d'environ 30 items, un menu déroulant redevient pénible : cascade catégorie → diagnostic, ou typeahead (4b).

## Défauts / UX signalés (à corriger, pas des idées)

| # | Défaut | Cause | Ampleur | Statut |
|---|---|---|---|---|
| D1 | Supprimer un gabarit utilisé par une base **semble ne rien faire** : aucun retour visible au point de clic | Le serveur refuse correctement (`delete_template` → « Gabarit utilisé… », `20260616090700_template_admin.sql:171`). Côté UI (`src/screens/member/MyTemplates.tsx`), le **succès** affiche un toast visible, mais l'**échec** rend le message en haut de page (`:126`), loin du bouton (`:155`) ; de plus la confirmation « Oui/Non » reste ouverte car `setConfirmId(null)` n'est pas atteint | Petite (front) | **Corrigé le 2026-07-26** (lot P1B) |

Correction attendue : uniformiser le retour d'échec sur le même toast visible que le succès, près de l'action ; refermer/réinitialiser la confirmation même en cas d'échec. Vérifier si l'écran admin des modèles (`src/screens/staff/TemplatesAdmin.tsx`) partage le même motif (même méthode `deleteTemplate`).

**Correction appliquée le 2026-07-26.** La suppression passe par une fonction dédiée `removeTemplate` : succès et échec annoncent tous deux un toast (variante `warning` pour l'échec), et `setConfirmId(null)` est déplacé dans le `finally`, donc la confirmation se referme dans tous les cas. L'écran admin partageait bien le même motif — et n'avait même pas de toast de succès ; il est corrigé de la même façon, avec la nouvelle clé `admin.template_deleted`. Deux tests par écran couvrent le refus serveur et le succès.

| # | Défaut | Cause | Ampleur | Statut |
|---|---|---|---|---|
| D2 | **Vue mobile** : menu latéral ouvert, au défilement de la page un espace vide apparaît sous le panneau — **corrigé le 2026-07-26** (lot P1B) | Le menu mobile (`src/components/AppShell.tsx:200-209`) est une modale (`fixed inset-0`, `aria-modal`) mais **aucun verrou de défilement** n'est posé sur la page (aucune manipulation de `document.body`/`overflow` dans le composant). En scrollant, la page défile derrière la modale et la barre d'adresse du navigateur mobile se replie/déploie ; le panneau, dimensionné au viewport initial, ne correspond plus à la nouvelle hauteur → un espace (fond de page) apparaît sous le panneau | Petite (front) | Signalé 2026-07-22 ; à corriger après le gel |

Correction attendue : verrouiller le défilement de la page tant que le menu est ouvert (poser `overflow:hidden` sur `body` à l'ouverture, restaurer à la fermeture) — corrige l'espace et rétablit le comportement modal correct ; en complément, envisager une hauteur en unités de viewport dynamiques (`dvh`). À confirmer sur un vrai mobile/émulateur au moment de corriger.

**Correction appliquée le 2026-07-26.** Un `useEffect` pose `overflow:hidden` sur `body` à l'ouverture du tiroir et restaure la valeur précédente au démontage comme à la fermeture ; le conteneur de la modale passe en `h-[100dvh]`. Un test vérifie le verrou puis sa restauration. **Limite : la vérification sur un vrai mobile ou un émulateur n'a pas été faite** — jsdom ne reproduit ni le repli de la barre d'adresse ni les unités de viewport dynamiques. À confirmer visuellement avant de considérer D2 comme clos côté terrain.

## Comment utiliser cette liste

Chaque idée se traite désormais comme un lot borné selon la feuille de route :
spécification (si absente) → base/Edge avec `meddata-db-safety` si concernée →
UI → validation `validate-audit-lots`. Ajouter ici toute nouvelle idée au fil
des échanges, avec la même colonne « où c'est bloqué » pour distinguer les
dépendances techniques, les validations de staging et les décisions humaines.
