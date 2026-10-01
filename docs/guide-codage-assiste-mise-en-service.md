# Guide — mettre en service et vérifier le codage CIM-11 assisté

> 🟢 **Document vivant**, rédigé le 1er octobre 2026 pour un administrateur non développeur.
> Il dit **quoi faire** pour que le codage assisté fonctionne dans une base, et **comment
> vérifier** qu'il fonctionne. Le fonctionnement détaillé est dans
> [codage-terminologique-assiste.md](codage-terminologique-assiste.md).
>
> ⚠️ **Données fictives uniquement** tant que le cadre juridique et éthique n'a pas validé
> l'envoi de texte clinique à un fournisseur d'IA ([juridique/](juridique/README.md)).

## 0. En bref

Le codage assisté n'est **pas une option à cocher par base** : chaque variable de type
**« Diagnostic du référentiel »** en bénéficie automatiquement. Il suffit donc :

1. que le **serveur** soit prêt (une seule fois par projet Supabase, §1) ;
2. que le **modèle de la base** contienne une variable « Diagnostic du référentiel » (§2) ;
3. de **vérifier** avec la liste de contrôle du §3.

| Qui | Quoi | Fréquence |
|---|---|---|
| Responsable technique | §1 : migrations, référentiel, fonction, secrets | une fois, puis à chaque mise à jour |
| Administrateur des modèles | §2 : variable de diagnostic dans le modèle | une fois par base |
| Testeur | §3 : liste de contrôle | après chaque mise en service ou changement de fournisseur |

---

## 1. Prérequis serveur (une seule fois par projet)

Ces opérations modifient le projet Supabase : à faire sur un projet d'essai d'abord, par la
personne qui en a la responsabilité ([deploiement.md](deploiement.md)).

### 1.1 Les migrations

Le projet doit porter ces trois migrations (elles sont dans `supabase/migrations/`) :

| Migration | Rôle |
|---|---|
| `20261001090000_terminology_assisted_coding.sql` | texte saisi et provenance du codage dans la valeur |
| `20261001120000_terminology_candidates_oe.sql` | recherche des candidats (« oe » = « œ ») |
| `20261001160000_terminology_candidates_acronyms.sql` | sigles de trois lettres (VIH, AVC…) |

Commande : `supabase db push` (voir [deploiement.md](deploiement.md) §1).

**Contrôle** — dans l'éditeur SQL de Supabase :

```sql
select version from supabase_migrations.schema_migrations
 where version in ('20261001090000', '20261001120000', '20261001160000');
```

Attendu : **3 lignes**.

### 1.2 Un référentiel de diagnostics actif

Les codes proposés viennent **uniquement** du référentiel importé, jamais de l'IA.

**Contrôle** :

```sql
select slug, version, is_active,
       (select count(*) from public.terminology_concept c where c.release_id = r.id) as concepts
  from public.terminology_release r;
```

Attendu : **une ligne avec `is_active = true`** et plusieurs milliers de concepts. Sinon, importer
le référentiel versionné (la commande écrit dans la base : `SUPABASE_DB_URL` doit viser le bon
projet) :

```bash
node scripts/import-terminology.mjs --file=supabase/terminology/diagnostics-fr.tsv.gz \
  --slug=cim11-fr --title="CIM-11 diagnostics (fr)" --activate
```

### 1.3 La fonction `code-terminology` et ses secrets

```bash
supabase functions deploy code-terminology --import-map deno.json
```

Secrets (Project Settings → Edge Functions → Secrets), **déjà posés pour DeepSeek** :

| Secret | Valeur |
|---|---|
| `TERMINOLOGY_LLM_PROVIDER` | `deepseek` |
| `DEEPSEEK_API_KEY` | la clé (jamais copiée ailleurs) |
| `TERMINOLOGY_LLM_MODEL` | facultatif (`deepseek-flash` par défaut) |

⚠️ **Aucun modèle DeepSeek n'est qualifié** à ce jour. Rejoués sur le jeu de calibrage fictif :

