// Import d'un referentiel de terminologie dans public.terminology_release / _concept.
//
// Le CONTENU n'est volontairement pas versionne dans le depot : la licence de reprise d'un
// referentiel tiers doit etre verifiee au cas par cas. Le script lit donc un fichier fourni
// en argument et n'ecrit rien d'autre dans le depot.
//
// Format attendu : TSV avec en-tete `Code, Title, ClassKind, DepthInKind`, encode en UTF-8
// ou en UTF-16 LE (l'export Windows produit ce dernier). La hierarchie est portee par les
// tirets qui prefixent le libelle, pas par DepthInKind qui compte la profondeur AU SEIN d'un
// type.
//
// Une colonne `BlockId` est acceptee si elle est presente : les regroupements n'ont pas de
// code de classification mais peuvent porter un identifiant technique (`BlockL1-1A0`). Il
// sert d'identifiant de repli, ce qui evite d'en inventer un. Les entrees qui n'ont ni l'un
// ni l'autre restent licites tant qu'elles ne sont pas proposables a la saisie.
//
// Ecriture en contexte privilegie (SUPABASE_DB_URL) : les clients n'ont que le droit de
// lecture sur ces tables.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * Lit un fichier texte, qu'il soit compresse ou non, en UTF-8 ou en UTF-16 LE.
 *
 * Le referentiel versionne dans le depot est compresse (2,3 Mo -> 436 Ko) ; un export
 * Windows brut arrive en UTF-16 LE avec BOM. Les deux doivent pouvoir etre importes sans
 * conversion prealable.
 */
export function readTextFile(path) {
  let buf = readFileSync(path);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  const utf16 = buf[0] === 0xff && buf[1] === 0xfe;
  // Le BOM est note \uFEFF plutot qu'insere tel quel : un caractere invisible dans le code
  // est illisible en relecture, et le lint le refuse a juste titre.
  return (utf16 ? buf.toString('utf16le') : buf.toString('utf8')).replace(/^\uFEFF/, '');
}

const KINDS = new Set(['chapter', 'block', 'category']);

/**
 * Chapitres ECARTES par defaut : une classification complete ne contient pas que des
 * diagnostics. Les « codes d'extension » a eux seuls pesaient 17 159 entrees sur 35 664 —
 * ce sont des qualificatifs (substances, medicaments, agents) que la classification
 * accroche a un diagnostic, jamais un diagnostic en soi. Les proposer a la saisie noyait
 * les vraies maladies sous des reponses comme « Antacides » ou « Composes de magnesium ».
 *
 * Les autres exclusions sont des decisions METIER prises par le porteur le 2026-07-26 :
 * causes externes et facteurs de recours decrivent le comment ou le pourquoi, pas la
 * maladie.
 *
 * Deux chapitres sont au contraire CONSERVES a sa demande explicite :
 *  - les symptomes et signes, parce qu'aux urgences un patient est recu pour une douleur
 *    ou une fievre bien avant qu'un diagnostic soit pose ;
 *  - les affections de medecine traditionnelle, pertinentes dans le contexte de deploiement.
 */
export const CHAPITRES_ECARTES = [
  "codes d'extension",
  'causes externes',
  'facteurs influant',
  'evaluation du fonctionnement',
  "codes d'utilisation particuliere",
];

/** Minuscules, accents et apostrophes ramenes a une forme comparable. */
function normaliser(texte) {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’ʼ]/g, "'")
    .toLowerCase()
    .trim();
}

/**
 * Transforme le TSV en concepts prets a inserer.
 *
 * Regles :
 *  - la profondeur vient du NOMBRE DE TIRETS qui prefixent le libelle ;
 *  - le parent est le dernier concept rencontre a la profondeur immediatement inferieure ;
 *  - une entree sans libelle est IGNOREE : elle serait invisible a la recherche. Les
 *    referentiels traduits en contiennent, la ou une section n'a pas ete traduite ;
 *  - seules les `category` munies d'un code sont proposables a la saisie : un chapitre ou un
 *    bloc structure le referentiel, il ne se choisit pas, et n'a d'ailleurs pas de code ;
 *  - un chapitre ECARTE emporte tout son contenu jusqu'au chapitre suivant.
 */
