import { useEffect, useId, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { Menu, MenuItem } from '../../components/Menu';
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
  isUnmatchedTerminology,
  type TerminologyFieldEntry,
  type TerminologyValue,
  type UnmatchedTerminologyValue,
} from '../../data/types';
import { useOnline } from '../../data/offline';
import {
  MAX_RAW_LENGTH,
  choiceKey,
  confirmEntry,
  entriesFromResult,
  isProvisionalEntry,
  proposalsFromResult,
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

// Revue post-optimisation (C4) : la copie locale des diagnostics sert a tout l'appareil. Le lien
// « Télécharger… » ne s'affiche donc qu'une fois par ecran, au lieu de se repeter sous chaque
// champ : sous le premier champ de diagnostic de la page qui montre sa zone de recherche. Une
// valeur unique deja choisie n'en montre pas ; elle ne doit donc pas retenir le lien.
type DownloadOwner = { id: symbol; node: HTMLElement };
let downloadOwners: readonly DownloadOwner[] = [];
const downloadOwnerListeners = new Set<() => void>();
const notifyDownloadOwners = () => downloadOwnerListeners.forEach((listener) => listener());
function subscribeDownloadOwners(listener: () => void) {
  downloadOwnerListeners.add(listener);
  return () => { downloadOwnerListeners.delete(listener); };
}
function useFirstDownloadOwner(anchor: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [id] = useState(() => Symbol('terminology-download'));
  useEffect(() => {
    const node = anchor.current;
    if (!active || !node) return;
    // Rang dans la page, pas ordre d'arrivee : un champ qui retrouve sa recherche (« Changer »)
    // reprend le lien s'il est au-dessus des autres.
    const at = downloadOwners.findIndex((owner) => owner.node.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING);
    downloadOwners = at < 0 ? [...downloadOwners, { id, node }] : [...downloadOwners.slice(0, at), { id, node }, ...downloadOwners.slice(at)];
    notifyDownloadOwners();
    return () => {
      downloadOwners = downloadOwners.filter((owner) => owner.id !== id);
      notifyDownloadOwners();
    };
  }, [active, anchor, id]);
  return useSyncExternalStore(subscribeDownloadOwners, () => downloadOwners[0]?.id === id, () => false);
}

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
  const codingCacheRef = useRef(new Map<string, Promise<TerminologyCodingResult>>());
  // Entrees dont les propositions ont deja ete redemandees a la reouverture (une fois chacune).
  const restoredRef = useRef(new Set<string>());
  // Nouvelle analyse demandee explicitement pour une entree non codee : etat par entree, et
  // provenance de l'analyse a reprendre si une proposition est choisie.
  const [reanalysis, setReanalysis] = useState<Record<string, 'pending' | 'none' | 'failed'>>({});
  const reanalyzedRef = useRef(new Map<string, UnmatchedTerminologyValue>());
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // La reponse du codage arrive apres coup : elle doit s'appliquer a la valeur COURANTE.
  const valueRef = useRef(value);
  valueRef.current = value;

  const multiple = field.isMultiple === true;
  const codeText = freeText ? repo.codeText?.bind(repo) : undefined;
  // L'ordre du tableau EST le rang : il n'est ni retrie ni normalise, ici comme au serveur.
  const chosen = multiple && Array.isArray(value) ? value.filter(isTerminologyEntry) : [];
  const selected = !multiple && isTerminologyEntry(value) ? value : null;
  const ownsDownloadLink = useFirstDownloadOwner(searchRef, !(selected && !replacing));

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

  // Le texte ne part vers l'analyse qu'au depart du champ (ou sur Entree), jamais pendant la
  // frappe : chaque analyse est un appel facture au fournisseur du LLM.
  function codingFor(text: string): Promise<TerminologyCodingResult> {
    const cache = codingCacheRef.current;
    const known = cache.get(text);
    if (known) return known;
    const pending = codeText!(text);
    cache.set(text, pending);
    // Un echec ne reste pas en cache : un nouvel essai doit pouvoir repartir.
    pending.catch(() => cache.delete(text));
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
    return pending;
  }

  // Reouverture d'une fiche : les propositions au choix ne sont pas stockees. Pour une entree
  // NON codee issue du codage assiste, le texte conserve est analyse a nouveau et les
  // propositions sont RESTAUREES — la valeur enregistree, elle, n'est jamais modifiee ici.
  // Une proposition a confirmer porte deja un code : elle n'est pas reanalysee (chaque analyse
  // est facturee) ; « Changer » reste disponible.
  const restorable = (multiple ? chosen : selected ? [selected] : []).flatMap((e) =>
    isUnmatchedTerminology(e) && e.coding.method === 'ai_assisted' && e.coding.normalized
      ? [{ raw: e.raw, normalized: e.coding.normalized }]
      : []
  );
  const restoreKey = restorable.map((e) => choiceKey(e.raw, e.normalized)).join('\n');
  useEffect(() => {
    if (!codeText || !online) return;
    for (const entry of restorable) {
      const key = choiceKey(entry.raw, entry.normalized);
      if (choices[key] || restoredRef.current.has(key)) continue;
      restoredRef.current.add(key);
      void codingFor(entry.raw)
        .then((result) => {
          const { choices: proposed } = entriesFromResult(entry.raw, result, multiple);
          // Meme interpretation qu'a la saisie, ou a defaut l'unique jeu de propositions.
          const match = proposed.find((c) => choiceKey(c.raw, c.normalized) === key)
            ?? (proposed.length === 1 ? proposed[0] : undefined);
          if (!match) return;
          setChoices((prev) => (prev[key] ? prev : { ...prev, [key]: { ...match, normalized: entry.normalized } }));
        })
        .catch(() => undefined);
    }
    // `restoreKey` resume `restorable` ; `codingFor` ne depend que de refs et de `codeText`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreKey, codeText, online]);

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
    // Meme seuil que la recherche et le serveur : un sigle (« IC ») est un diagnostic.
    if (!freeText || raw.length < MIN_QUERY_LENGTH) return;
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
    // Aller vers une proposition de la liste, ou annuler une correction, n'est pas un depart
    // du champ. Tout autre focus l'est, meme dans ce bloc (telechargement, actions d'une autre
    // entree) : sinon le texte restait en suspens et l'enregistrement le perdait.
    const next = e.relatedTarget as Node | null;
    if (next && (listRef.current?.contains(next) || next === cancelRef.current)) return;
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
    if (!entry) return;
    const source = isUnmatchedTerminology(entry)
      ? reanalyzedRef.current.get(choiceKey(entry.raw, entry.coding.normalized))
      : undefined;
    writeEntries(entries, index, [resolveEntry(source ?? entry, concept, 'confirmed')]);
  }

  /**
   * Entree non codee rouverte (hors connexion a la saisie, ou analyse sans resultat) : le
   * medecin peut demander une nouvelle analyse. Les correspondances trouvees sont seulement
   * PROPOSEES ; la valeur ne change que s'il en choisit une.
   */
  function reanalyze(entry: UnmatchedTerminologyValue) {
    const key = choiceKey(entry.raw, entry.coding.normalized);
    setReanalysis((prev) => ({ ...prev, [key]: 'pending' }));
    void codingFor(entry.raw)
      .then((result) => {
        const { source, options: found } = proposalsFromResult(entry, result);
        // Un code deja present dans la liste serait refuse en doublon : il n'est pas propose.
        const present = new Set(currentEntries().filter(isTerminologyValue).map((e) => e.code));
        const options = found.filter((option) => !present.has(option.code));
        if (options.length === 0) {
          setReanalysis((prev) => ({ ...prev, [key]: 'none' }));
          return;
        }
        reanalyzedRef.current.set(key, source);
        setChoices((prev) => ({ ...prev, [key]: { raw: entry.raw, normalized: entry.coding.normalized ?? '', options } }));
        setReanalysis((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      })
      .catch(() => setReanalysis((prev) => ({ ...prev, [key]: 'failed' })));
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
  // Revue post-optimisation (C4) : chaque entree se lit sur trois niveaux — le diagnostic (et son
  // statut), le texte ecrit par le medecin quand il differe, puis les actions — et chaque action
  // est une vraie cible au doigt (40 px au moins), et non plus un lien de 16 px en text-xs.

  const entryText = (entry: TerminologyFieldEntry) => (isTerminologyValue(entry) ? entry.label : entry.raw);

  /** Une proposition a choisir : toute la largeur, son code en gris a droite. */
  function conceptButton(index: number, concept: CodedConcept) {
    return (
      <button
        key={concept.code}
        type="button"
        onClick={() => pick(index, concept)}
        className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-teal-200 bg-white px-3 py-2 text-left text-sm text-teal-800 hover:bg-teal-50 dark:border-teal-800 dark:bg-slate-900 dark:text-teal-200 dark:hover:bg-teal-950"
      >
        <span aria-hidden="true">○</span>
        <span className="min-w-0 flex-1 break-words">{concept.label}</span>
        <span className="shrink-0 text-xs tabular-nums text-slate-500">{concept.code}</span>
      </button>
    );
  }

  /** Ce qui suit le diagnostic : propositions, analyse en cours ou absence de correspondance. */
  function entryDetails(entry: TerminologyFieldEntry, index: number): ReactNode {
    if (isTerminologyValue(entry)) {
      return entry.coding?.status === 'suggested' ? otherMatches(entry, index) : null;
    }
    const key = choiceKey(entry.raw, entry.coding.normalized);
    const choice = choices[key];
    const provisional = isProvisionalEntry(entry, entry.raw);
    const state = reanalysis[key];
    const canReanalyze = !!codeText && online && !choice && !(codingCount > 0 && provisional);
    return (
      <>
        {codingCount > 0 && provisional ? (
          <CodingIndicator label={t('terminology.coding')} />
        ) : choice ? (
          <div role="group" aria-label={t('terminology.several_matches')} className="space-y-1.5">
            <p className="text-xs text-slate-600 dark:text-slate-300">{t('terminology.several_matches')}</p>
            {choice.options.map((c) => conceptButton(index, c))}
          </div>
        ) : !provisional || !codeText || state === 'none' ? (
          <p className="text-xs text-slate-500">{t('terminology.no_reliable_match')}</p>
        ) : null}
        {canReanalyze && (state === 'pending' ? (
          <CodingIndicator label={t('terminology.coding')} />
        ) : state === 'failed' ? (
          <p role="status" className="text-xs text-slate-500">{t('terminology.coding_unavailable')}</p>
        ) : state === undefined ? (
          <button
            type="button"
            onClick={() => reanalyze(entry)}
            className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-teal-700 hover:bg-teal-100/60 dark:text-teal-300 dark:hover:bg-teal-900/40"
          >
            {t('terminology.reanalyze')}
          </button>
        ) : null)}
      </>
    );
  }

  /** Autres correspondances d'une proposition a confirmer : en choisir une la confirme. */
  function otherMatches(entry: TerminologyValue, index: number) {
    const present = new Set(chosen.filter(isTerminologyValue).map((e) => e.code));
    // Un code deja present dans la liste serait refuse en doublon : il n'est pas propose.
    const options = (choices[choiceKey(entry.raw ?? '', entry.coding?.normalized)]?.options ?? [])
      .filter((c) => c.code !== entry.code && !present.has(c.code));
    if (options.length === 0) return null;
    return (
      <div role="group" aria-label={t('terminology.other_matches')} className="space-y-1.5">
        <p className="text-xs text-slate-600 dark:text-slate-300">{t('terminology.other_matches')}</p>
        {options.map((c) => conceptButton(index, c))}
      </div>
    );
  }

  /**
   * Une entree : diagnostic et statut, texte ecrit, details, puis « Confirmer » pour une
   * proposition. `rank` numerote une liste (le premier est le principal) ; `actions` porte
   * « Changer » (valeur unique) ou « ⋯ » (liste).
   */
  function renderEntry(entry: TerminologyFieldEntry, index: number, rank: number | null, actions: ReactNode) {
    const coded = isTerminologyValue(entry);
    const suggested = coded && entry.coding?.status === 'suggested';
    // Le texte d'origine accompagne toujours le code retenu : il se lit, il ne se survole pas.
    const written = coded && entry.raw && entry.raw !== entry.label ? entry.raw : null;
    return (
      <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-100">
        <div className="flex items-start gap-2">
          {/* Le NUMERO est le rang, et c'est lui qui porte « le premier est le principal ». */}
          {rank !== null && <span className="pt-2 font-medium tabular-nums">{rank}.</span>}
          <div className="min-w-0 flex-1 space-y-1.5 py-1.5">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={coded ? 'break-words' : 'break-words italic'}>
                {coded && entry.coding && !suggested ? '✓ ' : ''}{entryText(entry)}
              </span>
              {coded && entry.coding && <span className="text-xs tabular-nums text-slate-500">{entry.code}</span>}
              {suggested && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  {t('terminology.to_confirm')}
                </span>
              )}
            </p>
            {written && <p className="break-words text-xs text-slate-600 dark:text-slate-300">{t('terminology.written')} {written}</p>}
            {/* La proposition d'abord, puis les autres correspondances, si l'analyse en a trouve. */}
            {suggested && (
              <button
                type="button"
                onClick={() => confirm(index)}
                aria-label={`${t('terminology.confirm')} ${entryText(entry)}`}
                className="btn-secondary px-3"
              >
                {t('terminology.confirm')}
              </button>
            )}
            {entryDetails(entry, index)}
          </div>
          {actions}
        </div>
      </div>
    );
  }

  const entryHasCoding = (entry: TerminologyFieldEntry) => !isTerminologyValue(entry) || entry.coding !== undefined;

  if (selected && !replacing) {
    return (
      <div className="space-y-1">
        {renderEntry(selected, 0, null, (
          <button
            type="button"
            // Une saisie issue du codage assiste reste affichee tant qu'aucun remplacement n'est
            // choisi : abandonner la correction ne doit pas effacer le diagnostic ecrit.
            onClick={() => (entryHasCoding(selected) ? startReplace(0) : onChange(null))}
            className="btn-ghost shrink-0 px-3"
          >
            {t('terminology.change')}
          </button>
        ))}
        {codingNotice && <p role="status" className="text-xs text-slate-500">{codingNotice}</p>}
      </div>
    );
  }

  return (
    <div ref={searchRef} className="space-y-1">
      {/* Les entrees d'abord, la recherche EN DESSOUS et toujours visible : ajouter un
          diagnostic ne doit jamais obliger a en retirer un autre. */}
      {multiple && chosen.length > 0 && (
        <>
          <ul className="space-y-2">
            {chosen.map((c, index) => (
              <li key={isTerminologyValue(c) ? c.code : `${index}:${c.raw}`}>
                {renderEntry(c, index, index + 1, (
                  // Changer et Retirer, actions secondaires, passent dans « ⋯ » (T9) : deux
                  // glyphes de 16 px ne sont pas des cibles au doigt.
                  <Menu
                    triggerLabel={`${t('common.actions')} · ${entryText(c)}`}
                    triggerClassName="icon-button h-10 w-10 shrink-0"
                    triggerContent={<MoreHorizontal size={18} aria-hidden />}
                  >
                    {entryHasCoding(c) && <MenuItem onSelect={() => startReplace(index)}>{t('terminology.change')}</MenuItem>}
                    <MenuItem onSelect={() => remove(index)}>{t('terminology.remove')}</MenuItem>
                  </Menu>
                ))}
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
            ref={cancelRef}
            type="button"
            // Comme pour les propositions : le focus reste dans le champ, sinon le depart du
            // champ enregistrerait la correction que l'on annule.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setReplacing(null); setQuery(''); }}
            className="btn-ghost -my-2 px-2 text-xs"
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
        <ul ref={listRef} id={listId} role="listbox" className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
                className="block min-h-10 w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
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
      {/* Copie locale prete : rien a dire. Absente : un seul lien par ecran (voir plus haut). */}
      {!local && downloading === null && ownsDownloadLink && (
        <button
          type="button"
          onClick={() => void telecharger()}
          className="btn-ghost -ml-2 px-2 text-xs text-teal-700 dark:text-teal-300"
        >
          {t('terminology.download')}
        </button>
      )}
    </div>
  );
}

/** Analyse en cours : petite animation discrete, annoncee aux lecteurs d'ecran. */
function CodingIndicator({ label }: { label: string }) {
  return (
    <span role="status" className="flex items-center gap-1.5 text-xs text-slate-500">
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-teal-600 border-t-transparent motion-reduce:animate-none"
      />
      {label}
    </span>
  );
}