- **`deepseek-v4-pro`** (modèle configuré en production) a posé un code faux sans confirmation
  dans 1 passage sur 3. Sa latence médiane (8,7 s) dépasse le délai de 8 s de la fonction :
  environ la moitié des saisies retomberait sur le repli lexical après 8 s d'attente
  ([calibration-codage-terminologique-2026-10-01-deepseek-v4-pro.md](calibration-codage-terminologique-2026-10-01-deepseek-v4-pro.md)).
- **`deepseek-flash`** (valeur par défaut) a posé un code faux dans 2 passages sur 3
  ([calibration-codage-terminologique-2026-10-01-deepseek.md](calibration-codage-terminologique-2026-10-01-deepseek.md)).

Réservé aux essais sur données fictives, chaque code proposé étant vérifié.

Après tout changement de secret, **redéployer** la fonction (commande ci-dessus).

**Contrôle** : Supabase → Edge Functions → `code-terminology` doit apparaître, déployée après la
fusion du code DeepSeek (1er octobre 2026).

### 1.4 Le site

Le site (frontend) doit être construit et publié à partir d'une version qui contient le codage
assisté (branche `develop` du 1er octobre 2026 ou plus récente), selon
[deploiement.md](deploiement.md). Un ancien site n'affichera ni « Analyse du diagnostic… » ni
les propositions.

---

## 2. Dans une base : la variable de diagnostic

1. Se connecter avec un compte **administrateur** → **Administration des modèles**.
2. Ouvrir le modèle de la base. S'il est déjà publié : **Créer la version suivante** (les
   dossiers existants gardent leur version).
3. **Ajouter une variable** :
   - **Type** : « Diagnostic du référentiel » ;
   - libellé clair, par exemple « Diagnostic principal » ;
   - dans la rubrique dépliable **Terminologie**, cocher **Accepte plusieurs valeurs** si le médecin peut
     saisir plusieurs diagnostics (« pneumonie et insuffisance rénale ») : chacun deviendra une
     entrée séparée.
4. **Publier**.

Une variable « Diagnostic du référentiel » déjà présente n'a rien à changer : elle bénéficie du
codage assisté dès que le serveur (§1) et le site sont à jour.

Le codage assisté **ne s'applique pas** au constructeur de cohortes (recherche de patients) :
on y choisit un code dans la liste, sans texte libre. C'est voulu.

---

## 3. Vérifier que tout fonctionne

Sur une base d'essai (préfixe `QA-`), créer un patient fictif `QA-P1`, ouvrir une fiche contenant
la variable de diagnostic, et garder **l'onglet Réseau** du navigateur ouvert (F12). Pour chaque
ligne : écrire le texte, puis **cliquer ailleurs** (ou Entrée), attendre « Analyse du
diagnostic… », puis noter le résultat.

Les résultats « attendus » sont ceux du référentiel versionné. L'IA peut varier un peu : ce qui
**ne doit jamais** arriver est indiqué en gras.

| # | Texte saisi | Attendu | Ne doit jamais arriver |
|---|---|---|---|
| A1 | `HSD chronique spontané droit` | ✓ **8B02** Hémorragie sousdurale non traumatique, posé automatiquement | un code « traumatique » |
| A2 | `Méningiome frontal droit` | ✓ **2A01.0** Méningiomes (automatique ou « à confirmer ») | — |
| A3 | `Infection VIH` | **1C62** (maladie par le VIH) automatique ou à confirmer | un stade précis (1C62.0 à .3) posé seul |
| B1 | `Pneumonie franche lobaire aiguë` | proposition **à confirmer** (pneumocoque possible) | **CA40.07 posé sans confirmation** : le germe n'est pas écrit |
| C1 | `Hémorragie intracrânienne spontanée` | « Plusieurs correspondances possibles » : choisir, puis le choix est enregistré | **un code posé sans choix** |
| C2 | `AVC` | plusieurs propositions (ischémique / hémorragique) | **un code posé sans choix** |
| D1 | `Syndrome de Zorglub` | « Aucune correspondance CIM-11 fiable trouvée. », le texte reste enregistré | un code quelconque |
| E1 | variable à plusieurs valeurs : `Pneumonie franche lobaire aiguë associée à une insuffisance rénale sur terrain HIV` | plusieurs entrées numérotées, chacune avec son propre statut | **une saisie perdue ou bloquée** |

