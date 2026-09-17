# État de référence du dépôt — 16 septembre 2026

> **Périmètre de cette synthèse.** Elle décrit le code et les migrations du checkout
> `codex/spec-evolution-formulaire` à `699b449`, avant la présente mise à jour documentaire.
> Elle ne prouve ni l'état d'un déploiement, ni une exécution navigateur, ni une autorisation
> d'utiliser des données réelles. Les preuves de cible restent dans leurs rapports datés et doivent
> être rejouées pour le commit effectivement livré.

> **Règle de lecture.** Le code, les migrations et le
> [schéma généré](schema-etat-final.md) prévalent sur les descriptions manuelles. Cette mise à jour
> a exécuté `npm.cmd run schema:check` avec succès ; elle n'a appliqué aucune migration distante ni
> interrogé de ressource cloud.

## Socle constaté dans le checkout

| Élément | État de source |
|---|---|
| Migrations | 148 fichiers ; la dernière incluse dans le schéma généré est `20260912160000_ux_patient_identity_search.sql` |
| Schéma `public` généré | 50 tables, 328 fonctions, 64 policies RLS, 79 triggers |
| Fonctions Edge déployables | 8 : `signed-read`, `inspect-upload`, `finalize-upload`, `cleanup-upload`, `reconcile-quarantine`, `generate-export`, `create-mission-account`, `purge-deleted-base` |
| Données autorisées | Fictives uniquement. Le cadre juridique et éthique pour des données réelles n'est pas validé. |

## Évolutions locales postérieures aux anciens instantanés d'août

- **Blocs cliniques et collecte diagnostique.** Les spécifications L51 à L56 décrivent du code
  implémenté localement mais non déployé ; L57 (reprise et notifications) reste à cadrer. Voir
  [la collecte diagnostique](spec-collecte-diagnostique.md) et son guide de test.
- **Blocs réutilisables.** L58, L59 et L60 sont implémentés localement. L60 reconnecte une règle
  d'activation par le chemin de règles existant, sans nouvelle migration ni voie d'écriture
  parallèle. Les preuves locales détaillées et leurs limites figurent dans
  [spec-blocs-reutilisables.md](spec-blocs-reutilisables.md).
- **Correctifs UX.** Les lots UX-0 à UX-16 ne forment plus un backlog vierge : le suivi distingue
  les livraisons locales, les validations locales et les limites qui restent à vérifier dans un
  navigateur ou sur une cible. Les brouillons de travail, la recherche nominative contrôlée, la
  création groupée de règles et les rubriques communes versionnées y sont notamment recensés. Voir
  [suivi-correctifs-ux.md](suivi-correctifs-ux.md), pas seulement la spécification initiale.
- **Hors connexion.** Le code inclut le contrôle de disponibilité de la coque PWA et le parcours
  *intake-only*. Le workflow de release configure actuellement un build de démonstration ; cette
  configuration de source ne prouve pas qu'un bundle particulier est déployé. Les preuves O6/O7,
  la revue de risque et toute autorisation de données réelles restent séparées et ouvertes.
- **Formulaires à venir.** L'évolution d'un formulaire dans sa base (E0 à E7), le formulaire papier
  vierge (PAP-0 à PAP-5) et les groupes répétables (L66 à L71) sont spécifiés, non implémentés.

## Ce qui ne doit pas être déduit de ce document

- Une migration ou un test local présent dans le dépôt ne démontre pas qu'une cible Supabase ou une
  Edge Function porte la même version.
- La configuration `demo` de l'offline n'est ni une preuve de service worker prêt sur un appareil,
  ni une autorisation clinique. Les identités éventuellement présentes dans la file *intake-only*
  restent une exception strictement fictive et bornée.
- Les audits, décisions, exercices de reprise et validations de staging restent des preuves datées :
  ils ont été conservés sans réécrire leurs constats historiques.
- Le volet [juridique](juridique/README.md) suit son propre cycle de validation ; aucune conclusion
  juridique n'est créée par une mise à jour technique.

## Lire ensuite

1. [architecture.md](architecture.md) pour la carte du système et les frontières de sécurité.
2. [suivi-correctifs-ux.md](suivi-correctifs-ux.md) pour les preuves locales UX et leurs limites.
3. [securite-mode-hors-ligne.md](securite-mode-hors-ligne.md) avant toute manipulation du mode
   offline, puis [feuille-route-offline-saisie.md](feuille-route-offline-saisie.md) pour O6/O7.
4. Les rapports de validation adaptés au commit et à l'environnement lorsque l'objectif est une
   release, plutôt que cette synthèse de source.
