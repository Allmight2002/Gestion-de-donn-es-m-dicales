import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { requiredEnv } from '../_shared/contracts.ts';
import { handleCodeTerminology } from './handler.ts';
import { claudeInterpretation, type InterpretationService } from './interpret.ts';
import { openAICompatibleInterpretation, PROVIDERS, reasoningOptions, timeoutFromEnv } from './openaiCompatible.ts';

// Le LLM est FACULTATIF : sans cle pour le fournisseur choisi, le codage repond par le seul
// repli lexical. Fournisseur : TERMINOLOGY_LLM_PROVIDER = anthropic (defaut), openai ou deepseek.
// Delai TERMINOLOGY_LLM_TIMEOUT_MS (8 s par defaut, 2 a 30 s) et une seule nouvelle tentative
// au plus : le texte est deja enregistre, seule la proposition attend.
let interpreter: InterpretationService | null | undefined;
function configuredInterpreter(): InterpretationService | null {
  if (interpreter !== undefined) return interpreter;
  const provider = (Deno.env.get('TERMINOLOGY_LLM_PROVIDER') || 'anthropic').trim().toLowerCase();
  const model = Deno.env.get('TERMINOLOGY_LLM_MODEL')?.trim();
  const timeoutMs = timeoutFromEnv(Deno.env.get('TERMINOLOGY_LLM_TIMEOUT_MS'));
  interpreter = null;
  if (provider === 'anthropic') {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (apiKey) {
      interpreter = claudeInterpretation(
        new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 }),
        model || 'claude-opus-5-5',
      );
    }
  } else if (provider === 'openai' || provider === 'deepseek') {
    const defaults = PROVIDERS[provider];
    const apiKey = Deno.env.get(defaults.keyEnv);
    const chosenModel = model || defaults.model;
    const extraBody = reasoningOptions(provider, Deno.env.get('TERMINOLOGY_LLM_REASONING'));
    if (apiKey && chosenModel && extraBody) {
      interpreter = openAICompatibleInterpretation({
        apiKey,
        model: chosenModel,
        baseUrl: Deno.env.get('TERMINOLOGY_LLM_BASE_URL')?.trim() || defaults.baseUrl,
        jsonMode: defaults.jsonMode,
        timeoutMs,
        extraBody,
      });
    } else if (apiKey && !extraBody) {
      console.error(`code-terminology: TERMINOLOGY_LLM_REASONING invalide pour ${provider}, repli lexical`);
    } else if (apiKey) {
      console.error(`code-terminology: TERMINOLOGY_LLM_MODEL requis pour ${provider}, repli lexical`);
    }
  } else {
    console.error('code-terminology: TERMINOLOGY_LLM_PROVIDER inconnu, repli lexical');
  }
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
