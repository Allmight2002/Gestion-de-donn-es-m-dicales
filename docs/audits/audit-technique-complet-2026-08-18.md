# Rapport d’audit technique — MedData

**Date de l’audit :** 18 août 2026  
**Dépôt :** `Allmight2002/Gestion-de-donn-es-m-dicales`  
**Branche auditée :** `develop`

---

## 1. Résumé exécutif

MedData présente un niveau d’ingénierie élevé pour un projet de cette taille, avec une architecture solide, une sécurité PostgreSQL/RLS particulièrement mature, une CI/CD complète, des contrôles d’accès granulaires, des Edge Functions structurées et une bonne séparation entre identité patient et données analytiques.

### Note globale

- **Qualité d’ingénierie du code : 8,8/10**
- **Niveau “enterprise-grade code” : 8,5–9/10**
- **Préparation actuelle à une production avec données cliniques réelles : 7,5–8/10**

La différence entre la qualité du code et la préparation production vient principalement de deux points :

1. le mode d’inspection antivirus peut être désactivé en production ;
2. certains brouillons cliniques sont persistés en clair dans `localStorage`.

---

## 2. Notes par domaine

| Domaine | Note | Commentaire |
|---|---:|---|
| Architecture générale | 8,5/10 | Découpage clair frontend / repositories / domaine / Supabase / Edge Functions. Quelques modules deviennent volumineux. |
| Qualité du code TypeScript/React | 8/10 | Typage sérieux, code généralement explicite, gestion des erreurs correcte. Quelques suppressions `exhaustive-deps`. |
| Authentification | 8,5/10 | Bonne gestion des sessions, logout hors-ligne et changement d’utilisateur. Petit défaut sur l’échec initial de `getSession()`. |
| Autorisation / RLS PostgreSQL | 9,5/10 | L’un des points les plus solides du projet : tests réels PostgreSQL, contrôles négatifs, RPC et `SECURITY DEFINER` audités. |
| Protection de l’identité patient | 9/10 | Bonne séparation identité / analytique, listes pseudonymisées et accès à l’identité limité. |
| Base de données / migrations | 9/10 | Migrations vérifiées depuis zéro, contraintes et logique serveur importantes. |
| Edge Functions | 8,5/10 | Validation des entrées, RLS + service role bien séparés, comportements fail-closed fréquents. |
| Gestion des fichiers / Storage | 8,5/10 en strict / 6/10 en paused | Le pipeline signé et audité est très bon. Le mode antivirus `paused` fait chuter fortement la note. |
| Imports | 8,5/10 | Gestion par lots, idempotence, détection des doublons et reprise assez sophistiquées. |
| Exports | 9/10 | Génération contrôlée, permissions, journalisation et protection contre les formules CSV/XLSX. |
| Comptes de mission | 9/10 | Très bonne conception : expiration, idempotence, génération cryptographique et credentials chiffrés. |
| Offline / PWA | 7,5/10 | Bon cloisonnement par compte et données analytiques seulement, mais le stockage local reste le point sensible. |
| Protection des données locales | 6,5/10 | Les brouillons cliniques en clair dans `localStorage` pendant 72 h sont la principale faiblesse de cette couche. |
| CI/CD | 9,5/10 | Excellente pour la taille du projet : TS, lint, RLS, migrations, Deno, build, dépendances, scanner ClamAV. |
| Supply chain / dépendances | 9/10 | Actions épinglées, audit npm strict, vérification SHA du code vendored. |
| Release / production | 7/10 | Très sophistiquée, mais le fait de pouvoir produire avec `inspection=paused` est une erreur de politique importante. |
| Sauvegarde / restauration | 8,5/10 | Beaucoup de précautions : cible vérifiée, chiffrement, image PostgreSQL épinglée, sauvegarde hors dépôt. |
| Performance | 8/10 | Pagination, lazy loading, RPC snapshot. Quelques gros écrans et risque mémoire avec images énormes. |
| Tests | 9/10 | Couverture fonctionnelle et sécurité particulièrement sérieuse. |
| Observabilité | 8,5/10 | Journalisation technique prudente vis-à-vis des données médicales et audit des lectures sensibles. |
| Gouvernance GitHub | 8/10 | Bonnes protections, mais mode mono-personne moins robuste qu’une vraie revue indépendante. |
| Maintenabilité | 8/10 | Bonne aujourd’hui, mais certains fichiers de 20–30 kB commencent à justifier une décomposition. |

