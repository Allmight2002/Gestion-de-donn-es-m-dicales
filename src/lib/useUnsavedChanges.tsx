import { useContext, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { UNSAFE_DataRouterContext, UNSAFE_NavigationContext, useBlocker } from 'react-router';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useI18n } from '../i18n/useI18n';

type GuardRequest = { dirty: () => boolean; ask: () => Promise<boolean> };
const leaveGuards = new Map<symbol, GuardRequest>();

/** PWA update and voluntary sign-out use the same guard as form navigation. Automatic
 * session revocation never calls this function and still purges immediately. */
export function requestPageLeave(): Promise<boolean> {
  const guard = [...leaveGuards.values()].reverse().find((entry) => entry.dirty());
  return guard ? guard.ask() : Promise.resolve(true);
}

function LeaveDialog({ open, onConfirm, onCancel }: { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  return <ConfirmDialog open={open} title={t('leave.title')} body={t('leave.body')}
    confirmLabel={t('leave.confirm')} onConfirm={onConfirm} onCancel={onCancel} />;
}

function DataRouteGuard({ shouldBlock }: { shouldBlock: MutableRefObject<() => boolean> }) {
  const blocker = useBlocker(() => shouldBlock.current());
  return <LeaveDialog open={blocker.state === 'blocked'}
    onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
    onCancel={() => blocker.state === 'blocked' && blocker.reset()} />;
}

/** Compatibility for embedded MemoryRouter consumers. The production app uses the data
 * router's blocker, which also covers browser Back/Forward and history restoration. */
function LegacyRouteGuard({ shouldBlock, ask }: { shouldBlock: MutableRefObject<() => boolean>; ask: () => Promise<boolean> }) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const askRef = useRef(ask);
  useLayoutEffect(() => { askRef.current = ask; });
  useEffect(() => {
    const push = navigator.push;
    const replace = navigator.replace;
    const go = navigator.go;
    const guardedPush: typeof push = (...args) => {
      if (!shouldBlock.current()) return push.apply(navigator, args);
      void askRef.current().then((leave) => { if (leave) push.apply(navigator, args); });
    };
    const guardedReplace: typeof replace = (...args) => {
      if (!shouldBlock.current()) return replace.apply(navigator, args);
      void askRef.current().then((leave) => { if (leave) replace.apply(navigator, args); });
    };
    const guardedGo: typeof go = (...args) => {
      if (!shouldBlock.current()) return go.apply(navigator, args);
      void askRef.current().then((leave) => { if (leave) go.apply(navigator, args); });
    };
    navigator.push = guardedPush; navigator.replace = guardedReplace; navigator.go = guardedGo;
    return () => {
      if (navigator.push === guardedPush) navigator.push = push;
      if (navigator.replace === guardedReplace) navigator.replace = replace;
      if (navigator.go === guardedGo) navigator.go = go;
    };
  }, [navigator, shouldBlock]);
  return null;
}

export function useUnsavedChanges(dirty: boolean) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const dirtyRef = useRef(dirty);
  const bypass = useRef(false);
  const pending = useRef<((leave: boolean) => void) | null>(null);
  const [open, setOpen] = useState(false);
  const shouldBlock = useRef(() => dirtyRef.current && !bypass.current);
  useLayoutEffect(() => { dirtyRef.current = dirty; if (dirty) bypass.current = false; }, [dirty]);

  const ask = () => {
    if (!shouldBlock.current()) return Promise.resolve(true);
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => { pending.current = resolve; setOpen(true); });
  };
  const askRef = useRef(ask);
  useLayoutEffect(() => { askRef.current = ask; });
  useEffect(() => {
    const key = Symbol('form-leave');
    leaveGuards.set(key, { dirty: () => shouldBlock.current(), ask: () => askRef.current() });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlock.current()) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      leaveGuards.delete(key); window.removeEventListener('beforeunload', beforeUnload);
      pending.current?.(false); pending.current = null;
    };
  }, []);
  const resolve = (leave: boolean) => {
    if (leave) bypass.current = true;
    const done = pending.current;
    pending.current = null; setOpen(false); done?.(leave);
  };
  const guard: ReactNode = <>
    {dataRouter ? <DataRouteGuard shouldBlock={shouldBlock} /> : <LegacyRouteGuard shouldBlock={shouldBlock} ask={ask} />}
    <LeaveDialog open={open} onConfirm={() => resolve(true)} onCancel={() => resolve(false)} />
  </>;
  return {
    guard,
    allowLeave: () => { bypass.current = true; },
    protect: (action: () => void | Promise<void>) => {
      void ask().then(async (leave) => {
        if (!leave) return;
        try { await action(); } finally { bypass.current = false; }
      });
    },
  };
}

export function useDirtyForm(value: unknown, ready: boolean, contextKey: string) {
  const fingerprint = JSON.stringify(value);
  const [baseline, setBaseline] = useState<{ key: string; fingerprint: string } | null>(null);
  useEffect(() => {
    if (ready && baseline?.key !== contextKey) setBaseline({ key: contextKey, fingerprint });
  }, [ready, contextKey, fingerprint, baseline?.key]);
  const dirty = ready && baseline?.key === contextKey && baseline.fingerprint !== fingerprint;
  const navigation = useUnsavedChanges(dirty);
  return { ...navigation, dirty, resetBaseline: () => setBaseline(null),
    markClean: () => { setBaseline({ key: contextKey, fingerprint }); navigation.allowLeave(); } };
}
