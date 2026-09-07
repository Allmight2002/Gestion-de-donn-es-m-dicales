# MedData — instructions permanentes

## Contexte et sources

MedData (`registre-clinique`) est une PWA React/TypeScript/Vite avec Supabase. Le cloisonnement identité, données analytiques et documents bruts est une propriété de sécurité. Utiliser uniquement des données fictives tant que le cadre juridique et éthique n'est pas validé.

Pour une décision d'architecture, consulter `docs/architecture.md`; pour une procédure spécialisée, utiliser l'index `docs/README.md`. Lire seulement les documents utiles à la tâche. Le schéma versionné est dans `supabase/migrations/`, les Edge Functions dans `supabase/functions/`, les politiques Storage dans `supabase/storage.sql`. Les commandes actuelles sont dans `package.json`.

## Invariants

- Ne jamais exposer de secret, de `service_role`, de donnée sensible ou d'erreur interne brute au frontend ou dans les logs.
- La base et l'autorisation serveur garantissent sécurité, intégrité, RLS, idempotence et concurrence; l'UI seule ne suffit pas.
- Ne pas modifier une migration potentiellement appliquée. Créer une migration horodatée additive et compatible; préserver données, provenance et interfaces.
- Sur conflit de version, préserver tous les inputs locaux, éviter toute écriture ou suppression partielle, et signaler un conflit structuré nécessitant rechargement ou résolution explicite.
- Préserver les modifications utilisateur hors périmètre. Ne pas committer, pousser, fusionner, déployer, appliquer de migration distante ou modifier le cloud sans demande explicite.

## Travail et coordination

Choisir la solution complète la plus simple répondant au besoin actuel. Continuer les étapes et vérifications autorisées jusqu'au résultat demandé; une première implémentation n'est pas un arrêt automatique. Examiner les informations disponibles avant de demander une décision métier encore ambiguë. Rapporter les limites sans déclarer exécuté un contrôle qui ne l'a pas été.

Pour un travail substantiel comportant des parties indépendantes, déléguer avec le skill `orchestrate`. Les petites tâches et les étapes étroitement couplées restent directes. Le coordinateur possède l'intégration et la fin de tâche; chaque modification couplée, notamment migration/RPC/appelants, a un seul responsable d'écriture. L'investigation et la revue indépendantes peuvent se dérouler en parallèle. Les missions de validation restent en lecture seule. Respecter les limites du runtime et transmettre les restrictions essentielles à chaque agent.

## Vérification

Commencer par les tests et le lint pertinents pour les fichiers et comportements touchés, puis élargir selon le risque. Vérifier la cible locale/jetable avant tout script ou test qui écrit des données. Ne pas lancer de tests contre la production.

Après une nouvelle migration en implémentation: `npm run schema`, inspection du snapshot, puis `npm run schema:check`. En revue seule, vérifier sans régénérer. Pour un build de production, `VITE_USE_SIGNED_READ=true` est requis; ne pas contourner ce garde-fou. Les commandes détaillées et cas de readiness sont dans `meddata-release-check`.

## Skills

Source canonique: `.agents/skills/`; `.claude/skills/` est une copie de compatibilité. Modifier la source puis synchroniser les copies avec `python .agents/sync-skills.py` (vérification), puis `python .agents/sync-skills.py --apply`. Les copies modifiées séparément sont signalées comme conflits et ne sont pas écrasées.

- `orchestrate`: collaboration pour les travaux substantiels indépendants.
- `apply-audit-lot`: implémenter un lot identifié.
- `validate-audit-lots`: vérifier des corrections en lecture seule.
- `meddata-db-safety`: règles détaillées selon le risque base/autorisation/intégrité.
- `meddata-release-check`: readiness au niveau explicitement demandé.
- `resoudre-simplement`: arbitrer une complexité ou plusieurs approches; inutile pour une retouche courante.