export function parseTerminologyRows(text, options = {}) {
  const ecartes = (options.excludedChapters ?? CHAPITRES_ECARTES).map(normaliser);
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = (lines.shift() ?? '').split('\t').map((h) => h.trim());
  const idx = {
    code: header.indexOf('Code'),
    blockId: header.indexOf('BlockId'), // facultatif
    title: header.indexOf('Title'),
    kind: header.indexOf('ClassKind'),
  };
  if (idx.code < 0 || idx.title < 0 || idx.kind < 0) {
    throw new Error('En-tete attendu : Code, Title, ClassKind, DepthInKind.');
  }

  const concepts = [];
  const skipped = { noLabel: 0, unknownKind: 0, excludedChapter: 0 };
  const parents = []; // dernier concept rencontre, par profondeur
  // Un chapitre ecarte emporte tout ce qui le suit, jusqu'au chapitre suivant.
  let dansChapitreEcarte = false;

  for (const line of lines) {
    const cells = line.split('\t');
    const rawTitle = cells[idx.title] ?? '';
    const kind = (cells[idx.kind] ?? '').trim();
    // Code de classification, sinon identifiant technique du regroupement.
    const code = (cells[idx.code] ?? '').trim()
      || (idx.blockId >= 0 ? (cells[idx.blockId] ?? '').trim() : '');

    if (!KINDS.has(kind)) { skipped.unknownKind++; continue; }

    if (kind === 'chapter') {
      const titre = normaliser(rawTitle.replace(/^(\s*-\s*)+/, ''));
      dansChapitreEcarte = ecartes.some((motif) => titre.includes(motif));
      // Un nouveau chapitre referme les branches du precedent.
      parents.length = 0;
    }
    if (dansChapitreEcarte) { skipped.excludedChapter++; continue; }

    const match = rawTitle.match(/^(\s*-\s*)+/);
    const depth = match ? (match[0].match(/-/g) ?? []).length : 0;
    const label = rawTitle.slice(match?.[0].length ?? 0).trim();
    if (!label) {
      skipped.noLabel++;
      // La pile doit oublier cette profondeur, sinon les entrees suivantes se
      // rattacheraient au dernier concept vu au meme niveau, c'est-a-dire a une AUTRE
      // branche : un faux rattachement est pire qu'un rattachement manquant.
      parents.length = depth;
      continue;
    }

    // Le parent est le plus proche ancetre encore valide : quand un regroupement a ete
    // ecarte faute de libelle, ses enfants remontent d'un niveau plutot que d'etre perdus.
    let parentId = null;
    for (let d = depth - 1; d >= 0; d--) {
      if (parents[d]) { parentId = parents[d]; break; }
    }

    const concept = {
      id: randomUUID(),
      code: code || null,
      label,
      kind,
      depth,
      parentId,
      isSelectable: kind === 'category' && code !== '',
    };
    concepts.push(concept);
    parents.length = depth; // les branches plus profondes sont refermees
    parents[depth] = concept.id;
  }

  return { concepts, skipped };
}

