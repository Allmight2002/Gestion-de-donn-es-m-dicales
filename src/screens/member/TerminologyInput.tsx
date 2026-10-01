import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { useTerminologyRepository } from '../../data/RepositoryProvider';
import {
  MIN_QUERY_LENGTH,
  type CodedConcept,
  type TerminologyCodingResult,
  type TerminologyOption,
} from '../../data/terminology';
import { cacheFreshness, cacheStatus, downloadReference, searchLocal } from '../../data/terminologyCache';
import { errorMessage } from '../../lib/errorMessage';
import {
  isTerminologyEntry,
  isTerminologyValue,
  type TerminologyFieldEntry,
} from '../../data/types';
import { useOnline } from '../../data/offline';
import {
  MAX_RAW_LENGTH,
  choiceKey,
  confirmEntry,
  entriesFromResult,
  isProvisionalEntry,
  resolveEntry,
  unmatchedEntry,
  type CodingChoice,
} from '../../domain/terminologyCoding';

// F6 — saisie d'un diagnostic par recherche incrementale.
//
// Un menu deroulant ne tient pas au-dela de quelques dizaines d'entrees ; le referentiel en
// compte des dizaines de milliers. L'utilisateur tape, choisit, et c'est le CODE qui part
// en base avec le libelle affiche.
//
// L21 — mode MULTIVALUE (`field.isMultiple`) : un patient porte souvent plusieurs diagnostics.
// Les valeurs choisies s'affichent alors en etiquettes NUMEROTEES, la zone de recherche reste
// visible en dessous, et le rang porte la convention « le premier est le diagnostic principal ».
//
// Codage assiste — le MEME champ accepte aussi le diagnostic ecrit en langage clinique
// (« HSD chronique spontane droit »). Quand l'utilisateur quitte le champ (ou valide par
// Entree) sans avoir choisi de proposition, son texte est d'abord CONSERVE tel quel, puis
// rapproche du referentiel en arriere-plan. Une correspondance claire se code seule, une
// correspondance probable reste « a confirmer », plusieurs correspondances sont proposees au
// choix, et l'absence de correspondance laisse le texte enregistrable, non code. Le texte
// d'origine accompagne toujours le code retenu.
const DEBOUNCE_MS = 250;
// Pendant une pause de frappe sur un texte clinique, le codage est PREPARE (sans rien
// enregistrer) pour que le depart du champ affiche le resultat sans attente.
const PREFETCH_MS = 900;
const MIN_CODING_LENGTH = 3;

type Replacing = { index: number; entry: TerminologyFieldEntry } | null;

