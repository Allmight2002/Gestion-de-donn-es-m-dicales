import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { useTerminologyRepository } from '../../data/RepositoryProvider';
import { MIN_QUERY_LENGTH, type TerminologyOption } from '../../data/terminology';
import { cacheFreshness, cacheStatus, downloadReference, searchLocal } from '../../data/terminologyCache';
import { errorMessage } from '../../lib/errorMessage';
import { isTerminologyValue, type TerminologyValue } from '../../data/types';
import { useOnline } from '../../data/offline';

// F6 — saisie d'un diagnostic par recherche incrementale.
//
// Un menu deroulant ne tient pas au-dela de quelques dizaines d'entrees ; le referentiel en
// compte des dizaines de milliers. L'utilisateur tape, choisit, et c'est le CODE qui part
// en base avec le libelle affiche — jamais du texte libre.
const DEBOUNCE_MS = 250;

export function TerminologyInput({
  field,
  value,
  onChange,
}: {
  field: { label: string };
  value: unknown;
  onChange: (v: TerminologyValue | null) => void;
}) {
  const { t } = useI18n();
  const repo = useTerminologyRepository();
  const online = useOnline();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<TerminologyOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seule la derniere frappe compte : une reponse lente ne doit pas ecraser une plus recente.
  const requestRef = useRef(0);
  const cacheCheckRef = useRef(0);
  const staleRef = useRef(false);
  // Une copie locale evite un aller-retour reseau a chaque frappe, et permet de saisir
  // sans connexion. Tant qu'elle est absente, on interroge le serveur.
  const [local, setLocal] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [stale, setStale] = useState(false);

  const selected = isTerminologyValue(value) ? value : null;

  useEffect(() => {
    const ticket = ++cacheCheckRef.current;
    const freshness = online
      ? cacheFreshness(repo)
      : cacheStatus().then((status) => status?.count ? (staleRef.current ? 'stale' : 'current') : 'absent');
    void freshness
      .then((state) => {
        if (ticket !== cacheCheckRef.current) return;
        setLocal(state === 'current');
        setStale(state === 'stale');
        staleRef.current = state === 'stale';
        // La publication change rarement, mais une copie obsolete ne doit pas faire perdre
        // silencieusement la recherche hors connexion. Le telechargement reste visible et
        // n'utilise jamais l'ancien contenu pendant son remplacement.
        if (state === 'stale' && online) {
          setDownloading(0);
          void downloadReference(repo, (recus) => setDownloading(recus))
            .then((status) => {
              if (ticket !== cacheCheckRef.current) return;
              setLocal(status.count > 0);
              setStale(false);
              staleRef.current = false;
            })
            .catch((e) => {
              if (ticket === cacheCheckRef.current) setError(errorMessage(e, t('common.error')));
            })
            .finally(() => {
              if (ticket === cacheCheckRef.current) setDownloading(null);
            });
        }
      })
      .catch(() => {
        if (ticket === cacheCheckRef.current) {
          setLocal(false);
          setStale(false);
          staleRef.current = false;
        }
      });
  }, [online, repo, t]);

  async function telecharger() {
    ++cacheCheckRef.current;
    setDownloading(0);
    setError(null);
    try {
      const status = await downloadReference(repo, (recus) => setDownloading(recus));
      setLocal(status.count > 0);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setDownloading(null);
    }
  }

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < MIN_QUERY_LENGTH) {
      setOptions([]);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    const ticket = ++requestRef.current;
    const timer = setTimeout(() => {
      // Copie locale quand elle existe : instantanee et disponible sans reseau.
      void (local ? searchLocal(needle) : repo.search(needle))
        .then((found) => {
          if (ticket !== requestRef.current) return;
          setOptions(found);
          setError(null);
        })
        .catch((e) => {
          if (ticket !== requestRef.current) return;
          setOptions([]);
          setError(errorMessage(e, t('common.error')));
        })
        .finally(() => {
          if (ticket === requestRef.current) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, repo, t, local]);

  function choose(option: TerminologyOption) {
    // Le couple part tel quel : le serveur refusera un libelle qui ne correspond pas au code.
    onChange({ code: option.code, label: option.label });
    setQuery('');
    setOptions([]);
  }

  if (selected) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-sm text-teal-900 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-100">
          {selected.label}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          {t('terminology.change')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {stale && !online ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
          {t('terminology.stale_offline')}
        </p>
      ) : downloading !== null ? (
        <p role="status" className="text-xs text-slate-500">
          {t('terminology.stale_refreshing')} {downloading > 0 ? downloading : ''}
        </p>
      ) : null}
      <input
        type="search"
        className="input"
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-label={field.label}
        autoComplete="off"
        placeholder={t('terminology.search_placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && (
        <p className="text-xs text-slate-500">{t('terminology.min_chars')}</p>
      )}
      {searching && <p className="text-xs text-slate-500">{t('terminology.searching')}</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {options.length > 0 && (
        <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {options.map((o) => (
            <li key={o.id}>
              {/* Le role `option` porte sur l'element ACTIVABLE : sinon un clic sur la ligne
                  ne declenche rien, et les technologies d'assistance annoncent une option
                  qu'elles ne peuvent pas choisir. */}
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => choose(o)}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!searching && !error && options.length === 0 && query.trim().length >= MIN_QUERY_LENGTH && (
        <p className="text-xs text-slate-500">{t('terminology.no_result')}</p>
      )}
      {local ? (
        <p className="text-xs text-slate-400">{t('terminology.local_ready')}</p>
      ) : downloading === null ? (
        <button
          type="button"
          onClick={() => void telecharger()}
          className="text-xs font-medium text-teal-700 hover:underline"
        >
          {t('terminology.download')}
        </button>
      ) : null}
    </div>
  );
}
