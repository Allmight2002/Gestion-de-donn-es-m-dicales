# MedData — instructions permanentes

## Contexte essentiel

MedData (`registre-clinique`) est une PWA React 19 + TypeScript strict + Vite, adossée à Supabase (PostgreSQL, Auth, RLS, Storage et Edge Functions). Le cloisonnement entre identité, données analytiques et documents bruts est une propriété de sécurité du produit. Utiliser uniquement des données fictives tant que le cadre juridique et éthique n’est pas validé. Pour l’architecture, lire `docs/architecture.md`.

## Chemins principaux

- `src/` : frontend, règles de domaine et accès aux données.
- `test/` : tests PostgreSQL/RLS et domaine ; `src/**/*.test.tsx` : tests web.
- `supabase/migrations/` : source de vérité versionnée du schéma.
- `supabase/functions/` : Edge Functions ; `supabase/storage.sql` : buckets et politiques Storage.
- `services/` : services annexes, notamment le scanner ClamAV.
- `scripts/` : validations et opérations explicites.
- `docs/` : architecture, déploiement et procédures spécialisées ; `docs/README.md` en est l’index et distingue les documents vivants des preuves datées.

## Règles toujours applicables

- Ne jamais exposer de secret, de `service_role`, de donnée médicale sensible ni d’erreur interne brute au frontend ou dans les logs.
- La base et l’autorisation serveur sont la source de vérité : ne pas déplacer sécurité, intégrité, RLS, idempotence ou contrôle de concurrence vers l’UI seule.
- Ne jamais modifier une migration susceptible d’avoir déjà été appliquée. Créer une nouvelle migration horodatée, additive et compatible avec les données existantes.
- Préserver les données, les interfaces compatibles et les modifications utilisateur hors périmètre.
- Ne pas committer, pousser, fusionner, déployer, appliquer de migration distante ni modifier le cloud sans demande explicite.
- Respecter le périmètre demandé et ne jamais déclarer exécutée une vérification qui ne l’a pas été.

## Resource usage policy

- Use one agent by default.
- Do not create subagents for routine tasks.
- Use no more than one read-only subagent for security, RLS, migrations,
  transactions, concurrency, idempotence, or possible data loss.
- Do not use multi-agent workflows solely to reduce cost.
- Keep repository exploration limited to the requested flow.
- Use concise final reports and do not reproduce full command logs.

## Validation générale

Commencer par les contrôles ciblés, puis élargir selon le risque :

`npm run typecheck` · `npm run lint` · `npm run test:web` · `npm run test:rls` · `npm test` · `npm run db:verify` · `npm run release:edge:check` · `npm run build`.

## Skills à charger selon la tâche

Utiliser les Skills sous `.claude/skills/` : `apply-audit-lot`, `validate-audit-lots`, `meddata-db-safety` et `meddata-release-check`. Leurs procédures détaillées ne doivent pas être recopiées ici.
