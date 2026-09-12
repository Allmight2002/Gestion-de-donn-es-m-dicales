import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorkDraftRepository } from '../../data/RepositoryProvider';
import { WorkDraftSession, type WorkDraftSessionState } from '../../data/workDraftSession';
import { WORK_DRAFT_DEBOUNCE_MS, WORK_DRAFT_MAX_WAIT_MS, WorkDraftError, type WorkDraft,
  type WorkDraftContext, type WorkDraftIdentity, type WorkDraftPayload, type WorkDraftRepository } from '../../data/workDrafts';

export function useWorkDraft({ context, ownerId, payload, dirty, online, onRestore, repository: override, support = 'server' }: {
  context: WorkDraftContext | null;
  ownerId: string;
  payload: WorkDraftPayload;
  dirty: boolean;
  online: boolean;
  onRestore: (payload: WorkDraftPayload) => void;
  repository?: WorkDraftRepository;
  support?: 'local' | 'server';
}) {
  const defaultRepository = useWorkDraftRepository();
  const repository = override ?? defaultRepository;
  const availableNow = online || support === 'local';
  const key = JSON.stringify([ownerId, context]);
  const fingerprint = JSON.stringify(payload);
  const latest = useRef({ payload, dirty, onRestore, context, online: availableNow });
  useLayoutEffect(() => { latest.current = { payload, dirty, onRestore, context, online: availableNow }; });
  const session = useRef<WorkDraftSession | null>(null);
  const generation = useRef(0);
  const dirtySince = useRef<number | null>(null);
  const deleteOperations = useRef(new Map<string, string>());
  const [state, setState] = useState<WorkDraftSessionState | null>(null);
  const [candidates, setCandidates] = useState<WorkDraft[]>([]);
  const [completed, setCompleted] = useState<WorkDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [discarding, setDiscarding] = useState(false);

  const attach = (next: WorkDraftSession) => {
    if (session.current) session.current.onChange = () => undefined;
    session.current = next;
    next.onChange = (snapshot) => {
      if (session.current !== next) return;
      setState(snapshot);
      if (snapshot.acknowledgedFingerprint === JSON.stringify(latest.current.payload)) dirtySince.current = null;
    };
    setState(next.state);
  };
  const attachRef = useRef(attach);
  useLayoutEffect(() => { attachRef.current = attach; });

  useEffect(() => {
    const token = ++generation.current;
    if (session.current) session.current.onChange = () => undefined;
    session.current = null;
    setState(null); setCandidates([]); setCompleted([]); setLoadError(null); dirtySince.current = null;
    const currentContext = latest.current.context;
    if (!currentContext || !repository.available || !latest.current.online) { setLoading(false); return; }
    setLoading(true);
    void repository.list(currentContext).then((drafts) => {
      if (token !== generation.current) return;
      const active = drafts.filter((draft) => draft.state !== 'consumed');
      setCandidates(active);
      setCompleted(drafts.filter((draft) => draft.state === 'consumed').slice(0, 3));
      if (active.length === 0) attachRef.current(new WorkDraftSession(repository, currentContext));
    }).catch((error: unknown) => {
      if (token === generation.current) setLoadError(error instanceof WorkDraftError ? error.message : new WorkDraftError('DRAFT_UNAVAILABLE').message);
    }).finally(() => { if (token === generation.current) setLoading(false); });
    return () => { generation.current += 1; if (session.current) session.current.onChange = () => undefined; };
  }, [key, repository, revision]);

  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && !session.current && context) setRevision((value) => value + 1);
    else if (online && !wasOnline.current && session.current?.state.status === 'error' && !session.current.state.locked) {
      void session.current.flush(latest.current.payload).catch(() => undefined);
    }
    wasOnline.current = online;
  }, [online, context]);

  useEffect(() => {
    const active = session.current;
    if (!availableNow || !dirty || !active || candidates.length || active.state.locked || active.state.status === 'conflict' || active.state.status === 'error'
      || active.state.acknowledgedFingerprint === fingerprint) return;
    dirtySince.current ??= Date.now();
    const delay = Math.min(WORK_DRAFT_DEBOUNCE_MS, Math.max(0, WORK_DRAFT_MAX_WAIT_MS - (Date.now() - dirtySince.current)));
    const timer = setTimeout(() => { void active.flush(latest.current.payload).catch(() => undefined); }, delay);
    return () => clearTimeout(timer);
  }, [fingerprint, availableNow, dirty, candidates.length, state?.receipt?.revision, state?.locked, state?.status]);

  function resume(draft: WorkDraft) {
    const currentContext = latest.current.context;
    if (!currentContext || draft.context.templateVersionId !== currentContext.templateVersionId
      || draft.context.entityRevision !== currentContext.entityRevision) {
      setLoadError(new WorkDraftError('DRAFT_CONTEXT_CHANGED').message);
      return;
    }
    attach(new WorkDraftSession(repository, currentContext, draft));
    setCandidates([]); setLoadError(null);
    latest.current.onRestore(draft.payload);
  }
  function startNew() {
    if (!latest.current.context) return;
    attach(new WorkDraftSession(repository, latest.current.context)); setCandidates([]); setLoadError(null);
  }
  async function discard(draft: WorkDraft) {
    if (discarding) return;
    setDiscarding(true);
    try {
      const attemptKey = `${draft.id}:${draft.revision}`;
      const operationId = deleteOperations.current.get(attemptKey) ?? crypto.randomUUID();
      deleteOperations.current.set(attemptKey, operationId);
      await repository.discard(draft.id, draft.revision, operationId);
      setCandidates((before) => before.filter((candidate) => candidate.id !== draft.id));
      if (candidates.length === 1) startNew();
    } catch (error) { setLoadError(error instanceof Error ? error.message : new WorkDraftError('DRAFT_UNAVAILABLE').message); }
    finally { setDiscarding(false); }
  }
  async function commit(identity?: WorkDraftIdentity) {
    if (!session.current || loading || candidates.length) throw new WorkDraftError('DRAFT_UNAVAILABLE');
    return session.current.commit(latest.current.payload, identity);
  }
  return {
    enabled: repository.available && context !== null, support,
    state, loading, error: loadError ?? state?.error ?? null, candidates, completed, discarding,
    locked: state?.locked ?? false,
    protected: availableNow && state?.status === 'saved' && state.acknowledgedFingerprint === fingerprint,
    resume, startNew, discard, commit,
    refresh: () => setRevision((value) => value + 1),
    retry: () => {
      if (session.current && !session.current.state.locked) void session.current.flush(latest.current.payload).catch(() => undefined);
      else if (!session.current) setRevision((value) => value + 1);
    },
  };
}
