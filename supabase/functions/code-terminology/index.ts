import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { requiredEnv } from '../_shared/contracts.ts';
import { handleCodeTerminology } from './handler.ts';
import { claudeInterpretation, type InterpretationService } from './interpret.ts';

// Le LLM est FACULTATIF : sans ANTHROPIC_API_KEY, le codage repond par le seul repli lexical.
// Delai court et une seule nouvelle tentative : la saisie ne doit pas attendre.
let interpreter: InterpretationService | null | undefined;
function configuredInterpreter(): InterpretationService | null {
  if (interpreter !== undefined) return interpreter;
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  interpreter = apiKey
    ? claudeInterpretation(
      new Anthropic({ apiKey, timeout: 8_000, maxRetries: 1 }),
      Deno.env.get('TERMINOLOGY_LLM_MODEL') || 'claude-opus-5-5',
    )
    : null;
  return interpreter;
}

Deno.serve(async (req: Request) => {
  try {
    const env = requiredEnv(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);
    return await handleCodeTerminology(req, {
      interpreter: configuredInterpreter(),
      buildClient: (auth) =>
        createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: auth } },
          auth: { persistSession: false },
        }),
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Configuration serveur indisponible' }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'authorization, x-client-info, apikey, content-type, x-meddata-diagnosis-contract',
        'content-type': 'application/json',
      },
    });
  }
});
