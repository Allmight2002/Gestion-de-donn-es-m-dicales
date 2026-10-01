// Codage terminologique assiste : texte clinique libre -> concepts du referentiel actif.
//
// Chaine : interpretation (LLM, sinon repli lexical) -> candidats du referentiel (RPC en
// lecture, sous l'identite de l'appelant) -> score deterministe -> decision.
//
// Garanties :
//   * authentification obligatoire, aucune ecriture, aucun privilege eleve (pas de
//     service_role : le referentiel est lisible par tout compte authentifie) ;
//   * seul le texte du diagnostic, nettoye des identifiants apparents, sort vers le LLM ;
//   * aucun texte clinique dans les journaux, aucune erreur interne renvoyee au client ;
//   * une panne du LLM ne bloque jamais : le repli lexical repond, et le client enregistre
//     de toute facon le texte original.
import type { SupabaseClient } from '@supabase/supabase-js';
import { readJsonObject, RequestValidationError, validationResponse } from '../_shared/contracts.ts';
import {
  type InterpretationService,
  lexicalInterpretation,
  MAX_DIAGNOSES,
  MAX_TEXT_LENGTH,
  scrubIdentifiers,
} from './interpret.ts';
import {
  type Candidate,
  CANDIDATE_LIMIT,
  candidateTerms,
  decide,
  type DiagnosisInterpretation,
  type ScoredCandidate,
} from './scoring.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-meddata-diagnosis-contract',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export interface CodeTerminologyDeps {
  buildClient: (authHeader: string) => SupabaseClient;
  /** Absent quand aucun LLM n'est configure : le repli lexical repond seul. */
  interpreter: InterpretationService | null;
}

export interface CodedConcept {
  code: string;
  label: string;
  uri: string | null;
  score: number;
}

export interface CodedItem {
  normalized: string;
  status: 'automatic' | 'suggested' | 'ambiguous' | 'unmatched';
  score: number;
  best: CodedConcept | null;
  alternatives: CodedConcept[];
}

export interface CodeTerminologyResponse {
  method: 'ai_assisted' | 'lexical';
  release: string | null;
  language: 'fr';
  items: CodedItem[];
}

function parseRequest(body: Record<string, unknown>): string {
  if (typeof body.text !== 'string') throw new RequestValidationError(400, 'text requis');
  const text = body.text.trim();
  if (text.length < 2 || text.length > MAX_TEXT_LENGTH) {
    throw new RequestValidationError(400, `text : 2 a ${MAX_TEXT_LENGTH} caracteres`);
  }
  if (body.language !== undefined && body.language !== 'fr') {
    throw new RequestValidationError(400, 'langue non prise en charge');
  }
  return text;
}

const concept = (c: ScoredCandidate): CodedConcept => ({
  code: c.code,
  label: c.label,
  uri: c.uri,
  score: Math.round(c.score * 100) / 100,
});

async function candidatesFor(
  client: SupabaseClient,
  item: DiagnosisInterpretation,
): Promise<{ candidates: Candidate[]; release: string | null }> {
  const { data, error } = await client.rpc('match_terminology_candidates', {
    p_terms: candidateTerms(item),
    p_limit: CANDIDATE_LIMIT,
  });
  if (error) throw new Error('referentiel indisponible');
  const rows = (data ?? []) as Array<{ code: string; label: string; uri: string | null; release_version: string }>;
  return {
    candidates: rows.map((r, rank) => ({ code: r.code, label: r.label, uri: r.uri ?? null, rank })),
    release: rows[0]?.release_version ?? null,
  };
}

export async function handleCodeTerminology(req: Request, deps: CodeTerminologyDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST requis' });
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Authentification requise' });

  let text: string;
  try {
    text = parseRequest(await readJsonObject(req));
  } catch (error) {
    return validationResponse(error);
  }

  const client = deps.buildClient(authHeader);
  const { data: who } = await client.auth.getUser();
  if (!who?.user) return json(401, { error: 'Session invalide' });

  const scrubbed = scrubIdentifiers(text);
  if (scrubbed.length < 2) return json(200, { method: 'lexical', release: null, language: 'fr', items: [] });

  let method: CodeTerminologyResponse['method'] = 'lexical';
  let interpretation: DiagnosisInterpretation[] = [];
  if (deps.interpreter) {
    try {
      interpretation = await deps.interpreter.interpret(scrubbed);
      method = 'ai_assisted';
    } catch {
      // Jamais le texte ni l'erreur brute du fournisseur dans les journaux.
      console.error('code-terminology: interpretation indisponible, repli lexical');
    }
  }
  if (method === 'lexical') interpretation = lexicalInterpretation(scrubbed);

  try {
    let release: string | null = null;
    const items: CodedItem[] = [];
    for (const item of interpretation.slice(0, MAX_DIAGNOSES)) {
      const found = await candidatesFor(client, item);
      release ??= found.release;
      // Le texte du medecin borne ce qu'un code automatique peut affirmer (`isCovered`). Il
      // vient de la requete, jamais de l'interpretation.
      const decision = decide({ ...item, source: scrubbed }, found.candidates);
      items.push({
        normalized: item.normalized,
        status: decision.status,
        score: decision.score,
        best: decision.best ? concept(decision.best) : null,
        alternatives: decision.alternatives.map(concept),
      });
    }
    const body: CodeTerminologyResponse = { method, release, language: 'fr', items };
    return json(200, body);
  } catch {
    console.error('code-terminology: recherche dans le referentiel impossible');
    return json(503, { error: 'Codage indisponible pour le moment', code: 'CODING_UNAVAILABLE' });
  }
}