---

## 3. Principaux constats

### P0 — Inspection antivirus désactivable en production

Le workflow de release permet un mode d’inspection `paused`, et celui-ci peut être utilisé avec une release de production.

Le problème est que ce mode ne se contente pas de modifier un affichage : il réduit réellement la politique de contrôle serveur des fichiers.

#### Risque

Un fichier pourrait être considéré comme utilisable après validation côté client sans verdict antivirus serveur strict.

#### Recommandation

Rendre impossible par construction :

```text
production + inspection=paused
```

Actions proposées :

- `inspection=strict` par défaut ;
- échec du workflow si `target=production` et `inspection != strict` ;
- `.env.production.example` configuré en `strict` ;
- réserver `paused` au staging et aux données fictives ;
- prévoir éventuellement un workflow “break-glass” séparé pour les cas exceptionnels.

**Sévérité : critique pour un usage clinique réel.**

---

### P1 — Brouillons cliniques en clair dans `localStorage`

MedData persiste des brouillons contenant des valeurs cliniques pendant jusqu’à 72 heures.

Exemple de structure :

```ts
interface EncounterDraft {
  encounterType: string;
  encounterDate: string;
  status: string;
  values: Record<string, unknown>;
}
```

Même si le nom des clés contient l’utilisateur et qu’une purge est faite au logout/changement de compte, les données restent lisibles en clair dans le profil navigateur.

#### Risque

Sur un poste hospitalier partagé ou compromis, des données cliniques peuvent être retrouvées localement.

#### Recommandation

Préférer :

```text
brouillon
  ↓
serveur Supabase
  ↓
RLS utilisateur/base
  ↓
expiration automatique
```

À défaut :

- réduire fortement le TTL ;
- rendre la récupération locale explicitement optionnelle ;
- purger plus agressivement ;
- éviter de considérer un chiffrement JavaScript local comme une protection suffisante si la clé reste accessible au même contexte applicatif.

**Sévérité : élevée.**

---

### P2 — Limite des images basée sur les octets, pas sur les dimensions

Les images sont limitées en taille de fichier, mais pas explicitement en largeur, hauteur ou mégapixels.

Une image très compressée mais énorme peut consommer beaucoup de mémoire une fois décodée.

#### Recommandation

Ajouter des limites :

- largeur maximale ;
- hauteur maximale ;
- nombre maximal de mégapixels ;
- libération explicite des ressources de décodage lorsque nécessaire.

**Sévérité : moyenne.**

---

### P2 — `react-hooks/exhaustive-deps` non bloquant

La règle est configurée en warning et plusieurs suppressions existent dans des écrans importants.

#### Risque

Des dépendances manquantes peuvent créer des stale closures ou comportements de synchronisation difficiles à détecter.

#### Recommandation

Passer :

```text
react-hooks/exhaustive-deps
```

de `warn` à `error`, puis traiter les exceptions une par une.

**Sévérité : moyenne.**

---

### P2 — Génération du code patient côté client

La génération du type :

```text
P-${existing + 1}
```

peut provoquer une collision si deux utilisateurs créent simultanément un patient.

La contrainte d’unicité en base empêche la corruption, mais un utilisateur peut recevoir une erreur.

#### Recommandation

Déplacer l’allocation du code patient dans PostgreSQL via une fonction/RPC transactionnelle.

**Sévérité : moyenne-faible.**

---

### P2 — Gestion incomplète de l’échec initial de `getSession()`

L’initialisation de session repose sur une Promise sans traitement explicite du rejet dans le chemin principal.

#### Risque

L’application peut rester dans un état de chargement ou produire un rejet non géré.

#### Recommandation

