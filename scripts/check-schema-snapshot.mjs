// Garde de PR : le snapshot docs/schema-etat-final.md doit nommer la DERNIERE migration
// de supabase/migrations/. Le manifeste de deploiement (scripts/deploy-manifest.mjs)
// applique deja ce critere, mais seule la release l'executait : une PR qui ajoutait une
// migration sans regenerer le document passait la CI en vert et n'echouait qu'au moment
// du deploiement. Ce module porte donc le critere, et les deux gardes l'importent.
//
//   npm run schema:check   -> CONSTATE le retard (lecture de fichiers, aucun secret).
//                             La regeneration reste `npm run schema`, qui exige un
//                             PostgreSQL embarque et n'a pas sa place dans la CI de PR.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_FILE = 'docs/schema-etat-final.md';

// Les migrations sont horodatees : l'ordre lexicographique EST l'ordre d'application.
export function listMigrations(root = ROOT) {
  return readdirSync(join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
}

// -> { status: 'a-jour' | 'en-retard' | 'absent', expected, included }
// `included` vaut null si l'en-tete genere par `npm run schema` est introuvable : le
// document est alors traite comme EN RETARD, jamais comme valide.
export function schemaSnapshotState(root = ROOT) {
  const migrations = listMigrations(root);
  const expected = migrations[migrations.length - 1] ?? null;
  const path = join(root, SNAPSHOT_FILE);
  if (!existsSync(path)) return { status: 'absent', expected, included: null };
  const included = readFileSync(path, 'utf8').match(/Dernière migration incluse : `([^`]+)`/)?.[1] ?? null;
  return { status: included === expected ? 'a-jour' : 'en-retard', expected, included };
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const { status, expected, included } = schemaSnapshotState();
  if (!expected) {
    console.error('Aucune migration .sql dans supabase/migrations/ : etat inattendu du depot.');
    process.exit(1);
  }
  if (status === 'absent') {
    console.error(`Snapshot de schéma ABSENT : ${SNAPSHOT_FILE} n'existe pas.`);
  } else if (status === 'en-retard') {
    console.error(`Snapshot de schéma EN RETARD : ${SNAPSHOT_FILE} contient ${included ?? '(en-tête « Dernière migration incluse » introuvable)'}, attendu ${expected}.`);
  } else {
    console.log(`Snapshot de schéma à jour (${expected}).`);
    process.exit(0);
  }
  console.error(`→ lancer \`npm run schema\` puis committer ${SNAPSHOT_FILE} dans cette PR.`);
  process.exit(1);
}
