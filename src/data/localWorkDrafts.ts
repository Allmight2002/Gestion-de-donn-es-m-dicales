import { getOfflineUser, idbAtomic, idbTx, INTAKE_CONTEXT_STORE, LOCAL_WORK_DRAFT_STORE, OUTBOX_STORE,
  OUTBOX_TTL_MS, notifyOutboxChange, type IntakeEntry, type PatientCreateEntry } from './offline';
import { canonicalJson, fingerprintPayload, isLocalPatientId, isOfflineIntakeEnabled, newLocalEncounterId,
  newLocalPatientId, offlinePatientCode, sha256Hex, type OfflineIntakeContext } from './offlineIntake';
import { hiddenFieldKeys, withoutHiddenValues } from '../domain/validation';
import { WORK_DRAFT_MAX_BYTES, WorkDraftError, type WorkDraft, type WorkDraftCommitReceipt, type WorkDraftContext,
  type WorkDraftPayload, type WorkDraftReceipt, type WorkDraftRepository } from './workDrafts';

type StoredDraft = Omit<WorkDraft, 'state'> & { ownerUserId: string; state: WorkDraft['state'] | 'deleted' | 'expired';
  operations: Record<string, { fingerprint: string; result: WorkDraftReceipt | WorkDraftCommitReceipt | null }> };
const ttl = 24 * 60 * 60 * 1000;
const envelopeKeys = new Set(['values', 'code', 'encounterType', 'encounterDate', 'status', 'ageUnit', 'reason']);
function account() {
  const owner = getOfflineUser();
  if (!owner || !isOfflineIntakeEnabled()) throw new WorkDraftError('DRAFT_FORBIDDEN');
  return owner;
}
function receipt(draft: StoredDraft): WorkDraftReceipt {
  return { id: draft.id, revision: draft.revision, updatedAt: draft.updatedAt, expiresAt: draft.expiresAt };
}
function checkContext(context: WorkDraftContext, owner: string, contexts: OfflineIntakeContext[], outbox: IntakeEntry[]) {
  if (getOfflineUser() !== owner || !isOfflineIntakeEnabled()) throw new WorkDraftError('DRAFT_FORBIDDEN');
  const prepared = contexts.find((candidate) => candidate.baseId === context.baseId && candidate.ownerUserId === owner);
  if (!prepared || prepared.expiresAt <= Date.now() || !prepared.permissions.canCreateStructuredData) throw new WorkDraftError('DRAFT_FORBIDDEN');
  if (prepared.templateVersionId !== context.templateVersionId) throw new WorkDraftError('DRAFT_CONTEXT_CHANGED');
  if (context.kind === 'patient_create' && context.targetId === null) return { prepared, parent: null };
  if (context.kind === 'encounter_create' && context.targetId && isLocalPatientId(context.targetId)) {
    const parent = outbox.find((entry): entry is PatientCreateEntry => entry.kind === 'patient_create' && entry.localPatientId === context.targetId
      && entry.baseId === context.baseId && entry.ownerUserId === owner);
    if (!parent || ['expired', 'rejected', 'conflict'].includes(parent.state) || parent.expiresAt <= Date.now()) throw new WorkDraftError('DRAFT_FORBIDDEN');
    return { prepared, parent };
  }
  throw new WorkDraftError('DRAFT_FORBIDDEN');
}
function checkPayload(payload: WorkDraftPayload, context: WorkDraftContext, prepared: OfflineIntakeContext) {
  const scope = context.kind === 'patient_create' ? 'patient' : 'encounter';
  if (!payload || !payload.values || Array.isArray(payload.values) || typeof payload.values !== 'object'
    || Object.keys(payload).some((key) => !envelopeKeys.has(key))
    || Object.entries(payload).some(([key, value]) => key !== 'values' && value !== null && typeof value !== 'string')
    || new TextEncoder().encode(JSON.stringify(payload)).byteLength > WORK_DRAFT_MAX_BYTES
    || Object.keys(payload.values).some((key) => !prepared.fields.some((field) => field.scope === scope && field.fieldKey === key))) throw new WorkDraftError('DRAFT_INVALID');
}

