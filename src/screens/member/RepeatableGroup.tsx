import { useEffect, useId, useMemo, useState, type ReactNode, type SetStateAction } from 'react';
import { Plus } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { usePatientRepository } from '../../data/RepositoryProvider';
import type { Encounter } from '../../data/patients';
import {
  displayFieldValue, type TemplateField, type TemplateSection, type ValidationRule,
} from '../../data/types';
import { evaluateRules, hiddenFieldKeys, isMissing, missingCodeOf, validateValues, withoutHiddenValues } from '../../domain/validation';
import { isRefreshRequiredError } from '../../lib/errorMessage';
import { DeleteWithReason } from './DeleteWithReason';
import { JustificationField } from './JustificationField';
import { EncounterFields } from './EncounterFields';
import { HiddenValuesConfirmation, HiddenValuesNotice } from './EncounterFields';
import { initialValuesFromDefaults, forgetPrefilled, isClearedValue } from '../../domain/fieldDefaults';
import { ConfirmDialog } from '../../components/ConfirmDialog';

type OccurrenceDraft = {
  row: Encounter | null;
  values: Record<string, unknown>;
  reason: string;
  prefilled: Set<string>;
  conflict?: boolean;
};

/**
 * Borne SERVEUR des occurrences d'un groupe (§4.4). Elle est rappelee ici pour expliquer le
 * refus AVANT l'appel, jamais pour le remplacer : la borne qui compte reste celle de la base.
 */
export const MAX_OCCURRENCES = 50;

/** Au-dela, le tableau devient illisible et la forme carte prend le relais (§8.1). */
const MAX_TABLE_COLUMNS = 6;

/**
 * Variable d'un bloc repetable, reduite a ce qu'une CELLULE demande. La fiche de lecture et le
 * formulaire ne portent pas le meme objet ; les deux savent remplir cette forme-la.
 */
export type OccurrenceColumn = {
  fieldKey: string;
  label: string;
  type?: string;
  unit?: string | null;
  allowedValues?: unknown;
  allowedOptions?: unknown;
};

/**
 * Bascule en cartes sous 768 px (§8.1). Sans `matchMedia` — jsdom, rendu serveur — on reste sur
 * le tableau : c'est la forme complete, et aucune information n'y est perdue.
 */
function useNarrowViewport(): boolean {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia(query);
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  return narrow;
}

/**
 * Rendu d'une valeur d'occurrence, comme partout ailleurs hors saisie (§8.1) : le libelle d'une
 * option et non son code, un diagnostic et non `[object Object]`, et le motif d'une donnee
 * manquante codifiee plutot que son jeton technique.
 */
function useCellText() {
  const { t } = useI18n();
  return (value: unknown, column: OccurrenceColumn): string => {
    if (isMissing(value)) return t(`missing.${missingCodeOf(value)!}`);
    if (typeof value === 'boolean') return value ? '✓' : '✗';
    return displayFieldValue(value, '—', column);
  };
}

/**
 * Tableau d'occurrences : une colonne par variable du bloc, une ligne par occurrence.
 *
 * Purement presentationnel — il ne lit ni n'ecrit rien. La fiche de lecture l'utilise sans
 * action ; l'ecran de correction lui passe les actions de ligne.
 */
