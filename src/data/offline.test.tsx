// @vitest-environment jsdom
// L25 : resolution d'un conflit de synchronisation. La DECISION de fusion est testee sans base ni
// navigateur dans `domain/conflictMerge.test.tsx` ; ici on verifie le CHAINAGE — ce qui part
// reellement dans la RPC, ce que devient l'outbox, et ce que devient le cache local.
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildSnapshot, idbTx, INTAKE_CONTEXT_STORE, offlineCache, outbox, purgeExpiredIntakeContexts,
  purgeForeignOfflineRecords,
  resolveKeepBoth, resolveKeepMine, setOfflineUser,
  type FlushDeps, type OutboxEntry,
} from './offline';

const HED = { code: 'S06.4', label: 'Hematome extradural' };
const FEMUR = { code: 'S72.0', label: 'Fracture du femur' };
const USER = 'conflict-user';

interface UpdateCall {
  encounterId: string;
  data: Record<string, unknown>;
  status: string;
  reason: string;
  expectedUpdatedAt: string | null;
  operationId: string;
}

/** Depots simules, TYPES : `tsc` est le seul des trois outils a voir un mock mal forme. */
function recordingDeps(serverUpdatedAt = '2026-08-18T10:00:00.000Z'): FlushDeps & { calls: UpdateCall[] } {
  const calls: UpdateCall[] = [];
  return {
    calls,
    async updateEncounter(encounterId, data, status, reason, expectedUpdatedAt, operationId) {
      calls.push({ encounterId, data, status, reason, expectedUpdatedAt, operationId });
      return { id: encounterId };
    },
    async getEncounter(encounterId) {
      return { data: { diagnostic: [FEMUR] }, updatedAt: `${serverUpdatedAt}#${encounterId}` };
    },
  };
}

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  dataType: 'analytic_outbox', id: 'ob-1', baseId: 'b-conflit', patientId: 'p1', encounterId: 'e1',
  data: { diagnostic: [HED], glasgow_score: 12 },
  serverData: { diagnostic: [FEMUR], glasgow_score: 14 },
  reason: 'correction hors-ligne', validationStatus: 'curated', baseUpdatedAt: '2026-08-18T08:00:00.000Z',
  createdAt: Date.now(), expiresAt: Date.now() + 60_000, state: 'conflict', ownerUserId: USER, ...over,
});

async function cacheEncounter(data: Record<string, unknown>): Promise<void> {
  await offlineCache.save(buildSnapshot(
    { id: 'b-conflit', name: 'Base', templateVersionId: 'v1' },
    [{ id: 'p1', code: 'P1', templateVersionId: 'v1', data: {}, validationStatus: 'curated' }],
    { p1: [{ id: 'e1', encounterType: 'consultation', encounterDate: '2026-08-18', validationStatus: 'curated', ageValue: null, ageUnit: null, data, updatedAt: '2026-08-18T08:00:00.000Z', pending: true }] },
    [{ id: 'f1', fieldKey: 'diagnostic', label: 'Diagnostic', scope: 'encounter', type: 'terminology', isMultiple: true, displayOrder: 0 }],
  ));
}

const cachedEncounter = async () =>
  (await offlineCache.get('b-conflit'))?.patients[0]?.encounters[0] ?? null;

beforeAll(() => {
  vi.stubEnv('VITE_OFFLINE_MODE', 'demo');
  vi.stubEnv('VITE_OFFLINE_ADMIN_ACK', 'true');
  setOfflineUser(USER);
});
afterAll(() => { setOfflineUser(null); vi.unstubAllEnvs(); });
beforeEach(async () => { await outbox.remove('ob-1'); await offlineCache.remove('b-conflit'); });

describe('resolveKeepBoth (L25)', () => {
  test('rejoue la charge FUSIONNEE, en forcant, sous le MEME operationId', async () => {
    await outbox.put(entry());
    const deps = recordingDeps();

    await resolveKeepBoth('ob-1', deps);

    expect(deps.calls).toHaveLength(1);
    const call = deps.calls[0];
    // Les deux diagnostics survivent ; le champ a valeur unique reste le mien.
    expect(call.data).toEqual({ diagnostic: [HED, FEMUR], glasgow_score: 12 });
    // Forcage assume : la version serveur vient d'etre montree et l'utilisateur a tranche.
    expect(call.expectedUpdatedAt).toBeNull();
    // La cle d'idempotence est celle de l'entree : la tentative en conflit a ete annulee cote
    // serveur, donc aucune empreinte ne s'y oppose, et un rejeu identique ne reecrira pas.
    expect(call.operationId).toBe('ob-1');
    expect(call.reason).toBe('correction hors-ligne');
    expect(call.status).toBe('curated');
  });

  test('vide l\'outbox et fait converger le cache local vers la fusion', async () => {
    await cacheEncounter({ diagnostic: [HED] });
    await outbox.put(entry());

    await resolveKeepBoth('ob-1', recordingDeps());

    expect(await outbox.get('ob-1')).toBeNull();
    const cached = await cachedEncounter();
    expect(cached?.data).toEqual({ diagnostic: [HED, FEMUR], glasgow_score: 12 });
    expect(cached?.pending).toBe(false);
    expect(cached?.updatedAt).toBe('2026-08-18T10:00:00.000Z#e1'); // jeton relu apres ecriture
  });

  test('un second declenchement ne rejoue rien : l\'entree n\'existe plus', async () => {
    await outbox.put(entry());
    const deps = recordingDeps();
    await resolveKeepBoth('ob-1', deps);
    await resolveKeepBoth('ob-1', deps);
    expect(deps.calls).toHaveLength(1);
  });

  test('sans rien a fusionner, la charge est exactement celle de « garder ma version »', async () => {
    // L'ecran ne propose pas l'issue dans ce cas ; la couche de donnees, elle, ne se contredit pas.
    await outbox.put(entry({ data: { glasgow_score: 12 }, serverData: { glasgow_score: 14 } }));
    const deps = recordingDeps();
    await resolveKeepBoth('ob-1', deps);
    expect(deps.calls[0].data).toEqual({ glasgow_score: 12 });
  });

  test('une entree d\'un AUTRE compte n\'est pas resolue', async () => {
    await outbox.put(entry({ ownerUserId: 'quelqu-un-d-autre' }));
    const deps = recordingDeps();
    await resolveKeepBoth('ob-1', deps);
    expect(deps.calls).toHaveLength(0);
  });
});