// A read/write transaction spans work, the prepared permissions and the existing intake
// queue. Creating an outbox operation and consuming its work revision happen together.
async function transact<T>(run: (transaction: IDBTransaction, owner: string, contexts: OfflineIntakeContext[], outbox: IntakeEntry[], done: (result: T) => void) => void): Promise<T> {
  const owner = account();
  try {
    return await idbAtomic<T>([LOCAL_WORK_DRAFT_STORE, INTAKE_CONTEXT_STORE, OUTBOX_STORE], (transaction, done, fail) => {
      const contexts = transaction.objectStore(INTAKE_CONTEXT_STORE).getAll();
      contexts.onsuccess = () => {
        const outbox = transaction.objectStore(OUTBOX_STORE).getAll();
        outbox.onsuccess = () => {
          try { run(transaction, owner, contexts.result, outbox.result, done); } catch (error) { fail(error); }
        };
      };
    });
  } catch (error) { throw error instanceof WorkDraftError ? error : new WorkDraftError('DRAFT_UNAVAILABLE', 'local'); }
}
function readDraft(transaction: IDBTransaction, id: string, handle: (draft: StoredDraft | undefined) => void) {
  const request = transaction.objectStore(LOCAL_WORK_DRAFT_STORE).get(id);
  request.onsuccess = () => {
    try { handle(request.result); }
    catch (error) {
      // IDB exceptions thrown from a success handler must abort instead of committing
      // earlier writes. Attach the functional cause for the outer transaction handler.
      transaction.dispatchEvent(new CustomEvent('draft-error', { detail: error }));
    }
  };
}
function onDraftError(transaction: IDBTransaction, fail: (error: unknown) => void) {
  transaction.addEventListener('draft-error', (event) => fail((event as CustomEvent).detail), { once: true });
}

async function mutate<T>(id: string, run: (draft: StoredDraft | undefined, transaction: IDBTransaction, owner: string, contexts: OfflineIntakeContext[], outbox: IntakeEntry[]) => T): Promise<T> {
  const owner = account();
  try {
    return await idbAtomic<T>([LOCAL_WORK_DRAFT_STORE, INTAKE_CONTEXT_STORE, OUTBOX_STORE], (transaction, done, fail) => {
      onDraftError(transaction, fail);
      const contexts = transaction.objectStore(INTAKE_CONTEXT_STORE).getAll();
      contexts.onsuccess = () => {
        const outbox = transaction.objectStore(OUTBOX_STORE).getAll();
        outbox.onsuccess = () => readDraft(transaction, id, (draft) => done(run(draft, transaction, owner, contexts.result, outbox.result)));
      };
    });
  } catch (error) { throw error instanceof WorkDraftError ? error : new WorkDraftError('DRAFT_UNAVAILABLE', 'local'); }
}