Ajouter une gestion explicite d’erreur, en conservant un comportement fail-closed.

**Sévérité : moyenne-faible.**

---

### P3 — Validation DOCX/XLSX approximative

La vérification s’appuie surtout sur la signature ZIP, ce qui ne garantit pas qu’un fichier soit réellement un DOCX/XLSX valide.

#### Recommandation

Vérifier la structure OOXML, notamment :

```text
[Content_Types].xml
word/
xl/
```

ou effectuer la validation côté serveur.

**Sévérité : faible.**

---

### P3 — Métadonnées d’upload persistées dans `localStorage`

Certaines clés d’idempotence d’upload contiennent des métadonnées comme scope, hash ou label.

#### Recommandation

Utiliser des clés locales opaques et nettoyer les métadonnées après finalisation.

**Sévérité : faible.**

---

## 4. Points particulièrement solides

### 4.1 RLS / PostgreSQL

C’est probablement la partie la plus mature du projet.

Les tests vérifient réellement :

- accès autorisés ;
- accès refusés ;
- isolation entre utilisateurs ;
- séparation identité / analytique ;
- refus d’`anon` ;
- révocation ;
- exports ;
- invitations ;
- RPC ;
- fonctions `SECURITY DEFINER` ;
- `search_path` ;
- ACL.

Le système présente une vraie défense en profondeur.

**Note : 9,5/10.**

---

### 4.2 Accès aux fichiers

En mode strict, le parcours est robuste :

1. authentification ;
2. récupération de l’utilisateur ;
3. application de la RLS ;
4. vérification du statut d’inspection ;
5. validation du chemin par rapport à la base ;
6. journalisation avant accès ;
7. refus de la lecture si l’audit échoue ;
8. URL signée de courte durée.

**Note : 9/10 en mode strict.**

---

### 4.3 Exports

Le pipeline d’export est bien sécurisé :

- génération contrôlée ;
- permissions ;
- journalisation ;
- accès par URL signée ;
- neutralisation des formules de tableur commençant par `=`, `+`, `-`, `@`.

**Note : 9/10.**

---

### 4.4 Comptes de mission

Le système actuel possède plusieurs bonnes propriétés :

- expiration ;
- justification d’accès à l’identité ;
- provisioning idempotent ;
- génération cryptographique ;
- mots de passe robustes ;
- chiffrement AES-GCM des credentials ;
- vérification du propriétaire de la base ;
- accès temporaire.

**Note : 9/10.**

---

### 4.5 CI/CD

La CI contrôle notamment :

```text
npm ci
dependency audit
TypeScript
ESLint
migrations depuis zéro
Edge Functions format/lint/typecheck/tests
tests PostgreSQL/RLS
tests React
build PWA
scan du bundle
scanner ClamAV
```

Les GitHub Actions importantes sont épinglées et certaines dépendances vendored sont vérifiées par hash.

**Note : 9,5/10.**

---

### 4.6 Authentification et changement de compte

Le logout et les changements d’utilisateur déclenchent des purges locales.

Le système tente également de nettoyer les sessions persistées si le logout réseau échoue.

C’est une bonne protection pour les postes partagés.

---

### 4.7 Headers navigateur

La configuration Vercel comporte notamment :

- CSP ;
- HSTS ;
- `nosniff` ;
- `frame-ancestors 'none'` ;
- `object-src 'none'` ;
- politique de referrer ;
- restrictions de permissions navigateur.

---

### 4.8 Performance

Les routes utilisent du lazy loading et la liste des patients en ligne est paginée.

Le parcours normal ne semble donc pas charger toutes les données patient en une seule fois.

---

### 4.9 Observabilité

Le système de remontée d’erreurs évite d’envoyer directement des messages bruts susceptibles de contenir des données médicales.

C’est un bon choix pour un produit médical.

---

## 5. Gouvernance GitHub

Les protections de branche et scripts de contrôle couvrent notamment :

- PR obligatoire ;
- checks CI obligatoires ;
- interdiction du force-push ;
- interdiction de suppression de branche ;
- protections appliquées aux administrateurs ;
- résolution des conversations ;
- environnements protégés.