describe('resolveKeepMine — non-regression du partage de code', () => {
  test('envoie MA charge telle quelle, sans rien emprunter au serveur', async () => {
    await cacheEncounter({ diagnostic: [HED] });
    await outbox.put(entry());
    const deps = recordingDeps();

    await resolveKeepMine('ob-1', deps);

    expect(deps.calls[0].data).toEqual({ diagnostic: [HED], glasgow_score: 12 });
    expect(deps.calls[0].expectedUpdatedAt).toBeNull();
    expect(deps.calls[0].operationId).toBe('ob-1');
    expect(await outbox.get('ob-1')).toBeNull();
    expect((await cachedEncounter())?.data).toEqual({ diagnostic: [HED], glasgow_score: 12 });
  });
});

// UX-8 — un contexte de saisie hors connexion ne s'effacait qu'a la LECTURE de sa base. Prepare
// pour une base qu'on ne rouvre jamais, il gardait indefiniment son nom de base et ses
// permissions resolues sur l'appareil, alors que sa duree de vie etait ecoulee.
describe('UX-8 — balayage des contextes de saisie hors connexion', () => {
  const context = (baseId: string, owner: string | null, expiresAt: number) => ({
    key: `${owner ?? ''}::${baseId}`, dataType: 'intake_context' as const, ownerUserId: owner,
    baseId, baseName: 'Base fictive', preparedAt: 0, expiresAt,
  });

  test('le balayage emporte l\'expire et l\'orphelin, et laisse le contexte encore valable', async () => {
    const now = Date.now();
    setOfflineUser(USER);
    for (const record of [
      context('b-perime', USER, now - 1),
      context('b-valide', USER, now + 60_000),
      // Sans proprietaire, un enregistrement ne peut plus etre rattache a personne.
      context('b-orphelin', null, now + 60_000),
    ]) await idbTx(INTAKE_CONTEXT_STORE, 'readwrite', (s) => s.put(record));

    expect(await purgeExpiredIntakeContexts(now)).toBe(2);
    const reste = await idbTx<Array<{ baseId: string }>>(INTAKE_CONTEXT_STORE, 'readonly', (s) => s.getAll());
    expect(reste.map((r) => r.baseId)).toEqual(['b-valide']);
  });
});

// UX-8 — poste partage. Le cloisonnement inter-comptes d'IndexedDB reposait entierement sur un
// marqueur en localStorage : perdu, il laissait la file d'un autre compte — nom, date de
// naissance, telephone d'une creation intake — sur l'appareil, invisible pour l'application mais
// lisible dans l'inspecteur.
describe('UX-8 — enregistrements locaux d\'un autre compte', () => {
  test('l\'ouverture de session emporte ce qui appartient a un autre compte, et garde le reste', async () => {
    setOfflineUser(USER);
    await outbox.put(entry({ id: 'ob-mienne', ownerUserId: USER }));
    await outbox.put(entry({ id: 'ob-autre', ownerUserId: 'quelqu-un-d-autre' }));
    await idbTx(INTAKE_CONTEXT_STORE, 'readwrite', (s) => s.put({
      key: 'quelqu-un-d-autre::b1', dataType: 'intake_context', ownerUserId: 'quelqu-un-d-autre',
      baseId: 'b1', baseName: 'Base fictive', preparedAt: 0, expiresAt: Date.now() + 60_000,
    }));

    expect(await purgeForeignOfflineRecords(USER)).toBe(2);
    expect(await outbox.get('ob-mienne')).not.toBeNull();
    expect(await outbox.get('ob-autre')).toBeNull();
    const contextes = await idbTx<Array<{ ownerUserId?: string | null }>>(INTAKE_CONTEXT_STORE, 'readonly', (s) => s.getAll());
    expect(contextes.some((c) => c.ownerUserId === 'quelqu-un-d-autre')).toBe(false);
  });
});
