# Guide de découverte du produit

> Pour un(e) ami(e) ingénieur(e) qui veut **essayer le produit fini** (le site déployé) et donner
> un avis, sans avoir besoin de lire le code. Si vous préférez plutôt lire le code et juger
> l'architecture ou la sécurité, allez directement à
> [guide-relecture-externe.md](guide-relecture-externe.md) — c'est un parcours différent.

## 1. Le produit, en deux minutes

MedData est un **registre clinique orienté recherche** : l'objet central est le **patient**, pas
l'étude. Un médecin crée une base, y saisit des patients et leurs rencontres (consultations,
hospitalisations, suivis) selon un modèle de variables qu'il choisit ou construit. Les données
peuvent aussi être importées depuis un fichier, ou collectées par un collaborateur puis
structurées par un curateur avant validation.

**Contrainte permanente : le site ne contient que des données fictives.** Aucun cadre juridique
ni éthique n'est encore validé pour des données réelles de patient — n'y saisissez donc jamais de
vrai nom, vraie date de naissance, vrai téléphone ou vraie adresse, même en test.

## 2. Où tester, et avec quel compte

Site déployé : **https://gestion-de-donn-es-m-dicales.vercel.app**

Les identifiants de compte (médecin, curateur…) vous sont donnés **directement**, pas dans ce
fichier — le dépôt est public. Demandez-les si vous ne les avez pas encore.

## 3. Règles pendant le test

- **Uniquement des données inventées.** Noms, dates de naissance, téléphones : tout doit être
  fictif.
- **Préfixez tout ce que vous créez par `QA-`** (patient `QA-001`, groupe `QA-groupe`, jeu de
  variables `QA-…`) — ça permet de distinguer vos essais des données de démonstration déjà en
  place, et de nettoyer facilement ensuite.
- **Ne supprimez que ce que vous avez créé vous-même.** Ne touchez pas aux données de démo
  existantes.
- Gardez si possible la **console du navigateur ouverte** : une erreur rouge (JS) ou une requête
  réseau en échec (4xx/5xx) est souvent le signal le plus direct d'un problème.

## 4. Dans quel ordre explorer

Le détail étape par étape (avec ce qui est attendu à chaque clic) est déjà écrit dans
[qa-parcours-site.md](qa-parcours-site.md) — suivez-le directement, dans cet ordre :

1. **§2-3** : préambule technique + diagnostic de déploiement (à faire en premier — dit tout de
   suite si quelque chose côté cloud n'est pas à jour, avant de juger le reste).
2. **§4** : parcours principal en tant que médecin propriétaire — navigation, thème, une base et
   ses onglets, création de patients/rencontres, jeux de variables et import, groupes, cohortes
   et exports, gestion des accès, journal.
3. **§5** : parcours curateur, si un compte curateur vous a été donné.
4. **§6 / §6bis** : mode hors-ligne, puis coopération à deux comptes (invitation, accès partagé,
   édition simultanée) si un second compte médecin vous a été donné.
5. **§7** : quelques tests de sécurité côté navigateur (URL directes sans y avoir accès — le
   résultat attendu est un refus silencieux, pas une erreur qui plante).

Si vous avez plus de temps et voulez une couverture exhaustive fonctionnalité par fonctionnalité
(plutôt qu'un seul parcours guidé), [checklist-fonctionnalites-site.md](checklist-fonctionnalites-site.md)
liste tout, domaine par domaine, avec un découpage en sessions courtes.

> Ces deux documents ont été écrits à l'origine pour cadrer un agent QA automatisé : le format
> « rapport » et le découpage en sessions de 22 minutes qu'ils proposent sont pensés pour ça.
> Vous n'êtes pas obligés de vous y plier — l'ordre et le contenu des étapes restent valables
> pour une exploration humaine, prenez ce qui vous est utile.

## 5. Ce qui est déjà connu (inutile d'y passer du temps)

La liste des points déjà identifiés (et leur statut) est tenue dans
[guide-relecture-externe.md §5](guide-relecture-externe.md#5-ce-qui-est-déjà-connu-ne-perdez-pas-de-temps-dessus).
Ce qui n'y figure pas nous intéresse.

## 6. Comment nous faire un retour

Par ordre d'utilité :

1. **Un bug reproductible** : les étapes exactes pour le retrouver, ce qui était attendu, ce qui
   s'est passé (capture si visuel).
2. **Un endroit où vous vous êtes senti perdu** ou où le texte affiché était ambigu — c'est
   souvent aussi utile qu'un bug.
3. **Un avis sur l'ergonomie ou la cohérence** d'un parcours, même sans anomalie précise.

Merci du temps que vous y consacrez.
