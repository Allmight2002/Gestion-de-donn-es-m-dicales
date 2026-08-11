// Message AFFICHABLE d'un refus d'Edge Function (chantier D, docs/chantiers-interactions-comptes.md §5).
//
// `functions.invoke` ne remonte JAMAIS le refus applicatif dans `error.message` : la bibliotheque
// leve un `FunctionsHttpError` dont le message est litteralement « Edge Function returned a non-2xx
// status code ». Le refus reellement choisi par la fonction — `{ error, code, resource, ... }` — est
// dans le CORPS de la reponse, porte par `error.context`, qui est un objet `Response`. Le lire est
// donc ASYNCHRONE, et `context.body` est un flux, pas un objet : c'est ce qui faisait retomber
// `src/data/mission.ts` sur le message de transport malgre sa tentative de lecture.
//
// Sans cette lecture, un refus legitime (« Base invalide », « Seule une cohorte figee est
// exportable », EXPORT_INCOMPLETE) est indiscernable d'une panne.
//
// REGLE DE CLOISONNEMENT. On n'affiche QUE la phrase que la fonction a elle-meme choisie (champ
// `error`) et son code technique (champ `code`). Jamais le corps entier, jamais un objet — un
// `String(objet)` avait deja produit « [object Object] » dans un lot anterieur. Tout le reste du
// corps reste disponible pour le code appelant mais n'est pas destine a l'affichage.
import type { SupabaseClient } from '@supabase/supabase-js';

/** Au-dela, la phrase n'est plus un message court et generique : on la tronque. */
const MAX_MESSAGE_LENGTH = 300;
/** Une reponse d'erreur legitime est minuscule ; au-dela on ne lit pas (page HTML de passerelle). */
const MAX_BODY_BYTES = 64 * 1024;
/** Un code technique est un jeton en majuscules, pas une phrase. */
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
/** Dernier recours absolu : ni le serveur ni le transport n'ont fourni de phrase. */
const NO_MESSAGE = "La fonction n'a renvoyé aucun message.";

export interface EdgeFunctionFailure {
  /** Message pret a afficher : phrase du serveur suivie du code entre parentheses, sinon transport. */
  message: string;
  /** Code technique choisi par la fonction, quand elle en fournit un. */
  code: string | null;
  /** Statut HTTP du refus, quand une reponse est parvenue. */
  status: number | null;
  /** true si la phrase vient de la fonction ; false si c'est le message de transport. */
  fromServer: boolean;
  /** Corps JSON du refus. Reserve aux details deja affiches par un appelant (ex. signature ClamAV). */
  body: Record<string, unknown> | null;
}

/** Erreur normalisee : son `.message` est directement affichable par `errorMessage()`. */
export class EdgeFunctionError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  readonly fromServer: boolean;

  constructor(failure: EdgeFunctionFailure) {
    super(failure.message);
    this.name = 'EdgeFunctionError';
    this.code = failure.code;
    this.status = failure.status;
    this.fromServer = failure.fromServer;
  }
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return asPlainObject(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Normalise une phrase du serveur : une seule ligne, bornee. Renvoie null si rien d'exploitable. */
function shortText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > MAX_MESSAGE_LENGTH ? `${collapsed.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : collapsed;
}

function isResponse(value: unknown): value is Response {
  return typeof Response !== 'undefined' && value instanceof Response;
}

/**
 * Corps du refus. `context` est un `Response` en fonctionnement reel ; les autres formes
 * (chaine JSON, objet deja lu, objet imbriquant `body`) sont acceptees pour les doubles de test
 * et les versions differentes de la bibliotheque.
 */
async function readBody(context: unknown): Promise<Record<string, unknown> | null> {
  if (isResponse(context)) {
    const declared = Number(context.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
    try {
      const text = await context.clone().text();
      return text.length > MAX_BODY_BYTES ? null : parseJsonObject(text);
    } catch {
      return null;
    }
  }
  if (typeof context === 'string') return parseJsonObject(context);
  const plain = asPlainObject(context);
  if (!plain) return null;
  if (typeof plain.body === 'string') return parseJsonObject(plain.body);
  return asPlainObject(plain.body) ?? plain;
}

function readStatus(context: unknown): number | null {
  if (isResponse(context)) return context.status;
  const status = asPlainObject(context)?.status;
  return typeof status === 'number' ? status : null;
}

/**
 * Extrait d'une erreur `functions.invoke` ce que le serveur a choisi de dire.
 * Ne leve jamais : une erreur de lecture retombe sur le message de transport.
 */
export async function readEdgeFunctionFailure(error: unknown): Promise<EdgeFunctionFailure> {
  const context = (error as { context?: unknown } | null | undefined)?.context;
  const body = await readBody(context);
  const serverMessage = shortText(body?.error);
  const rawCode = body?.code;
  const code = typeof rawCode === 'string' && CODE_RE.test(rawCode) ? rawCode : null;
  const transport = shortText((error as { message?: unknown } | null | undefined)?.message) ?? NO_MESSAGE;

  if (!serverMessage) {
    return { message: transport, code, status: readStatus(context), fromServer: false, body };
  }
  const message = code && !serverMessage.includes(code) ? `${serverMessage} (${code})` : serverMessage;
  return { message, code, status: readStatus(context), fromServer: true, body };
}

/** Erreur normalisee, prete a etre levee vers l'interface. */
export async function edgeFunctionError(error: unknown): Promise<EdgeFunctionError> {
  return new EdgeFunctionError(await readEdgeFunctionFailure(error));
}

/**
 * Appel d'Edge Function : renvoie les donnees, ou leve une `EdgeFunctionError` portant le refus
 * choisi par le serveur. Tout appelant frontend passe par ici — c'est le point unique de
 * traduction, pour qu'aucun chemin ne reste sur le message de transport.
 */
export async function invokeEdgeFunction<T>(
  client: SupabaseClient,
  name: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  const { data, error } = await client.functions.invoke<T>(name, { body });
  if (error) throw await edgeFunctionError(error);
  return data;
}
