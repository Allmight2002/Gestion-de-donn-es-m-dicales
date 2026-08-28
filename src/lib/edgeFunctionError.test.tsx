// @vitest-environment jsdom
// Chantier D : `functions.invoke` masque le refus applicatif derriere un message de TRANSPORT.
// Ces tests fixent le contrat de l'utilitaire partage : lire le corps de `error.context`, n'en
// exposer que la phrase et le code choisis par la fonction, et ne retomber sur le transport
// qu'en dernier recours.
import { describe, expect, test, vi } from 'vitest';
import {
  EdgeFunctionError,
  edgeFunctionError,
  invokeEdgeFunction,
  readEdgeFunctionFailure,
} from './edgeFunctionError';
import { errorMessage } from './errorMessage';

const TRANSPORT = 'Edge Function returned a non-2xx status code';

/** Reproduit fidelement ce que leve @supabase/functions-js : message de transport + Response. */
function httpError(status: number, body: unknown, contentType = 'application/json'): Error {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const error = new Error(TRANSPORT) as Error & { context: Response };
  error.name = 'FunctionsHttpError';
  error.context = new Response(payload, { status, headers: { 'content-type': contentType } });
  return error;
}

describe('readEdgeFunctionFailure', () => {
  test('remonte la phrase choisie par la fonction, pas le message de transport', async () => {
    const failure = await readEdgeFunctionFailure(httpError(409, { error: 'Seule une cohorte figee est exportable' }));
    expect(failure.message).toBe('Seule une cohorte figee est exportable');
    expect(failure.fromServer).toBe(true);
    expect(failure.status).toBe(409);
    expect(failure.message).not.toContain('non-2xx');
  });

  test('ajoute le code technique entre parentheses', async () => {
    const failure = await readEdgeFunctionFailure(httpError(409, {
      code: 'EXPORT_INCOMPLETE',
      error: 'Export refuse : donnees incompletes ou incoherentes',
      resource: 'patients',
    }));
    expect(failure.message).toBe('Export refuse : donnees incompletes ou incoherentes (EXPORT_INCOMPLETE)');
    expect(failure.code).toBe('EXPORT_INCOMPLETE');
  });

  test('ne repete pas le code quand la phrase le contient deja', async () => {
    const failure = await readEdgeFunctionFailure(httpError(413, {
      code: 'EXPORT_LIMIT_EXCEEDED',
      error: 'Refus EXPORT_LIMIT_EXCEEDED',
    }));
    expect(failure.message).toBe('Refus EXPORT_LIMIT_EXCEEDED');
  });

  test('ignore un pseudo-code qui est en fait une phrase', async () => {
    const failure = await readEdgeFunctionFailure(httpError(400, {
      error: 'Base invalide',
      code: 'quelque chose de tres bavard',
    }));
    expect(failure.message).toBe('Base invalide');
    expect(failure.code).toBeNull();
  });

  test("n'expose que le champ error, jamais le reste du corps", async () => {
    const failure = await readEdgeFunctionFailure(httpError(500, {
      error: 'Generation de l export impossible',
      detail: 'relation "patient" does not exist',
      stack: 'at handler (file:///srv/index.ts:12:3)',
    }));
    expect(failure.message).toBe('Generation de l export impossible');
    expect(failure.message).not.toContain('does not exist');
    expect(failure.message).not.toContain('file://');
  });

  test('normalise et borne une phrase multiligne ou trop longue', async () => {
    const failure = await readEdgeFunctionFailure(httpError(400, { error: `Refus\n  motif   etale\t` }));
    expect(failure.message).toBe('Refus motif etale');

    const long = await readEdgeFunctionFailure(httpError(400, { error: 'x'.repeat(1000) }));
    expect(long.message.length).toBeLessThanOrEqual(300);
  });

  test('retombe sur le transport quand le corps est absent, vide ou non JSON', async () => {
    for (const body of ['', '<html>502 Bad Gateway</html>', JSON.stringify({ autre: 'chose' })]) {
      const failure = await readEdgeFunctionFailure(httpError(502, body, 'text/html'));
      expect(failure.message).toBe(TRANSPORT);
      expect(failure.fromServer).toBe(false);
    }
  });

  test('ne produit jamais [object Object]', async () => {
    for (const body of [{ error: { motif: 'refus' } }, { error: ['refus'] }, { error: 42 }]) {
      const failure = await readEdgeFunctionFailure(httpError(400, body));
      expect(failure.message).toBe(TRANSPORT);
      expect(failure.message).not.toContain('[object Object]');
    }
  });

  test('ne consomme pas la reponse : elle reste lisible par l appelant', async () => {
    const error = httpError(409, { error: 'Fichier en quarantaine : lecture refusee' }) as Error & { context: Response };
    await readEdgeFunctionFailure(error);
    await expect(error.context.json()).resolves.toEqual({ error: 'Fichier en quarantaine : lecture refusee' });
  });

  test('erreur reseau sans reponse : message de transport conserve', async () => {
    const fetchError = new Error('Failed to send a request to the Edge Function');
    fetchError.name = 'FunctionsFetchError';
    const failure = await readEdgeFunctionFailure(fetchError);
    expect(failure.message).toBe('Failed to send a request to the Edge Function');
    expect(failure.fromServer).toBe(false);
    expect(failure.status).toBeNull();
  });

  test('erreur totalement muette : phrase de repli, jamais une chaine vide', async () => {
    const failure = await readEdgeFunctionFailure({});
    expect(failure.message.length).toBeGreaterThan(0);
    expect(failure.fromServer).toBe(false);
  });

  test('accepte un corps deja lu (double de test) sans changer de contrat', async () => {
    const error = Object.assign(new Error(TRANSPORT), {
      context: { status: 403, body: { error: 'Acces export refuse' } },
    });
    const failure = await readEdgeFunctionFailure(error);
    expect(failure.message).toBe('Acces export refuse');
    expect(failure.status).toBe(403);
  });
});

describe('edgeFunctionError', () => {
  test('produit une Error affichable telle quelle par errorMessage()', async () => {
    const error = await edgeFunctionError(httpError(400, { error: 'Base invalide' }));
    expect(error).toBeInstanceOf(EdgeFunctionError);
    expect(error.status).toBe(400);
    expect(errorMessage(error, 'repli generique')).toBe('Base invalide');
  });
});

describe('invokeEdgeFunction', () => {
  test('renvoie les donnees quand la fonction accepte', async () => {
    const invoke = vi.fn(async () => ({ data: { id: 'x1' }, error: null }));
    const client = { functions: { invoke } } as never;
    await expect(invokeEdgeFunction(client, 'finalize-upload', { ticketId: 't' })).resolves.toEqual({ id: 'x1' });
    expect(invoke).toHaveBeenCalledWith('finalize-upload', { body: { ticketId: 't' } });
  });

  test('leve le refus du serveur quand la fonction refuse', async () => {
    const client = {
      functions: { invoke: async () => ({ data: null, error: httpError(401, { error: 'Authentification requise' }) }) },
    } as never;
    await expect(invokeEdgeFunction(client, 'signed-read', {})).rejects.toThrow('Authentification requise');
  });
});
