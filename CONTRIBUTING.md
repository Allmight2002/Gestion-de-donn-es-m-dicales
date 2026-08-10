# Contribuer — flux de travail Git & déploiement

Mémo pratique du fonctionnement du dépôt : les **branches**, le **quotidien**, comment **publier
une version**, et les **spécificités** de ce projet à ne pas oublier.

---

## 1. Les deux branches

| Branche | Rôle | Déploiement |
|---|---|---|
| **`main`** | Version **stable**. On n'y travaille **pas directement**. | **Production** (URL publique Vercel) |
| **`develop`** | Branche de **travail** : tout le développement s'y fait. | **Prévisualisation** (URL Vercel séparée) |

```
develop  ──● ──● ──● ────────●  (travail au quotidien)
              \                 \  Pull Request (release)
main      ●────────────────────────●  (stable, déployé en production)
```

---

## 2. Au quotidien (sur `develop`)

```bash
git status                 # vérifier qu'on est bien sur develop
# (si besoin) git switch develop

# … faire ses modifications …

git add -A
git commit -m "message clair de ce qui change"
git push
```

À chaque `push` sur `develop` :
- la **CI** se lance (typecheck + lint + **toute la suite de tests** : projet `db` pour la
  sécurité RLS et projet `web` pour le rendu + build) → coche verte = tout va bien ;
- **Vercel** crée une **prévisualisation** (URL dédiée) pour tester avant la production.

> Les compteurs de tests évoluent à chaque lot : ne pas les figer ici. La sortie de Vitest et
> `npm run manifest` font foi.

---

## 3. Publier une version (release `develop` → `main`)

Quand `develop` est **stable et validé** :

**Voie simple (interface GitHub) :**
1. GitHub → onglet **Pull requests** → **New pull request**
2. base = **`main`** ← compare = **`develop`** → **Create pull request**
3. Attendre la **CI verte**, puis **Merge**

Le merge sur `main` déclenche le **déploiement de production** Vercel.

> Variante en ligne de commande :
> ```bash
> git switch main && git merge develop && git push && git switch develop
> ```

---

## 4. Spécificités de CE projet (à ne pas oublier)

- **Migrations SQL** (`supabase/migrations/`) : le frontend se déploie tout seul (Vercel), **mais
  pas la base de données**. Après une release qui ajoute une migration, l'appliquer au cloud :
  ```bash
  npx supabase db push
  ```
- **Vercel — variable `VITE_USE_SIGNED_READ`** : doit valoir `true` sur **Production ET Preview**.
  Sinon le build échoue (garde-fou §5.7 : lecture de fichiers auditée obligatoire). Réglage :
  Vercel → Settings → Environment Variables.
- **Sécurité non négociable** : **données fictives uniquement** ; la clé `service_role` **jamais**
  dans le frontend (seules les variables `VITE_*` sont exposées).

---

## 5. Vérifier avant de pousser (recommandé)

```bash
npm test       # toute la suite (RLS + UI) — long : plusieurs dizaines de minutes sur un poste modeste
```
Plus rapide si vous ne touchez qu'un côté : `npm run test:rls` (sécurité) ou `npm run test:web`
(rendu). Après une migration, `npm run db:verify` rejoue le schéma depuis zéro en ~13 s, et
`npm run schema` régénère [docs/schema-etat-final.md](docs/schema-etat-final.md).

La CI revérifie de toute façon (typecheck + lint + tests + build) à chaque push et PR. Pour
reproduire le build de production en local : `VITE_USE_SIGNED_READ=true npm run build`.

> **Prérequis :** Node.js `>=22.22.0 <23` et npm `>=10 <12` (champ `engines` de `package.json`).

---

## 6. Aide-mémoire Git

| Commande | Effet |
|---|---|
| `git status` | Où suis-je ? quels fichiers modifiés ? |
| `git switch develop` / `git switch main` | Changer de branche |
| `git pull` | Récupérer les changements distants de la branche courante |
| `git add -A && git commit -m "…" && git push` | Enregistrer puis envoyer |
| `git log --oneline -5` | Voir les 5 derniers commits |

> Si `main` reçoit une correction directe un jour, resynchroniser `develop` :
> `git switch develop && git merge main`.

---

## 7. Documentation

- **[docs/README.md](docs/README.md)** — 📚 **index de toute la documentation** (distingue les
  documents vivants des preuves datées).
- Relecteur extérieur : [docs/guide-relecture-externe.md](docs/guide-relecture-externe.md)
- Vue d'ensemble : [docs/architecture.md](docs/architecture.md)
- Spécifications : [docs/cahier-des-charges-metier.md](docs/cahier-des-charges-metier.md) ·
  [docs/cahier-des-charges-technique.md](docs/cahier-des-charges-technique.md)
- Mise en route / déploiement : [README.md](README.md) · [docs/deploiement.md](docs/deploiement.md)

> **Quand vous modifiez le code, mettez à jour la doc dans le même commit** : après une migration,
> régénérer `docs/schema-etat-final.md` (`npm run schema`) ; après un changement de rôle, de
> permission ou de sous-système, corriger `README.md` et `docs/architecture.md`. Un document faux
> coûte plus cher qu'un document absent.
