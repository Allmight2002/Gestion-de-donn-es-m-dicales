import { WorkDraftError, type WorkDraft, type WorkDraftCommitReceipt, type WorkDraftContext,
  type WorkDraftIdentity, type WorkDraftPayload, type WorkDraftReceipt, type WorkDraftRepository } from './workDrafts';

export interface WorkDraftSessionState {
  status: 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'consumed';
  locked: boolean;
  acknowledgedFingerprint: string | null;
  receipt: WorkDraftReceipt | null;
  error: string | null;
}
type SaveAttempt = { operationId: string; expectedRevision: number; payload: WorkDraftPayload; fingerprint: string };
type CommitAttempt = { operationId: string; revision: number; identity?: WorkDraftIdentity; fingerprint: string };
const conflictCodes = new Set(['DRAFT_CONFLICT', 'DRAFT_CONTEXT_CHANGED', 'DRAFT_CLOSED', 'DRAFT_FORBIDDEN', 'DRAFT_OPERATION_CONFLICT']);

/** Serializes a single form's work. An uncertain request is retried with the same key and
 * exact snapshot before newer keystrokes are sent. Acknowledgement never writes form state. */
export class WorkDraftSession {
  readonly id: string;
  state: WorkDraftSessionState;
  onChange: (state: WorkDraftSessionState) => void = () => undefined;
  private desired: { payload: WorkDraftPayload; fingerprint: string } | null = null;
  private pendingSave: SaveAttempt | null = null;
  private pendingCommit: CommitAttempt | null = null;
  private flight: Promise<WorkDraftReceipt> | null = null;
  private commitFlight: Promise<WorkDraftCommitReceipt> | null = null;
  private blocked = false;

  constructor(private readonly repository: WorkDraftRepository, readonly context: WorkDraftContext, restored?: WorkDraft) {
    this.id = restored?.id ?? crypto.randomUUID();
    this.state = { status: restored ? 'saved' : 'idle', locked: false, error: null,
      receipt: restored ?? null, acknowledgedFingerprint: restored ? JSON.stringify(restored.payload) : null };
  }
  private publish(patch: Partial<WorkDraftSessionState>) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }
  private fail(error: unknown) {
    const failure = error instanceof WorkDraftError ? error : new WorkDraftError('DRAFT_UNAVAILABLE');
    this.blocked = conflictCodes.has(failure.code);
    this.publish({ status: this.blocked ? 'conflict' : 'error', error: failure.message });
    return failure;
  }
  private flushInternal(payload: WorkDraftPayload): Promise<WorkDraftReceipt> {
    if (this.blocked || this.state.status === 'consumed') return Promise.reject(new WorkDraftError('DRAFT_CLOSED'));
    const fingerprint = JSON.stringify(payload);
    this.desired = { payload: JSON.parse(fingerprint) as WorkDraftPayload, fingerprint };
    if (this.flight) return this.flight;
    if (!this.pendingSave && this.state.acknowledgedFingerprint === fingerprint && this.state.receipt) return Promise.resolve(this.state.receipt);
    this.flight = this.drain().finally(() => { this.flight = null; });
    return this.flight;
  }
  private async drain(): Promise<WorkDraftReceipt> {
    while (this.pendingSave || this.desired?.fingerprint !== this.state.acknowledgedFingerprint) {
      if (!this.desired) throw new WorkDraftError('DRAFT_INVALID');
      const attempt = this.pendingSave ?? { ...this.desired, expectedRevision: this.state.receipt?.revision ?? 0, operationId: crypto.randomUUID() };
      this.pendingSave = attempt;
      this.publish({ status: 'saving', error: null });
      try {
        const receipt = await this.repository.save(this.context, this.id, attempt.expectedRevision, attempt.operationId, attempt.payload);
        this.pendingSave = null;
        this.publish({ status: 'saved', receipt, acknowledgedFingerprint: attempt.fingerprint, error: null });
      } catch (error) {
        const failure = this.fail(error);
        if (failure.code !== 'DRAFT_UNAVAILABLE') this.pendingSave = null;
        throw failure;
      }
    }
    return this.state.receipt!;
  }
  flush(payload: WorkDraftPayload): Promise<WorkDraftReceipt> {
    if (this.state.locked) return Promise.reject(new WorkDraftError('DRAFT_OPERATION_CONFLICT'));
    return this.flushInternal(payload);
  }
  commit(payload: WorkDraftPayload, identity?: WorkDraftIdentity): Promise<WorkDraftCommitReceipt> {
    if (this.commitFlight) return this.commitFlight;
    this.commitFlight = this.performCommit(payload, identity).finally(() => { this.commitFlight = null; });
    return this.commitFlight;
  }
  private async performCommit(payload: WorkDraftPayload, identity?: WorkDraftIdentity): Promise<WorkDraftCommitReceipt> {
    const fingerprint = JSON.stringify({ payload, identity });
    if (this.pendingCommit && this.pendingCommit.fingerprint !== fingerprint) throw new WorkDraftError('DRAFT_OPERATION_CONFLICT');
    this.publish({ locked: true });
    try {
      if (!this.pendingCommit) {
        const receipt = await this.flushInternal(payload);
        this.pendingCommit = { operationId: crypto.randomUUID(), revision: receipt.revision,
          identity: identity ? JSON.parse(JSON.stringify(identity)) as WorkDraftIdentity : undefined, fingerprint };
      }
      const attempt = this.pendingCommit;
      const result = await this.repository.commit(this.id, attempt.revision, attempt.operationId, attempt.identity);
      this.pendingCommit = null;
      this.publish({ status: 'consumed', error: null, locked: true });
      return result;
    } catch (error) {
      const failure = this.fail(error);
      // An unknown commit outcome freezes further edits until that exact operation is
      // acknowledged. Definitive rejections allow correction without losing any inputs.
      if (failure.code !== 'DRAFT_UNAVAILABLE') this.pendingCommit = null;
      this.publish({ locked: this.pendingCommit !== null });
      throw failure;
    }
  }
}
