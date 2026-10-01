// Interpretation par un fournisseur a API « compatible OpenAI » (Chat Completions) : OpenAI,
// DeepSeek, ou tout service exposant le meme contrat (TERMINOLOGY_LLM_BASE_URL).
//
// Meme prompt, meme schema, meme validation que pour Claude : le fournisseur ne change ni ce
// qui est envoye (le seul texte du diagnostic, nettoye), ni ce qui est accepte en retour
// (parseInterpretation). Toute reponse inattendue leve ; l'appelant bascule alors sur le
// repli lexical. Appel par fetch, sans SDK : aucune dependance supplementaire.
import { type InterpretationService, parseInterpretation, SCHEMA, SYSTEM_PROMPT } from './interpret.ts';

/**
 * `json_schema` : sortie contrainte par le schema (OpenAI, Structured Outputs).
 * `json_object` : JSON garanti mais forme libre (DeepSeek) ; la forme est alors decrite dans
 * le prompt et verifiee par parseInterpretation.
 */
export type JsonMode = 'json_schema' | 'json_object';

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  jsonMode: JsonMode;
  timeoutMs?: number;
  /** Options propres au fournisseur (`reasoningOptions`) ; ne remplacent jamais modele ni messages. */
  extraBody?: Record<string, unknown>;
  fetch?: typeof fetch;
}

/** Delai par defaut d'une interpretation : la saisie ne doit pas attendre. */
export const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 30_000;

/**
 * Delai configure (TERMINOLOGY_LLM_TIMEOUT_MS, en millisecondes), borne a 2–30 s. Le texte est
 * enregistre AVANT l'analyse : un delai plus long fait seulement attendre la proposition.
 */
export function timeoutFromEnv(value: string | undefined): number {
  const ms = Number.parseInt(value?.trim() ?? '', 10);
  if (!Number.isFinite(ms)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, ms));
}

/**
 * Raisonnement du modele (TERMINOLOGY_LLM_REASONING), pour DeepSeek seulement :
 * `disabled` coupe le raisonnement (`thinking`), `low` / `high` / `max` reglent son effort
 * (`reasoning_effort`). Vide : comportement par defaut du fournisseur. `null` : valeur inconnue.
 */
export function reasoningOptions(provider: string, value: string | undefined): Record<string, unknown> | null {
  const v = value?.trim().toLowerCase();
  if (!v) return {};
  if (provider !== 'deepseek') return null;
  if (v === 'disabled') return { thinking: { type: 'disabled' } };
  if (v === 'low' || v === 'high' || v === 'max') return { thinking: { type: 'enabled' }, reasoning_effort: v };
  return null;
}

export const PROVIDERS = {
  openai: { baseUrl: 'https://api.openai.com/v1', jsonMode: 'json_schema', keyEnv: 'OPENAI_API_KEY', model: null },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    jsonMode: 'json_object',
    keyEnv: 'DEEPSEEK_API_KEY',
    model: 'deepseek-flash',
  },
} as const satisfies Record<string, { baseUrl: string; jsonMode: JsonMode; keyEnv: string; model: string | null }>;

// Le mode json_object exige le mot « JSON » dans le prompt et un exemple de la forme attendue.
const JSON_OBJECT_FORMAT = `

Réponds uniquement par un objet JSON de cette forme exacte :
{"diagnoses":[{"normalized":"…","search_terms":["…"],"ambiguous":false,"alternative_terms":[]}]}`;

const MAX_OUTPUT_TOKENS = 2048;

export function openAICompatibleInterpretation(config: OpenAICompatibleConfig): InterpretationService {
  const doFetch = config.fetch ?? fetch;
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const schemaMode = config.jsonMode === 'json_schema';
  return {
    async interpret(text) {
      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        body: JSON.stringify({
          ...config.extraBody,
          model: config.model,
          messages: [
            { role: 'system', content: schemaMode ? SYSTEM_PROMPT : SYSTEM_PROMPT + JSON_OBJECT_FORMAT },
            { role: 'user', content: `<diagnostic>\n${text}\n</diagnostic>` },
          ],
          // OpenAI : max_completion_tokens (modeles de raisonnement) ; DeepSeek : max_tokens.
          ...(schemaMode ? { max_completion_tokens: MAX_OUTPUT_TOKENS } : { max_tokens: MAX_OUTPUT_TOKENS }),
          response_format: schemaMode
            ? { type: 'json_schema', json_schema: { name: 'diagnoses', strict: true, schema: SCHEMA } }
            : { type: 'json_object' },
        }),
      });
      // Le corps d'une erreur n'est ni lu ni journalise : il peut reprendre la requete.
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`interpretation indisponible (${response.status})`);
      }
      const payload = await response.json() as {
        choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
      };
      const choice = payload.choices?.[0];
      if (!choice || choice.finish_reason !== 'stop' || choice.message?.refusal) {
        throw new Error('interpretation indisponible');
      }
      const content = choice.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('interpretation vide');
      return parseInterpretation(JSON.parse(content));
    },
  };
}
