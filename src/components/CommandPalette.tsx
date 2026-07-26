import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useI18n } from '../i18n/useI18n';
import type { MessageKey } from '../i18n/messages';
import { useAuth } from '../auth/useAuth';
import { useBaseRepository } from '../data/RepositoryProvider';
import type { BaseListing } from '../data/bases';

// A5 — Recherche globale (Ctrl/Cmd+K) : palette pour sauter vers une base ou un ecran sans la
// souris. Au-dela de ~50 bases, la navigation par listes devient l'irritant principal. Lecture
// seule (aucune ecriture), n'utilise que des methodes de repository existantes.
export const OPEN_PALETTE_EVENT = 'meddata:open-command-palette';

interface Cmd { id: string; label: string; hint?: string; to: string; }

export function CommandPalette() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const bases = useBaseRepository();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [baseList, setBaseList] = useState<BaseListing[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+K bascule la palette ; Echap la ferme ; un bouton d'en-tete peut l'ouvrir via un evenement.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_PALETTE_EVENT, onOpen); };
  }, []);

  // A l'ouverture : (re)initialise, charge les bases une seule fois, met le focus sur le champ.
  useEffect(() => {
    if (!open) return;
    setQuery(''); setSel(0);
    if (!loaded) bases.listMyBases().then(setBaseList).catch(() => setBaseList([])).finally(() => setLoaded(true));
    const h = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(h);
  }, [open, loaded, bases]);

  const actions: Cmd[] = useMemo(() => {
    const list: Cmd[] = [
      { id: 'home', label: t('member.dashboard.title'), to: '/' },
      { id: 'templates', label: t('mytemplates.title'), to: '/templates' },
      { id: 'sync', label: t('status.title'), to: '/sync' },
    ];
    if (profile?.globalRole === 'curateur') list.push({ id: 'pool', label: t('curation.pool_title' as MessageKey), to: '/curation' });
    return list;
  }, [t, profile]);

  const q = query.trim().toLowerCase();
  const results: Cmd[] = useMemo(() => {
    const baseCmds = baseList
      .filter((b) => !q || b.base.name.toLowerCase().includes(q) || (b.base.specialty ?? '').toLowerCase().includes(q))
      .map((b): Cmd => ({ id: `base-${b.base.id}`, label: b.base.name, hint: b.base.specialty ?? undefined, to: `/bases/${b.base.id}` }));
    const actionCmds = actions.filter((a) => !q || a.label.toLowerCase().includes(q));
    return [...baseCmds, ...actionCmds];
  }, [baseList, actions, q]);

  const go = useCallback((to: string) => { setOpen(false); navigate(to); }, [navigate]);

  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[sel]; if (r) go(r.to); }
  }

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={t('search.title')}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-24" onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setSel(0); }} onKeyDown={onInputKey}
          placeholder={t('search.placeholder')} aria-label={t('search.placeholder')}
          className="w-full border-b border-slate-100 px-4 py-3 text-sm outline-none" />
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-slate-400">{t('search.empty')}</li>
          ) : results.map((r, i) => (
            <li key={r.id}>
              <button type="button" onMouseEnter={() => setSel(i)} onClick={() => go(r.to)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${i === sel ? 'bg-teal-50 text-teal-900' : 'text-slate-700'}`}>
                <span>{r.label}</span>
                {r.hint && <span className="text-xs text-slate-400">{r.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-100 px-4 py-1.5 text-xs text-slate-400">{t('search.hint')}</div>
      </div>
    </div>
  );
}
