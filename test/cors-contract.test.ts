// Garde-fou du contrat CORS entre le client et les Edge Functions (release 178).
//
// Le client frontend pose un en-tete maison sur TOUTES ses requetes Supabase, via
// `global.headers` dans src/lib/supabase.ts. PostgREST tolere un en-tete inconnu, mais
// chaque Edge Function declare sa PROPRE liste `Access-Control-Allow-Headers` : un en-tete
// absent de cette liste fait rejeter le preflight PAR LE NAVIGATEUR, alors meme que la
// fonction a repondu 200. La vraie requete ne part jamais et le client ne voit qu'un echec
// reseau opaque, sans aucune trace cote serveur.
//
// C'est exactement ainsi que L55 a casse `generate-export` sans qu'aucun test ne le voie :
// les clients Node n'appliquent pas le CORS, seuls les navigateurs le font. Le test lie donc
// les deux bords, sur la liste dupliquee dans une dizaine de fichiers.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? tsFiles(full) : (full.endsWith('.ts') ? [full] : []);
  });
}

/** En-tetes que le client pose sur toutes ses requetes (`global.headers`). */
function clientGlobalHeaders(): string[] {
  const source = readFileSync('src/lib/supabase.ts', 'utf8');
  const block = source.match(/headers:\s*\{([^}]*)\}/);
  if (!block) return [];
  return [...block[1].matchAll(/'([^']+)'\s*:/g)].map((m) => m[1].toLowerCase());
}

/** Chaque liste `Access-Control-Allow-Headers` declaree cote Edge Functions. */
function corsAllowLists(): { file: string; allowed: string[] }[] {
  return tsFiles(join('supabase', 'functions')).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/'Access-Control-Allow-Headers':\s*'([^']*)'/g)].map((match) => ({
      file,
      allowed: match[1].split(',').map((header) => header.trim().toLowerCase()),
    }));
  });
}

describe('contrat CORS entre le client et les Edge Functions', () => {
  // Sans ces deux reperes, les assertions suivantes passeraient a vide : un jour ou la forme
  // du fichier change, le garde-fou doit tomber bruyamment plutot que de ne plus rien verifier.
  test('les deux bords du contrat sont bien detectes', () => {
    expect(clientGlobalHeaders().length).toBeGreaterThan(0);
    expect(corsAllowLists().length).toBeGreaterThan(0);
  });

  test('chaque en-tete global du client est autorise par chaque Edge Function', () => {
    const requis = clientGlobalHeaders();
    const manquants = corsAllowLists().flatMap(({ file, allowed }) => requis
      .filter((header) => !allowed.includes(header))
      .map((header) => `${file} : ${header}`));
    expect(manquants).toEqual([]);
  });
});