Il existe néanmoins un mode mono-personne permettant d’assouplir certaines contraintes de revue indépendante.

### Recommandation

Avant un déploiement institutionnel important :

- introduire au moins un second reviewer humain pour les changements sensibles ;
- supprimer les dérogations mono-personne sur production ;
- conserver les approbations indépendantes pour les releases majeures.

---

## 6. Évaluation “enterprise-grade”

### Niveau atteint

| Axe | Évaluation |
|---|---|
| Architecture | Enterprise-grade |
| Sécurité applicative | Enterprise-grade |
| RLS / PostgreSQL | Très enterprise-grade |
| CI/CD | Enterprise-grade |
| Tests | Enterprise-grade |
| Gestion des accès | Enterprise-grade |
| Auditabilité | Enterprise-grade |
| Gestion des fichiers sensibles | Presque enterprise-grade |
| Maintenabilité | Enterprise-grade pour une petite équipe |
| Observabilité | Bonne, à renforcer |
| Exploitation production | Pas encore totalement enterprise-grade |
| Gouvernance / processus humain | Pas encore enterprise mature |

### Conclusion

Le code de MedData est clairement au-dessus du niveau :

- projet étudiant ;
- MVP simple ;
- SaaS amateur.

Il est aujourd’hui proche d’un niveau :

```text
SaaS professionnel        : oui
Enterprise-grade code     : oui, largement
Enterprise-ready product  : presque
Enterprise mature         : pas encore
```

Les écarts restants concernent principalement :

- hardening ;
- opérations ;
- gouvernance ;
- monitoring ;
- processus de production.

Ils ne nécessitent pas de reconstruction architecturale majeure.

---

## 7. Priorités recommandées

### Priorité 1

Interdire totalement :

```text
production + inspection=paused
```

### Priorité 2

Revoir la persistance des brouillons cliniques en `localStorage`.

### Priorité 3

Ajouter des limites de dimensions/mégapixels aux images.

### Priorité 4

Passer `react-hooks/exhaustive-deps` en erreur bloquante.

### Priorité 5

Déplacer la génération des codes patients vers PostgreSQL.

### Priorité 6

Gérer explicitement l’échec de `getSession()`.

### Priorité 7

Renforcer la validation DOCX/XLSX et nettoyer davantage les métadonnées d’upload locales.

### Priorité 8

Renforcer la gouvernance de production avec une revue indépendante.

---

## 8. Limites de l’audit

Cet audit est principalement un audit :

- du code présent sur GitHub ;
- de l’architecture ;
- des workflows ;
- de la CI ;
- des règles RLS ;
- des Edge Functions ;
- des migrations ;
- des mécanismes applicatifs visibles dans le dépôt.

Il ne constitue pas un pentest dynamique complet de l’environnement réellement déployé.

Les éléments suivants doivent être vérifiés séparément en production :

- configuration réelle de Supabase Auth ;
- secrets GitHub/Vercel ;
- rotation des secrets ;
- politiques Storage effectives ;
- exposition réseau du scanner ;
- paramètres réels des environnements ;
- sauvegardes réelles ;
- tests de restauration ;
- monitoring ;
- alerting ;
- procédures d’incident ;
- politiques opérationnelles hospitalières.

---

## 9. Verdict final

### MedData

**Qualité d’ingénierie : 8,8/10**

**Enterprise-grade code : 8,5–9/10**

**Préparation production clinique actuelle : 7,5–8/10**

**RLS / sécurité PostgreSQL : 9,5/10**

La base technique est solide et ne nécessite pas de refonte architecturale majeure.

Les deux corrections prioritaires avant un usage avec données cliniques réelles sont :

1. imposer l’inspection antivirus stricte en production ;
2. revoir la persistance locale des brouillons cliniques.

Après correction de ces deux éléments, MedData peut raisonnablement être considéré comme un candidat sérieux à une production clinique, sous réserve d’un audit final de l’infrastructure réellement déployée.