### 3.1 Comportements à vérifier

| # | Action | Attendu |
|---|---|---|
| F1 | Enregistrer la fiche juste après A1, avant la fin de l'analyse | rien n'est perdu : au pire le texte est enregistré non codé |
| F2 | Rouvrir la fiche C1 sans avoir choisi | les propositions réapparaissent ; la valeur enregistrée n'a pas changé |
| F3 | Après A1 : « Changer », choisir un autre diagnostic dans la liste | le texte d'origine reste visible ; statut `manually_modified` à l'export |
| F4 | Couper le réseau (onglet Réseau → Offline), saisir A1, cliquer ailleurs | « Hors connexion : le diagnostic est conservé tel qu'écrit, sans code. » ; la saisie n'est **jamais** bloquée |
| F5 | Taper `méning` et cliquer une proposition de la liste | choix classique, aucune analyse |

### 3.2 L'IA est-elle vraiment utilisée ?

Deux façons de le voir, sans aucune clé :

- **Onglet Réseau** : la requête `code-terminology` répond avec `"method": "ai_assisted"`.
  `"method": "lexical"` signifie que la fonction a utilisé son **repli sans IA** (clé absente ou
  refusée, DeepSeek injoignable ou trop lent) : la saisie fonctionne, mais moins bien.
- **Export** de la base : la colonne **« méthode de codage »** vaut `ai_assisted`.

Si c'est `lexical` : Supabase → Edge Functions → `code-terminology` → **Logs**. Le message
« interpretation indisponible, repli lexical » confirme que l'appel à l'IA a échoué (le détail
n'est volontairement pas journalisé). Vérifier alors les secrets du §1.3, redéployer, et le solde
du compte DeepSeek.

### 3.3 L'export

Exporter la base d'essai : pour chaque variable de diagnostic codée par l'assistant, des colonnes
supplémentaires apparaissent — **texte saisi**, **statut du codage**, **méthode de codage**,
**score de confiance**, **terme normalisé**, **publication terminologique**, **URI du concept**.
Attendu : A1 → statut `automatic`, B1 confirmé → `confirmed`, D1 → `unmatched` avec le texte.

### 3.4 Ce qui doit TOUJOURS être vrai

- La saisie n'est **jamais bloquée** par le codage (panne, hors connexion, texte inconnu).
- Le **texte du médecin est toujours conservé**, même quand un code est posé.
- **Aucun code n'est posé sans confirmation** quand le texte est ambigu ou quand le code ajoute
  une information non écrite (germe, stade).
- Un code proposé existe **toujours** dans le référentiel actif.

Un seul manquement à ces quatre règles est une anomalie bloquante : la signaler avec une capture
d'écran, le texte saisi et l'heure.

---

## 4. Relevé

| # | Date | Testeur | Résultat (OK / KO / BLOQUÉ) | Observation |
|---|---|---|---|---|
| 1.1 → 1.4 | | | | |
| A1 → E1 | | | | |
| F1 → F5 | | | | |
| 3.2 méthode | | | | |
| 3.3 export | | | | |

## 5. Dépannage rapide

| Symptôme | Cause probable | Que faire |
|---|---|---|
| Aucune analyse, seulement la liste de recherche | site ancien, ou variable d'un autre type | §1.4 ; vérifier le type « Diagnostic du référentiel » |
| « Codage indisponible pour le moment » à chaque saisie | fonction non déployée, ou migrations absentes | §1.1 et §1.3 |
| Toujours « Aucune correspondance » | aucun référentiel actif | §1.2 |
| `method: lexical` partout | clé DeepSeek absente, invalide ou sans crédit | §3.2 |
| Analyse lente (> 8 s) puis résultat moins bon | DeepSeek trop lent : repli automatique | réessayer ; si fréquent, changer de modèle |