function arg(name, fallback = null) {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

const CHUNK = 500;

/**
 * Ecrit un referentiel complet dans une seule transaction : soit le referentiel est
 * entierement disponible, soit la base reste dans son etat anterieur. Un import partiel
 * rendrait la recherche silencieusement incomplete, ce qui est pire qu'un echec visible.
 *
 * Chaque publication recoit ses propres identifiants de concepts. Le remappage est fait
 * AVANT l'insertion, ce qui preserve la hierarchie et permet de conserver une ancienne
 * publication lors d'un remplacement sans collision de cle primaire.
 */
export async function importTerminology(client, options) {
  const { slug, concepts, title, source, version, license, attribution, activate = false, replace = false } = options;
  if (!slug) throw new Error('Un identifiant de referentiel (slug) est requis.');
  if (!Array.isArray(concepts) || concepts.length === 0) throw new Error('Aucun concept exploitable dans le fichier.');

  const publicationIds = new Map();
  for (const concept of concepts) {
    if (!concept?.id) throw new Error('Chaque concept doit posseder un identifiant source.');
    if (publicationIds.has(concept.id)) throw new Error(`Identifiant de concept duplique : ${concept.id}.`);
    publicationIds.set(concept.id, randomUUID());
  }
  const publicationConcepts = concepts.map((concept) => {
    let parentId = null;
    if (concept.parentId != null) {
      parentId = publicationIds.get(concept.parentId);
      if (!parentId) throw new Error(`Parent de concept introuvable : ${concept.parentId}.`);
    }
    return { ...concept, id: publicationIds.get(concept.id), parentId };
  });

  await client.query('begin');
  try {
    const existing = await client.query('select id from public.terminology_release where slug = $1', [slug]);
    if (existing.rowCount > 0) {
      if (!replace) throw new Error(`Le referentiel "${slug}" existe deja. Utiliser --replace pour le recharger.`);
      // Une fiche stocke le couple code/libelle comme instantane historique. L'ancienne
      // publication doit donc rester disponible pour revalider ce couple apres activation de
      // la nouvelle. Seul son slug technique est archive afin de liberer le slug courant.
      await client.query(
        `update public.terminology_release
         set slug = $2
         where id = $1`,
        [existing.rows[0].id, `${slug}--archive-${existing.rows[0].id}`],
      );
    }

    const release = await client.query(
      `insert into public.terminology_release(slug, title, source, version, license, attribution, concept_count, imported_at)
       values($1, $2, $3, $4, $5, $6, $7, now()) returning id`,
      [slug, title ?? slug, source ?? 'inconnue', version ?? '1', license ?? null, attribution ?? null, publicationConcepts.length],
    );
    const releaseId = release.rows[0].id;

    for (let i = 0; i < publicationConcepts.length; i += CHUNK) {
      const slice = publicationConcepts.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      for (const c of slice) {
        const n = params.length;
        values.push(`($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6},$${n + 7},$${n + 8})`);
        params.push(c.id, releaseId, c.code, c.label, c.kind, c.depth, c.parentId, c.isSelectable);
      }
      await client.query(
        `insert into public.terminology_concept(id, release_id, code, label, kind, depth, parent_id, is_selectable)
         values ${values.join(',')}`,
        params,
      );
    }

    if (activate) {
      await client.query('update public.terminology_release set is_active = false where is_active');
      await client.query('update public.terminology_release set is_active = true where id = $1', [releaseId]);
    }

    await client.query('commit');
    return { releaseId, inserted: publicationConcepts.length };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function main() {
  const file = arg('file');
  const slug = arg('slug');
  if (!file || !slug) {
    throw new Error('Usage : --file=<chemin.tsv> --slug=<identifiant> [--title=] [--source=] [--version=] [--license=] [--attribution=] [--activate] [--replace]');
  }
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!/^postgres(?:ql)?:\/\//i.test(dbUrl ?? '')) throw new Error('SUPABASE_DB_URL PostgreSQL est requis.');

  const { concepts, skipped } = parseTerminologyRows(readTextFile(file));
  if (concepts.length === 0) throw new Error('Aucun concept exploitable dans le fichier.');
  const selectable = concepts.filter((c) => c.isSelectable).length;

  const client = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    await importTerminology(client, {
      slug,
      concepts,
      title: arg('title', slug),
      source: arg('source', 'inconnue'),
      version: arg('version', '1'),
      license: arg('license'),
      attribution: arg('attribution'),
      activate: process.argv.includes('--activate'),
      replace: process.argv.includes('--replace'),
    });

    console.log(`Referentiel "${slug}" importe : ${concepts.length} concepts, dont ${selectable} proposables a la saisie.`);
    if (skipped.excludedChapter > 0) console.log(`  ${skipped.excludedChapter} entree(s) ecartee(s) : chapitres sans valeur diagnostique.`);
    if (skipped.noLabel > 0) console.log(`  ${skipped.noLabel} entree(s) ignoree(s) faute de libelle (sections non traduites).`);
    if (skipped.unknownKind > 0) console.log(`  ${skipped.unknownKind} ligne(s) ignoree(s) : type inconnu.`);
    if (!process.argv.includes('--activate')) console.log('  Referentiel INACTIF : relancer avec --activate pour le rendre interrogeable.');
  } finally {
    // `importTerminology` a deja annule sa transaction en cas d'echec.
    await client.end().catch(() => {});
  }
}

// Execute uniquement en ligne de commande ; les fonctions restent testables a l'import.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch((error) => {
    console.error(`Import du referentiel echoue : ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