export const localWorkDraftRepository: WorkDraftRepository = {
  get available() { return isOfflineIntakeEnabled() && !!getOfflineUser(); },
  async list(context) {
    return transact<WorkDraft[]>((transaction, owner, contexts, outbox, done) => {
      const prepared = contexts.find((candidate) => candidate.baseId === context.baseId && candidate.ownerUserId === owner);
      if (!prepared) throw new WorkDraftError('DRAFT_FORBIDDEN');
      checkContext({ ...context, templateVersionId: prepared.templateVersionId, entityRevision: null }, owner, contexts, outbox);
      const store = transaction.objectStore(LOCAL_WORK_DRAFT_STORE); const request = store.getAll();
      request.onsuccess = () => {
        const records = (request.result as StoredDraft[]).filter((draft) => draft.ownerUserId === owner);
        for (const draft of records) if (draft.state === 'active' && Date.parse(draft.expiresAt) <= Date.now()) store.put({ ...draft, payload: { values: {} }, state: 'expired' });
        done(records.filter((draft) => draft.context.baseId === context.baseId && draft.context.kind === context.kind && draft.context.targetId === context.targetId
          && ['active', 'consumed'].includes(draft.state) && Date.parse(draft.expiresAt) > Date.now())
          .map(({ operations: _operations, ownerUserId: _owner, ...draft }) => draft as WorkDraft).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      };
    });
  },
  async save(context, id, expectedRevision, operationId, payload) {
    const fingerprint = await sha256Hex(canonicalJson({ context, expectedRevision, payload }));
    return mutate(id, (draft, transaction, owner, contexts, outbox) => {
      const { prepared } = checkContext(context, owner, contexts, outbox); checkPayload(payload, context, prepared);
      if (draft && (draft.ownerUserId !== owner || canonicalJson(draft.context) !== canonicalJson(context))) throw new WorkDraftError('DRAFT_FORBIDDEN');
      const operation = draft?.operations[operationId];
      if (operation) { if (operation.fingerprint !== fingerprint) throw new WorkDraftError('DRAFT_OPERATION_CONFLICT'); return operation.result as WorkDraftReceipt; }
      if (draft && (draft.state !== 'active' || Date.parse(draft.expiresAt) <= Date.now())) throw new WorkDraftError('DRAFT_CLOSED');
      if ((draft?.revision ?? 0) !== expectedRevision) throw new WorkDraftError('DRAFT_CONFLICT');
      if (!draft) {
        const all = transaction.objectStore(LOCAL_WORK_DRAFT_STORE).getAll();
        all.onsuccess = () => {
          if ((all.result as StoredDraft[]).filter((candidate) => candidate.ownerUserId === owner && candidate.state === 'active' && Date.parse(candidate.expiresAt) > Date.now()).length >= 50) {
            transaction.dispatchEvent(new CustomEvent('draft-error', { detail: new WorkDraftError('DRAFT_QUOTA') }));
          }
        };
      }
      const next: StoredDraft = { id, ownerUserId: owner, revision: expectedRevision + 1, context,
        payload: JSON.parse(JSON.stringify(payload)) as WorkDraftPayload, state: 'active', updatedAt: new Date().toISOString(),
        expiresAt: draft?.expiresAt ?? new Date(Date.now() + ttl).toISOString(), operations: { ...draft?.operations } };
      const result = receipt(next); next.operations[operationId] = { fingerprint, result };
      transaction.objectStore(LOCAL_WORK_DRAFT_STORE).put(next); return result;
    });
  },
  async discard(id, expectedRevision, operationId) {
    await mutate(id, (draft, transaction, owner, contexts, outbox) => {
      if (!draft || draft.ownerUserId !== owner) throw new WorkDraftError('DRAFT_FORBIDDEN');
      checkContext(draft.context, owner, contexts, outbox);
      const fingerprint = `delete:${expectedRevision}`;
      if (draft.operations[operationId]) { if (draft.operations[operationId].fingerprint !== fingerprint) throw new WorkDraftError('DRAFT_OPERATION_CONFLICT'); return; }
      if (draft.state !== 'active' || draft.revision !== expectedRevision) throw new WorkDraftError('DRAFT_CONFLICT');
      transaction.objectStore(LOCAL_WORK_DRAFT_STORE).put({ ...draft, state: 'deleted', payload: { values: {} }, revision: draft.revision + 1,
        operations: { ...draft.operations, [operationId]: { fingerprint, result: null } } });
    });
  },
  async commit(id, expectedRevision, operationId, identity) {
    const owner = account();
    const snapshot = await idbTx<StoredDraft | undefined>(LOCAL_WORK_DRAFT_STORE, 'readonly', (store) => store.get(id));
    if (!snapshot || snapshot.ownerUserId !== owner) throw new WorkDraftError('DRAFT_FORBIDDEN');
    const fingerprint = await sha256Hex(canonicalJson({ commit: id, expectedRevision, identity }));
    const code = snapshot.payload.code?.trim() || await offlinePatientCode(id);
    // Hashing is done before opening the write transaction; its revision is rechecked below.
    const prepared = await idbTx<OfflineIntakeContext[]>(INTAKE_CONTEXT_STORE, 'readonly', (store) => store.getAll());
    const context = prepared.find((candidate) => candidate.baseId === snapshot.context.baseId && candidate.ownerUserId === owner);
    if (!context) throw new WorkDraftError('DRAFT_FORBIDDEN');
    const fields = context.fields.filter((field) => field.scope === (snapshot.context.kind === 'patient_create' ? 'patient' : 'encounter'));
    const applicable = fields.filter((field) => !field.encounterTypes?.length || field.encounterTypes.includes(snapshot.payload.encounterType ?? ''));
    const active = Object.fromEntries(Object.entries(snapshot.payload.values).filter(([key]) => applicable.some((field) => field.fieldKey === key)));
    const values = withoutHiddenValues(active, hiddenFieldKeys(context.rules, active, applicable, context.sections)).values;
    const payload = snapshot.context.kind === 'patient_create' ? { code, fullName: identity?.fullName ?? null, dateOfBirth: identity?.dateOfBirth ?? null,
      phone: identity?.phone ?? null, address: identity?.address ?? null, externalIdentifier: identity?.externalIdentifier ?? null, permanentData: values }
      : { encounterType: snapshot.payload.encounterType ?? '', encounterDate: snapshot.payload.encounterDate ?? '', validationStatus: snapshot.payload.status ?? 'draft', ageUnit: snapshot.payload.ageUnit ?? 'years', data: values };
    const payloadHash = await fingerprintPayload(payload);
    const result = await mutate(id, (draft, transaction, currentOwner, contexts, outbox) => {
      if (!draft || draft.ownerUserId !== currentOwner) throw new WorkDraftError('DRAFT_FORBIDDEN');
      const { prepared, parent } = checkContext(draft.context, currentOwner, contexts, outbox);
      if (identity && Object.values(identity).some((value) => value !== null) && !prepared.permissions.canViewIdentity) throw new WorkDraftError('DRAFT_FORBIDDEN');
      if (draft.operations[operationId]) {
        if (draft.operations[operationId].fingerprint !== fingerprint) throw new WorkDraftError('DRAFT_OPERATION_CONFLICT');
        return draft.operations[operationId].result as WorkDraftCommitReceipt;
      }
      if (draft.state !== 'active' || Date.parse(draft.expiresAt) <= Date.now()) throw new WorkDraftError('DRAFT_CLOSED');
      if (draft.revision !== expectedRevision || snapshot.revision !== expectedRevision) throw new WorkDraftError('DRAFT_CONFLICT');
      if (outbox.some((entry) => entry.id === id)) throw new WorkDraftError('DRAFT_OPERATION_CONFLICT');
      const common = { id, dataType: 'intake_outbox' as const, baseId: draft.context.baseId, state: 'pending' as const, fingerprint: payloadHash,
        createdAt: Date.now(), expiresAt: Date.now() + OUTBOX_TTL_MS, attemptCount: 0, ownerUserId: currentOwner };
      const entry: IntakeEntry = parent ? { ...common, kind: 'encounter_create', parentOperationKey: parent.id, localEncounterId: newLocalEncounterId(),
        payload: payload as Extract<IntakeEntry, { kind: 'encounter_create' }>['payload'] }
        : { ...common, kind: 'patient_create', localPatientId: newLocalPatientId(), payload: payload as PatientCreateEntry['payload'] };
      const result = { id: entry.kind === 'patient_create' ? entry.localPatientId : entry.localEncounterId, ...(entry.kind === 'patient_create' ? { code } : {}) };
      transaction.objectStore(OUTBOX_STORE).put(entry);
      transaction.objectStore(LOCAL_WORK_DRAFT_STORE).put({ ...draft, state: 'consumed', payload: { values: {} }, result,
        revision: draft.revision + 1, updatedAt: new Date().toISOString(), operations: { ...draft.operations, [operationId]: { fingerprint, result } } });
      return result;
    });
    notifyOutboxChange(); return result;
  },
};