export function TerminologyInput({
  field,
  value,
  onChange,
  freeText = true,
}: {
  field: { label: string; isMultiple?: boolean };
  value: unknown;
  onChange: (v: TerminologyFieldEntry | TerminologyFieldEntry[] | null) => void;
  /**
   * `false` : recherche seule, sans texte libre ni codage assiste. Pour un CRITERE de
   * recherche (cohortes), ou seul un concept du referentiel a un sens.
   */
  freeText?: boolean;
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
  // Codage assiste : analyses en cours, propositions en attente de choix, entree a remplacer.
  const [codingCount, setCodingCount] = useState(0);
  const [codingNotice, setCodingNotice] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, CodingChoice>>({});
  const [replacing, setReplacing] = useState<Replacing>(null);
  const prefetchRef = useRef(new Map<string, Promise<TerminologyCodingResult>>());
  const containerRef = useRef<HTMLDivElement>(null);
  // La reponse du codage arrive apres coup : elle doit s'appliquer a la valeur COURANTE.
  const valueRef = useRef(value);
  valueRef.current = value;

  const multiple = field.isMultiple === true;
  const codeText = freeText ? repo.codeText?.bind(repo) : undefined;
  // L'ordre du tableau EST le rang : il n'est ni retrie ni normalise, ici comme au serveur.
  const chosen = multiple && Array.isArray(value) ? value.filter(isTerminologyEntry) : [];
  const selected = !multiple && isTerminologyEntry(value) ? value : null;

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

  // Preparation du codage d'un texte clinique (plusieurs mots) pendant une pause de frappe.
  useEffect(() => {
    const text = query.trim();
    if (!codeText || !online || text.split(/\s+/).length < 2 || text.length < 8) return;
    const timer = setTimeout(() => { void codingFor(text).catch(() => undefined); }, PREFETCH_MS);
    return () => clearTimeout(timer);
    // `codingFor` ne depend que de refs et de `codeText`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, online, codeText]);

  function codingFor(text: string): Promise<TerminologyCodingResult> {
    const cache = prefetchRef.current;
    const known = cache.get(text);
    if (known) return known;
    const pending = codeText!(text);
    cache.set(text, pending);
    // Un echec ne reste pas en cache : un nouvel essai doit pouvoir repartir.
    pending.catch(() => cache.delete(text));
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
    return pending;
  }

  // --- Ecriture de la valeur -------------------------------------------------------------

  function currentEntries(): TerminologyFieldEntry[] {
    const v = valueRef.current;
    if (multiple) return Array.isArray(v) ? v.filter(isTerminologyEntry) : [];
    return isTerminologyEntry(v) ? [v] : [];
  }

  /** Remplace l'entree `index` (ou ajoute en fin si `index` vaut la longueur). */
  function writeEntries(entries: TerminologyFieldEntry[], index: number, next: TerminologyFieldEntry[]) {
    const merged = [...entries.slice(0, index), ...next, ...entries.slice(index + 1)];
    if (multiple) {
      // JAMAIS `[]` : « pas de valeur » n'a qu'une representation, la cle absente.
      onChange(merged.length > 0 ? merged : null);
    } else {
      onChange(merged[0] ?? null);
    }
  }

  function choose(option: TerminologyOption) {
    // Le couple part tel quel : le serveur refusera un libelle qui ne correspond pas au code.
    // Une entree issue du codage assiste garde son texte d'origine : le choix manuel la
    // CORRIGE (`manually_modified`), il ne l'efface pas.
    const couple = replacing
      ? resolveEntry(replacing.entry, option, 'manually_modified')
      : { code: option.code, label: option.label };
    const entries = currentEntries();
    if (replacing) {
      writeEntries(entries, replacing.index, [couple]);
    } else {
      // Multivalue : on AJOUTE EN FIN. Le rang suit l'ordre de saisie, jamais un tri.
      onChange(multiple ? [...chosen, couple] : couple);
    }
    setReplacing(null);
    setQuery('');
    setOptions([]);
  }

  /**
   * Le texte libre devient une valeur. Il est ENREGISTRE immediatement, non code : une
   * sauvegarde pendant l'analyse ne perd rien. Le resultat du codage remplace ensuite cette
   * entree provisoire, si elle est toujours la.
   */
  function commitText(text: string) {
    const raw = text.trim().slice(0, MAX_RAW_LENGTH);
    if (!freeText || raw.length < MIN_CODING_LENGTH) return;
    const provisional = unmatchedEntry(raw);
    const entries = currentEntries();
    const index = replacing ? replacing.index : multiple ? entries.length : 0;
    writeEntries(entries, index, [provisional]);
    setReplacing(null);
    setQuery('');
    setOptions([]);
    setCodingNotice(null);
    if (!codeText || !online) {
      setCodingNotice(t('terminology.coding_offline'));
      return;
    }
    setCodingCount((n) => n + 1);
    void codingFor(raw)
      .then((result) => {
        const now = currentEntries();
        const at = now.findIndex((entry) => isProvisionalEntry(entry, raw));
        // L'utilisateur a retire ou modifie l'entree entre-temps : sa decision l'emporte.
        if (at < 0) return;
        const others = now.filter((_, i) => i !== at).filter(isTerminologyValue).map((e) => e.code);
        const { entries: produced, choices: proposed } = entriesFromResult(raw, result, multiple, others);
        writeEntries(now, at, produced);
        if (proposed.length) {
          setChoices((prev) => {
            const next = { ...prev };
            for (const c of proposed) next[choiceKey(c.raw, c.normalized)] = c;
            return next;
          });
        }
      })
      .catch(() => {
        setCodingNotice(t('terminology.coding_unavailable'));
      })
      .finally(() => setCodingCount((n) => n - 1));
  }

  function onBlur(e: FocusEvent<HTMLInputElement>) {
    // Un clic sur une proposition de la liste n'est pas un depart du champ.
    if (e.relatedTarget && containerRef.current?.contains(e.relatedTarget as Node)) return;
    commitText(query);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    // Entree ne doit jamais soumettre le formulaire englobant a la place du diagnostic.
    e.preventDefault();
    commitText(query);
  }

  function remove(index: number) {
    const next = chosen.filter((_, i) => i !== index);
    // JAMAIS `[]`. La base le refuse deliberement : « pas de valeur » n'a qu'une seule
    // representation — la cle absente, ou un code de donnee manquante. `null` demande donc a
    // l'ecran appelant de RETIRER LA CLE, au lieu d'ecrire une liste vide qu'il refuserait.
    onChange(next.length > 0 ? next : null);
    if (replacing) setReplacing(null);
  }

  function confirm(index: number) {
    const entries = currentEntries();
    const entry = entries[index];
    if (isTerminologyValue(entry)) writeEntries(entries, index, [confirmEntry(entry)]);
  }

  function pick(index: number, concept: CodedConcept) {
    const entries = currentEntries();
    const entry = entries[index];
    if (entry) writeEntries(entries, index, [resolveEntry(entry, concept, 'confirmed')]);
  }

  /** Corriger une entree issue du codage : elle reste en place tant qu'aucun choix n'est fait. */
  function startReplace(index: number) {
    const entry = currentEntries()[index];
    if (!entry) return;
    setReplacing({ index, entry });
    setQuery(isTerminologyValue(entry) ? (entry.raw ?? '') : entry.raw);
  }

  // Un concept deja choisi sort des resultats : le serveur refuse les doublons, l'ecran ne doit
  // pas laisser tenter ce qu'il refusera.
  const visibleOptions = multiple
    ? options.filter((o) => !chosen.some((c) => isTerminologyValue(c) && c.code === o.code))
    : options;

  // --- Rendu ---------------------------------------------------------------------------------

  function entryBody(entry: TerminologyFieldEntry, index: number) {
    if (isTerminologyValue(entry)) {
      const status = entry.coding?.status;
      return (
        <>
          <span title={entry.raw && entry.raw !== entry.label ? `${t('terminology.written')} ${entry.raw}` : undefined}>
            {entry.coding && status !== 'suggested' ? '✓ ' : ''}{entry.label}
          </span>
          {entry.coding && (
            <span className="text-xs text-slate-500 tabular-nums">{entry.code}</span>
          )}
          {status === 'suggested' && (
            <>
              <span className="text-xs text-amber-700 dark:text-amber-300">{t('terminology.to_confirm')}</span>
              <button
                type="button"
                onClick={() => confirm(index)}
                aria-label={`${t('terminology.confirm')} ${entry.label}`}
                className="text-xs font-medium text-teal-700 hover:underline"
              >
                {t('terminology.confirm')}
              </button>
            </>
          )}
        </>
      );
    }
    const choice = choices[choiceKey(entry.raw, entry.coding.normalized)];
    return (
      <span className="flex flex-col gap-1">
        <span className="italic">{entry.raw}</span>
        {codingCount > 0 && isProvisionalEntry(entry, entry.raw) ? (
          <span role="status" className="text-xs text-slate-500">{t('terminology.coding')}</span>
        ) : choice ? (
          <span role="group" aria-label={t('terminology.several_matches')} className="flex flex-col items-start gap-1">
            <span className="text-xs text-slate-600 dark:text-slate-300">{t('terminology.several_matches')}</span>
            {choice.options.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => pick(index, c)}
                className="text-left text-xs font-medium text-teal-700 hover:underline"
              >
                ○ {c.label}
              </button>
            ))}
          </span>
        ) : !isProvisionalEntry(entry, entry.raw) || !codeText ? (
          <span className="text-xs text-slate-500">{t('terminology.no_reliable_match')}</span>
        ) : null}
      </span>
    );
  }

  const chipClass = 'rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-sm text-teal-900 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-100';
  const entryHasCoding = (entry: TerminologyFieldEntry) => !isTerminologyValue(entry) || entry.coding !== undefined;

  if (selected && !replacing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${chipClass} flex flex-wrap items-center gap-1.5`}>
          {entryBody(selected, 0)}
        </span>
        <button
          type="button"
          // Une saisie issue du codage assiste reste affichee tant qu'aucun remplacement n'est
          // choisi : abandonner la correction ne doit pas effacer le diagnostic ecrit.
          onClick={() => (entryHasCoding(selected) ? startReplace(0) : onChange(null))}
          className="text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          {t('terminology.change')}
        </button>
        {codingNotice && <p role="status" className="w-full text-xs text-slate-500">{codingNotice}</p>}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-1">
      {/* Les etiquettes d'abord, la recherche EN DESSOUS et toujours visible : ajouter un
          diagnostic ne doit jamais obliger a en retirer un autre. */}
      {multiple && chosen.length > 0 && (
        <>
          <ul className="flex flex-wrap gap-2">
            {chosen.map((c, index) => (
              <li
                key={isTerminologyValue(c) ? c.code : `${index}:${c.raw}`}
                className={`flex items-center gap-1.5 ${chipClass}`}
              >
                {/* Le NUMERO est le rang, et c'est lui qui porte « le premier est le principal ». */}
                <span className="font-medium tabular-nums">{index + 1}.</span>
                {entryBody(c, index)}
                {entryHasCoding(c) && (
                  <button
                    type="button"
                    onClick={() => startReplace(index)}
                    aria-label={`${t('terminology.change')} ${isTerminologyValue(c) ? c.label : c.raw}`}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    ✎
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={`${t('terminology.remove')} ${isTerminologyValue(c) ? c.label : c.raw}`}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">{t('terminology.rank_hint')}</p>
        </>
      )}
      {replacing && (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          {t('terminology.replacing')}
          <button
            type="button"
            onClick={() => { setReplacing(null); setQuery(''); }}
            className="font-medium text-slate-600 hover:underline"
          >
            {t('common.cancel')}
          </button>
        </p>
      )}
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
        aria-expanded={visibleOptions.length > 0}
        aria-controls={listId}
        aria-label={field.label}
        autoComplete="off"
        maxLength={MAX_RAW_LENGTH}
        placeholder={t(codeText ? 'terminology.free_text_placeholder' : 'terminology.search_placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && (
        <p className="text-xs text-slate-500">{t('terminology.min_chars')}</p>
      )}
      {searching && <p className="text-xs text-slate-500">{t('terminology.searching')}</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {codingNotice && <p role="status" className="text-xs text-slate-500">{codingNotice}</p>}
      {visibleOptions.length > 0 && (
        <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {visibleOptions.map((o) => (
            <li key={o.id}>
              {/* Le role `option` porte sur l'element ACTIVABLE : sinon un clic sur la ligne
                  ne declenche rien, et les technologies d'assistance annoncent une option
                  qu'elles ne peuvent pas choisir. Le `mousedown` garde le focus dans le champ :
                  sans cela, le depart du champ coderait le texte avant que le clic n'arrive. */}
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!searching && !error && visibleOptions.length === 0 && query.trim().length >= MIN_QUERY_LENGTH && (
        <p className="text-xs text-slate-500">
          {t(codeText ? 'terminology.no_result_free_text' : 'terminology.no_result')}
        </p>
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
