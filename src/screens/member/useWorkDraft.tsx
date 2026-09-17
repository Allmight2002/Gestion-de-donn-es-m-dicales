import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorkDraftRepository } from '../../data/RepositoryProvider';
import { WorkDraftSession, type WorkDraftSessionState } from '../../data/workDraftSession';
import { WORK_DRAFT_DEBOUNCE_MS, WORK_DRAFT_MAX_WAIT_MS, WorkDraftError, type WorkDraft,
  type WorkDraftContext, type WorkDraftIdentity, type WorkDraftPayload, type WorkDraftRepository } from '../../data/workDrafts';

const sameForm = (draft: WorkDraft, expected: WorkDraftContext) => draft.context.baseId === expected.baseId
  && draft.context.kind === expected.kind && draft.context.targetId === expected.targetId;

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
  const latest = useRef({ key, payload, dirty, onRestore, context, online: availableNow });
  useLayoutEffect(() => { latest.current = { key, payload, dirty, onRestore, context, online: availableNow }; });
  const session = useRef<WorkDraftSession | null>(null);
  // Issue de l'initialisation en cours : un enregistrement demande avant sa fin l'attend au
  // lieu d'etre refuse. Toujours tenue, jamais rejetee (la liste gere son propre echec).
  const initialization = useRef<Promise<void> | null>(null);
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
  const discardFlight = useRef<number | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const enabled = repository.available && context !== null;
  const loadingCurrent = loading || (enabled && availableNow && loadedKey !== key);

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
    setLoadedKey(null); setDiscarding(false); discardFlight.current = null;
    initialization.current = null;
    const currentContext = latest.current.context;
    if (!currentContext || !repository.available || !latest.current.online) { setLoading(false); return; }
    setLoading(true);
    initialization.current = repository.list(currentContext).then((drafts) => {
      if (token !== generation.current) return;
      const active = drafts.filter((draft) => draft.state === 'active' && sameForm(draft, currentContext));
      setCandidates(active);
      setCompleted(drafts.filter((draft) => draft.state === 'consumed' && sameForm(draft, currentContext)).slice(0, 3));
      if (active.length === 0) attachRef.current(new WorkDraftSession(repository, currentContext));
    }).catch((error: unknown) => {
      if (token === generation.current) setLoadError(error instanceof WorkDraftError ? error.message : new WorkDraftError('DRAFT_UNAVAILABLE').message);
    }).finally(() => { if (token === generation.current) { setLoading(false); setLoadedKey(key); } });
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
    if (discardFlight.current !== null || loadingCurrent) return;
    if (!currentContext || !sameForm(draft, currentContext) || draft.context.templateVersionId !== currentContext.templateVersionId
      || draft.context.entityRevision !== currentContext.entityRevision) {
      setLoadError(new WorkDraftError('DRAFT_CONTEXT_CHANGED').message);
      return;
    }
    attach(new WorkDraftSession(repository, currentContext, draft));
    setCandidates([]); setLoadError(null);
    latest.current.onRestore(draft.payload);
  }
  function startNew() {
    if (!latest.current.context || discardFlight.current !== null || loadingCurrent) return;
    attach(new WorkDraftSession(repository, latest.current.context)); setCandidates([]); setLoadError(null);
  }
  async function discard(draft: WorkDraft) {
    const currentContext = latest.current.context;
    if (discardFlight.current !== null || loadingCurrent || !currentContext || !availableNow) return false;
    const token = generation.current;
    if (!sameForm(draft, currentContext) || draft.state !== 'active'
      || !candidates.some((candidate) => candidate.id === draft.id && candidate.revision === draft.revision)) return false;
    discardFlight.current = token;
    setDiscarding(true);
    setLoadError(null);
    try {
      const attemptKey = `${draft.id}:${draft.revision}`;
      const operationId = deleteOperations.current.get(attemptKey) ?? crypto.randomUUID();
      deleteOperations.current.set(attemptKey, operationId);
      await repository.discard(draft.id, draft.revision, operationId);
      if (token !== generation.current || latest.current.key !== key) return false;
      const remaining = candidates.filter((candidate) => candidate.id !== draft.id);
      setCandidates(remaining);
      if (remaining.length === 0) {
        attach(new WorkDraftSession(repository, currentContext));
        setLoadError(null);
        dirtySince.current = null;
      }
      return true;
    } catch (error) {
      if (token === generation.current) setLoadError(error instanceof WorkDraftError ? error.message : new WorkDraftError('DRAFT_UNAVAILABLE', support).message);
      return false;
    } finally {
      if (discardFlight.current === token) { discardFlight.current = null; setDiscarding(false); }
    }
  }
  // « Commencer une nouvelle saisie » supprime TOUTES les saisies proposees pour ce formulaire.
  // En laisser une derriere ferait reapparaitre a la visite suivante des donnees explicitement
  // abandonnees. Chaque suppression garde sa cle d'operation : une reprise apres echec rejoue
  // les memes suppressions, jamais des suppressions supplementaires.
  async function discardAllAndStartNew(onCleared: () => void) {
    const currentContext = latest.current.context;
    if (discardFlight.current !== null || loadingCurrent || !currentContext || !availableNow) return false;
    const targets = candidates.filter((candidate) => candidate.state === 'active' && sameForm(candidate, currentContext));
    if (targets.length === 0) return false;
    const token = generation.current;
    discardFlight.current = token;
    setDiscarding(true);
    setLoadError(null);
    try {
      for (const [index, target] of targets.entries()) {
        const attemptKey = `${target.id}:${target.revision}`;
        const operationId = deleteOperations.current.get(attemptKey) ?? crypto.randomUUID();
        deleteOperations.current.set(attemptKey, operationId);
        try {
          await repository.discard(target.id, target.revision, operationId);
        } catch (error) {
          // Un echec en cours de route ne laisse pas croire que tout est efface : les saisies
          // restantes restent proposees, et la reprise ne retente que celles-la.
          if (token === generation.current) {
            setCandidates(targets.slice(index));
            setLoadError(error instanceof WorkDraftError ? error.message : new WorkDraftError('DRAFT_UNAVAILABLE', support).message);
          }
          return false;
        }
      }
      if (token !== generation.current || latest.current.key !== key) return false;
      setCandidates([]);
      onCleared();
      attach(new WorkDraftSession(repository, currentContext));
      setLoadError(null);
      dirtySince.current = null;
      return true;
    } finally {
      if (discardFlight.current === token) { discardFlight.current = null; setDiscarding(false); }
    }
  }
  // Le clic peut preceder la fin de `list_work_drafts` : attendre l'issue de l'initialisation,
  // sinon une saisie rapide repart avec un message de brouillon alors que la FICHE n'a pas ete
  // ecrite. Apres l'attente, seuls des refs decident : l'etat du rendu du clic est perime. Une
  // session n'est attachee que sans reprise en attente (liste, resume, startNew, discard) ; son
  // absence couvre donc la liste en echec, le contexte change et les brouillons a arbitrer.
  async function commit(identity?: WorkDraftIdentity) {
    await initialization.current;
    if (!session.current || discardFlight.current !== null) throw new WorkDraftError('DRAFT_UNAVAILABLE');
    return session.current.commit(latest.current.payload, identity);
  }
  return {
    enabled, support, dirty,
    state, loading: loadingCurrent, error: loadError ?? state?.error ?? null, candidates, completed, discarding,
    locked: state?.locked ?? false,
    protected: availableNow && state?.status === 'saved' && state.acknowledgedFingerprint === fingerprint,
    resume, startNew, discard, discardAllAndStartNew, commit,
    refresh: () => setRevision((value) => value + 1),
    retry: () => {
      if (session.current && !session.current.state.locked) void session.current.flush(latest.current.payload).catch(() => undefined);
      else if (!session.current) setRevision((value) => value + 1);
    },
  };
}