export function RepeatableGroupTable({
  groupLabel, columns, rows, loading = false, rowActions, rowNotice,
}: {
  groupLabel: string;
  columns: readonly OccurrenceColumn[];
  rows: readonly Encounter[];
  loading?: boolean;
  /** Actions propres a une ligne. Absentes = lecture seule (role, hors-ligne, fiche curee). */
  rowActions?: (row: Encounter, index: number) => ReactNode;
  /** Bandeau porte par UNE ligne — un conflit de version n'en bloque aucune autre (§8.2). */
  rowNotice?: (row: Encounter, index: number) => ReactNode;
}) {
  const { t } = useI18n();
  const cellText = useCellText();
  const narrow = useNarrowViewport();
  const asCards = narrow || columns.length > MAX_TABLE_COLUMNS;
  const rankOf = (index: number) => t('form.repeatable_occurrence').replace('{n}', String(index + 1));

  if (loading) {
    return (
      <div className="min-w-0 max-w-full overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <caption className="sr-only">{t('form.repeatable_table').replace('{group}', groupLabel)}</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <th scope="col" className="px-2 py-1">{t('form.repeatable_rank')}</th>
              {columns.map((column) => <th key={column.fieldKey} scope="col" className="px-2 py-1">{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={columns.length + 1} className="px-2 py-2">
                <span role="status" className="text-sm text-slate-500">{t('form.repeatable_loading')}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // Groupe vide : une ligne d'invite, jamais un tableau d'en-tetes nu (§8.1).
  if (rows.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">{t('form.repeatable_empty')}</p>;

  if (asCards) {
    return (
      <ul className="space-y-3">
        {rows.map((row, index) => (
          <li key={row.id} aria-label={rankOf(index)} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{rankOf(index)}</p>
            <dl className="mt-2 space-y-1 text-sm">
              {columns.map((column) => (
                <div key={column.fieldKey} className="flex flex-wrap gap-x-2">
                  <dt className="min-w-0 max-w-full break-words text-slate-500 dark:text-slate-400">{column.label}{column.unit ? ` (${column.unit})` : ''} :</dt>
                  <dd className="min-w-0 max-w-full break-words text-slate-900 dark:text-slate-100">{cellText(row.data[column.fieldKey], column)}</dd>
                </div>
              ))}
            </dl>
            {rowNotice?.(row, index)}
            {rowActions && <div className="mt-2 flex flex-wrap items-center gap-3">{rowActions(row, index)}</div>}
          </li>
        ))}
      </ul>
    );
  }

  // Le defilement horizontal reste DANS ce conteneur : le document ne defile jamais (§8.1).
  return (
    <div className="min-w-0 max-w-full overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <caption className="sr-only">{t('form.repeatable_table').replace('{group}', groupLabel)}</caption>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <th scope="col" className="px-2 py-1">{t('form.repeatable_rank')}</th>
            {columns.map((column) => (
              <th key={column.fieldKey} scope="col" className="px-2 py-1">
                {column.label}{column.unit ? <span className="text-slate-400"> ({column.unit})</span> : null}
              </th>
            ))}
            {rowActions && <th scope="col" className="px-2 py-1">{t('form.repeatable_actions')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} className="border-t border-slate-100 align-top dark:border-slate-800">
              <th scope="row" className="px-2 py-2 text-left font-normal text-slate-500 tabular-nums dark:text-slate-400">{index + 1}</th>
              {columns.map((column) => (
                <td key={column.fieldKey} className="px-2 py-2 text-slate-900 dark:text-slate-100">
                  {cellText(row.data[column.fieldKey], column)}
                </td>
              ))}
              {rowActions && (
                <td className="px-2 py-2">
                  <span className="flex flex-wrap items-center gap-3">{rowActions(row, index)}</span>
                  {rowNotice?.(row, index)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * L68 — un bloc repetable A SA PLACE dans la fiche : le tableau de ses occurrences, et de quoi
 * en ajouter, en corriger et en supprimer une.
 *
 * **Une occurrence est une ecriture atomique.** Il n'y a pas d'enregistrement global du tableau :
 * chaque ligne part seule, avec son propre verrou optimiste. Un conflit sur une ligne laisse
 * toutes les autres modifiables, et les saisies locales ne sont jamais remplacees par l'erreur.
 */
export function RepeatableGroup({
  section, fields, rules, requireComplete = false,
  patientId, occurrences, occurrencesError = null, onChanged, canWrite, online = true, onDirtyChange,
  occurrenceTemplateVersionId, canCreate = true, totalOccurrenceCount, masked = false,
}: {
  section: TemplateSection;
  /** Variables du bloc, dans l'ordre d'affichage de l'editeur. */
  fields: readonly TemplateField[];
  rules?: readonly ValidationRule[];
  /** Compte de mission : aucune occurrence partielle, meme en brouillon. */
  requireComplete?: boolean;
  /** `null` tant que la fiche n'existe pas cote serveur — la creation est le lot L69. */
  patientId: string | null;
  /** Toutes les rencontres de la fiche ; `null` pendant le chargement. */
  occurrences: readonly Encounter[] | null;
  /** Lecture echouee : un tableau vide dirait « aucune occurrence », ce qui serait faux. */
  occurrencesError?: string | null;
  onChanged: () => void | Promise<void>;
  canWrite: boolean;
  online?: boolean;
  /** The containing patient form owns the single navigation guard. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Historical rows must use their own immutable field dictionary. */
  occurrenceTemplateVersionId?: string;
  canCreate?: boolean;
  /** The server cap applies across every version of this group. */
  totalOccurrenceCount?: number;
  /**
   * L72 D10 — le bloc parent du groupe est masque pour cette fiche. Les occurrences deja
   * enregistrees restent visibles et supprimables une a une ; rien ne s'y ajoute ni ne s'y
   * corrige. Une occurrence en cours de saisie est conservee, sans etre montree, jusqu'a ce
   * que le bloc redevienne visible.
   */
  masked?: boolean;
}) {
  const { t } = useI18n();
  const patients = usePatientRepository();
  const formId = useId();
  const [drafts, setDrafts] = useState<Record<string, OccurrenceDraft>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const draft = activeKey === null ? null : drafts[activeKey] ?? null;
  const setDraft = (update: SetStateAction<OccurrenceDraft | null>) => {
    if (activeKey === null) return;
    setDrafts((current) => {
      const next = typeof update === 'function' ? update(current[activeKey] ?? null) : update;
      if (next) return { ...current, [activeKey]: next };
      const rest = { ...current };
      delete rest[activeKey];
      return rest;
    });
  };
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'cancel' | 'reload' | null>(null);
  const [hiddenConfirmation, setHiddenConfirmation] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState(false);
  const hasDrafts = Object.keys(drafts).length > 0;
  useEffect(() => { onDirtyChange?.(hasDrafts); }, [hasDrafts, onDirtyChange]);

  const groupLabel = section.label?.trim() || section.sectionKey;
  const columns = useMemo<OccurrenceColumn[]>(
    () => [...fields].sort((a, b) => a.displayOrder - b.displayOrder).map((field) => ({
      fieldKey: field.fieldKey, label: field.label, type: field.type,
      unit: field.unit, allowedValues: field.allowedValues, allowedOptions: field.allowedOptions,
    })),
    [fields],
  );
  const formFields = useMemo(
    () => [...fields].sort((a, b) => a.displayOrder - b.displayOrder),
    [fields],
  );
  // Dans le formulaire d'OCCURRENCE, le bloc n'est plus un groupe a deleguer : c'est le
  // formulaire lui-meme. Sans cette leve, le moteur de champs retirerait ses propres variables.
  const formSections = useMemo(() => [{ ...section, isRepeatable: false }], [section]);
  const rows = useMemo(
    () => (occurrences ?? []).filter((encounter) => encounter.groupSectionKey === section.sectionKey
      && (occurrenceTemplateVersionId === undefined || encounter.templateVersionId === occurrenceTemplateVersionId)),
    [occurrences, section.sectionKey, occurrenceTemplateVersionId],
  );

  const loading = occurrences === null;
  const writable = canWrite && online && patientId !== null;
  const activeReadOnly = draft?.row && (draft.row.validationStatus === 'curated'
    || rows.find((row) => row.id === draft.row?.id)?.validationStatus === 'curated');
  const groupCount = totalOccurrenceCount ?? rows.length;
  const limitReached = groupCount >= MAX_OCCURRENCES;
  const hidden = hiddenFieldKeys(rules ?? [], draft?.values ?? {}, formFields, formSections);
  const removed = withoutHiddenValues(draft?.values ?? {}, hidden).removed;
  const labelOf = (key: string) => formFields.find((field) => field.fieldKey === key)?.label ?? key;

  const setValue = (key: string, value: unknown, remove = false) => setDraft((current) => {
    if (!current) return current;
    const values = { ...current.values };
    if (remove || (current.prefilled.has(key) && isClearedValue(value))) delete values[key]; else values[key] = value;
    return { ...current, values, prefilled: forgetPrefilled(current.prefilled, key) };
  });

  const close = () => { setDraft(null); setActiveKey(null); setProblems([]); setError(null); setHiddenConfirmation(false); };
  const open = (row: Encounter | null) => {
    const key = row?.id ?? 'new';
    setDrafts((current) => current[key] ? current : {
      ...current,
      [key]: { row, reason: '', ...(row ? { values: { ...row.data }, prefilled: new Set<string>() } : initialValuesFromDefaults(formFields)) },
    });
    setActiveKey(key); setProblems([]); setError(null); setHiddenConfirmation(false);
  };

  async function save(confirmed = false) {
    if (!draft || !patientId || busy || !writable || activeReadOnly || draft.conflict) return;
    if (!draft.row && (!canCreate || limitReached)) {
      setError(t('form.repeatable_limit').replace('{max}', String(MAX_OCCURRENCES)));
      return;
    }
    const hidden = hiddenFieldKeys(rules ?? [], draft.values, formFields, formSections);
    const { values: data } = withoutHiddenValues(draft.values, hidden);
    // Une occurrence complete l'est vraiment : le statut suit la completude, il ne la decrete
    // pas. Une occurrence incomplete reste en brouillon et rejoint la file de completion (§8.5).
    const ruleErrors = evaluateRules((rules ?? []).map((rule) => ({ rule: rule.rule, message: rule.message, severity: rule.severity })), data, hidden).blocking;
    const complete = validateValues(formFields, data, true, hidden).length === 0 && ruleErrors.length === 0;
    const status = complete ? 'complete' : 'draft';
    const strict = requireComplete || complete;
    const blocking = [
      ...validateValues(formFields, data, strict, hidden).map((issue) => `${labelOf(issue.fieldKey)} : ${issue.message}`),
      ...ruleErrors,
    ];
    setProblems(blocking);
    if (blocking.length > 0) return;
    if (draft.row && !draft.row.updatedAt) {
      setDraft((current) => current && { ...current, conflict: true });
      setError(t('form.repeatable_conflict'));
      return;
    }
    if (removed.length > 0 && !confirmed) { setHiddenConfirmation(true); return; }
    setHiddenConfirmation(false);

    setBusy(true);
    setError(null);
    try {
      if (draft.row) {
        await patients.updateEncounter(draft.row.id, data, status, draft.reason.trim(), draft.row.updatedAt ?? null);
      } else {
        await patients.createEncounter(patientId, {
          encounterType: 'autre',
          // Une lesion n'a pas de date ; le bloc peut porter la sienne parmi ses variables (§4.3).
          encounterDate: null,
          validationStatus: status,
          ageUnit: 'years',
          data,
          groupSectionKey: section.sectionKey,
        });
        setAnnouncement(t('form.repeatable_added').replace('{n}', String(groupCount + 1)));
      }
      close();
      await onChanged();
    } catch (e) {
      // Conflit : la ligne seule est signalee, et la saisie locale reste dans le formulaire.
      if (draft.row && isRefreshRequiredError(e)) {
        setDraft((current) => current && { ...current, conflict: true });
        setError(t('form.repeatable_conflict'));
      } else {
        // Unknown backend errors may contain SQL or data; never render them verbatim.
        setError(t('common.error'));
      }
    } finally {
      setBusy(false);
    }
  }

  const rowActions = writable
    ? (row: Encounter, index: number) => row.validationStatus === 'curated' ? null : (
      <>
        {!masked && <button
          type="button"
          className="text-xs font-medium text-teal-700 hover:underline"
          aria-label={t('form.repeatable_edit_occurrence').replace('{n}', String(index + 1)).replace('{group}', groupLabel)}
          disabled={busy}
          onClick={() => open(row)}
        >
          {t('encounter.edit')}
        </button>}
        <DeleteWithReason
          label={t('form.repeatable_delete_occurrence').replace('{n}', String(index + 1)).replace('{group}', groupLabel)}
          onConfirm={async (reason) => {
            if (!online || busy) throw new Error(t('common.error'));
            await patients.softDeleteEncounter(row.id, reason);
          }}
          onSuccess={async () => {
            setAnnouncement(t('form.repeatable_removed').replace('{n}', String(Math.max(groupCount - 1, 0))));
            if (draft?.row?.id === row.id) close();
            setDrafts((current) => { const next = { ...current }; delete next[row.id]; return next; });
            await onChanged();
          }}
          verifyDeletedAfterError={async () => !!patientId
            && !(await patients.listEncounters(patientId)).some((current) => current.id === row.id)}
        />
      </>
    )
    : undefined;

  const rowNotice = (row: Encounter) => (drafts[row.id]?.conflict
    ? <p role="alert" className="mt-1 max-w-sm text-xs text-red-700 dark:text-red-300">{t('form.repeatable_conflict')}</p>
    : null);

  return (
    <div className="min-w-0 max-w-full space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* Le compte est affiche meme a zero : « aucune occurrence » est un etat, pas un vide. */}
        {!loading && !occurrencesError && (
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            {t('form.repeatable_count').replace('{n}', String(rows.length))}
          </p>
        )}
      </div>
      {/* Annonce du compte a l'ajout et au retrait (§8.6). Vide au montage : une region vivante
          n'annonce que ce qui CHANGE, jamais l'etat initial de la page. */}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      {masked && !loading && !occurrencesError && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {t('form.repeatable_masked').replace('{n}', String(rows.length))}
        </p>
      )}
      {error && !draft && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}

      {!online && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('form.repeatable_offline')}</p>}
      {online && patientId === null && <p className="text-sm text-slate-500 dark:text-slate-400">{t('form.repeatable_requires_saved_record')}</p>}

      {occurrencesError
        ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{occurrencesError}</p>
        : (
          <RepeatableGroupTable
            groupLabel={groupLabel}
            columns={columns}
            rows={rows}
            loading={loading}
            rowActions={rowActions}
            rowNotice={rowNotice}
          />
        )}

      {writable && canCreate && !masked && !loading && !occurrencesError && (
        <div className="space-y-1">
          <button type="button" className="btn-secondary" disabled={limitReached || busy}
            onClick={() => open(null)}>
            <Plus size={16} aria-hidden /> {t('form.repeatable_add')}
          </button>
          {limitReached && (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {t('form.repeatable_limit').replace('{max}', String(MAX_OCCURRENCES))}
            </p>
          )}
        </div>
      )}

      {masked && draft && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <p role="status">{t('form.repeatable_masked_draft')}</p>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmation('cancel')}>{t('common.cancel')}</button>
        </div>
      )}

      {writable && !masked && !activeReadOnly && draft && (
        // Pas un `form` : le bloc est rendu DANS le formulaire de la fiche, et une occurrence
        // s'enregistre seule. Entree ne doit donc jamais soumettre la fiche autour.
        <fieldset
          disabled={busy}
          id={formId}
          role="group"
          aria-label={draft.row
            ? t('form.repeatable_edit_title')
              .replace('{n}', String(rows.findIndex((row) => row.id === draft.row!.id) + 1))
              .replace('{group}', groupLabel)
            : t('form.repeatable_new_title').replace('{group}', groupLabel)}
          className="min-w-0 space-y-4 rounded-xl border border-teal-200 bg-teal-50/40 p-4 dark:border-teal-900 dark:bg-teal-950/20"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.stopPropagation();
              if (event.target instanceof HTMLInputElement) event.preventDefault();
            }
          }}
        >
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {draft.row
              ? t('form.repeatable_edit_title')
                .replace('{n}', String(rows.findIndex((row) => row.id === draft.row!.id) + 1))
                .replace('{group}', groupLabel)
              : t('form.repeatable_new_title').replace('{group}', groupLabel)}
          </p>

          {/* Le moteur de champs existant, avec ses regles internes, ses valeurs par defaut et
              ses codes de donnee manquante. Aucun second moteur n'est ecrit ici. */}
          <EncounterFields
            key={activeKey}
            fields={formFields}
            values={draft.values}
            sections={formSections}
            rules={rules}
            hiddenKeys={hidden}
            prefilledKeys={draft.prefilled}
            requireComplete={requireComplete}
            onChange={(key, value) => setValue(key, value)}
            onRemove={(key) => setValue(key, undefined, true)}
          />

          <HiddenValuesNotice removedKeys={removed} fields={formFields} />
          {hiddenConfirmation && <HiddenValuesConfirmation removedKeys={removed} fields={formFields}
            onConfirm={() => void save(true)} onCancel={() => setHiddenConfirmation(false)} />}

          {draft.row && (
            <JustificationField value={draft.reason}
              onChange={(reason) => setDraft((current) => current && { ...current, reason })} />
          )}

          {problems.length > 0 && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <ul className="list-disc pl-5">{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>
            </div>
          )}
          {/* Un conflit porte son bandeau sur SA ligne (§8.4) : le repeter ici dirait deux fois
              la meme chose. Le formulaire garde la resolution explicite, pas le doublon. */}
          {error && !draft.conflict && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" disabled={busy || draft.conflict} onClick={() => void save()}>
              {t('form.repeatable_save')}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmation('cancel')}>{t('common.cancel')}</button>
            {draft.conflict && (
              <button type="button" className="btn-secondary" disabled={busy}
                onClick={() => setConfirmation('reload')}>{t('form.repeatable_reload')}</button>
            )}
          </div>
        </fieldset>
      )}
      <ConfirmDialog open={confirmation !== null} title={t('leave.title')} body={t('form.repeatable_discard')}
        confirmLabel={t('leave.confirm')} onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const action = confirmation;
          setConfirmation(null);
          if (action === 'cancel') { close(); return; }
          if (!draft?.row) return;
          setBusy(true);
          void patients.getEncounter(draft.row.id).then(async (fresh) => {
            if (!fresh) { setError(t('common.error')); return; }
            setDraft({ row: fresh, values: { ...fresh.data }, reason: '', prefilled: new Set() });
            setError(null); setProblems([]);
            await onChanged();
          }).catch(() => setError(t('common.error'))).finally(() => setBusy(false));
        }} />
    </div>
  );
}
