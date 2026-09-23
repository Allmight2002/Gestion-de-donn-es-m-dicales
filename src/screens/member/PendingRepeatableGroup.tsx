import { useId, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { Encounter } from '../../data/patients';
import type { TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { evaluateRules, hiddenFieldKeys, validateValues, withoutHiddenValues } from '../../domain/validation';
import { forgetPrefilled, initialValuesFromDefaults, isClearedValue } from '../../domain/fieldDefaults';
import { isSavedOccurrence, type PendingOccurrence } from '../../domain/pendingOccurrences';
import { EncounterFields, HiddenValuesConfirmation, HiddenValuesNotice } from './EncounterFields';
import { MAX_OCCURRENCES, RepeatableGroupTable } from './RepeatableGroup';
import { ConfirmDialog } from '../../components/ConfirmDialog';

/**
 * L69 — un bloc repetable A SA PLACE dans l'ecran de CREATION, avant que la fiche existe.
 *
 * Le tableau est celui de L68 (`RepeatableGroupTable`), non modifie : meme colonnes, meme
 * bascule carte, meme rendu de valeur. Ce qui change est en-dessous — la ligne n'est pas une
 * rencontre du serveur mais une ligne TAMPONNEE, et elle le dit.
 *
 * Ce composant n'ecrit rien. Il tient la saisie ; l'ecran de creation tient le tampon et le
 * rejeu ordonne (voir `domain/pendingOccurrences`). Cette separation est ce qui permet a
 * l'etat affiche d'etre l'etat REEL : la ligne passe a « enregistree » quand le serveur a
 * repondu, pas quand le formulaire s'est referme.
 */
export function PendingRepeatableGroup({
  section, fields, rules, requireComplete = false, rows, online = true,
  onAdd, onEdit, onRemove, onDraftDirtyChange, busy = false, masked = false,
}: {
  section: TemplateSection;
  /** Variables du bloc, dans l'ordre d'affichage de l'editeur. */
  fields: readonly TemplateField[];
  rules?: readonly ValidationRule[];
  /** Compte de mission : aucune occurrence partielle, meme en brouillon. */
  requireComplete?: boolean;
  /** Lignes tamponnees DE CE BLOC, dans l'ordre de saisie. */
  rows: readonly PendingOccurrence[];
  online?: boolean;
  onAdd: (data: Record<string, unknown>, validationStatus: 'draft' | 'complete') => void;
  onEdit: (localId: string, data: Record<string, unknown>, validationStatus: 'draft' | 'complete') => void;
  onRemove: (localId: string) => void;
  /** L'éditeur garde ses valeurs localement ; le parent les inclut au garde de sortie. */
  onDraftDirtyChange?: (dirty: boolean) => void;
  /**
   * Formulaire gele : la fiche est enregistree, et la reprise des lignes restantes se pilote
   * depuis le bandeau de l'ecran, HORS de ce formulaire.
   */
  busy?: boolean;
  /**
   * L72 D10 — le bloc parent est masque par la fiche en cours de saisie. Les lignes deja
   * tamponnees restent annoncees et peuvent etre retirees une a une ; aucune ne s'ajoute ni ne
   * se corrige. Une ligne en cours d'edition est conservee, sans etre montree.
   */
  masked?: boolean;
}) {
  const { t } = useI18n();
  const formId = useId();
  const [editing, setEditing] = useState<{ localId: string | null; values: Record<string, unknown>; prefilled: Set<string> } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [hiddenConfirmation, setHiddenConfirmation] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const draftDirty = useRef(false);

  const groupLabel = section.label?.trim() || section.sectionKey;
  const formFields = useMemo(() => [...fields].sort((a, b) => a.displayOrder - b.displayOrder), [fields]);
  const columns = useMemo(
    () => formFields.map((field) => ({
      fieldKey: field.fieldKey, label: field.label, type: field.type,
      unit: field.unit, allowedValues: field.allowedValues, allowedOptions: field.allowedOptions,
    })),
    [formFields],
  );
  // Dans le formulaire d'OCCURRENCE, le bloc n'est plus un groupe a deleguer : c'est le
  // formulaire lui-meme. Sans cette leve, le moteur de champs retirerait ses propres variables.
  const formSections = useMemo(() => [{ ...section, isRepeatable: false }], [section]);

  // La ligne tamponnee emprunte la FORME d'une rencontre pour traverser le tableau de L68.
  // Son identifiant reste local : rien ici ne vient du serveur, et rien n'y part.
  const tableRows = useMemo<Encounter[]>(
    () => rows.map((row) => ({
      id: row.localId,
      encounterType: 'autre',
      encounterDate: null,
      validationStatus: row.validationStatus,
      ageValue: null,
      ageUnit: null,
      data: row.data,
      groupSectionKey: row.sectionKey,
    })),
    [rows],
  );

  const limitReached = rows.length >= MAX_OCCURRENCES;
  const hidden = hiddenFieldKeys(rules ?? [], editing?.values ?? {}, formFields, formSections);
  const removed = withoutHiddenValues(editing?.values ?? {}, hidden).removed;
  const labelOf = (key: string) => formFields.find((field) => field.fieldKey === key)?.label ?? key;
  const rankOf = (localId: string) => rows.findIndex((row) => row.localId === localId) + 1;

  const markDraftDirty = (dirty: boolean) => {
    if (draftDirty.current === dirty) return;
    draftDirty.current = dirty;
    onDraftDirtyChange?.(dirty);
  };

  const close = () => {
    markDraftDirty(false);
    setEditing(null); setProblems([]); setHiddenConfirmation(false);
  };

  const open = (row: PendingOccurrence | null) => {
    setEditing(row
      ? { localId: row.localId, values: { ...row.data }, prefilled: new Set<string>() }
      : { localId: null, ...initialValuesFromDefaults(formFields) });
    setProblems([]);
    setHiddenConfirmation(false);
  };

  const setValue = (key: string, value: unknown, remove = false) => {
    markDraftDirty(true);
    setEditing((current) => {
      if (!current) return current;
      const values = { ...current.values };
      if (remove || (current.prefilled.has(key) && isClearedValue(value))) delete values[key]; else values[key] = value;
      return { ...current, values, prefilled: forgetPrefilled(current.prefilled, key) };
    });
  };

  function commit(confirmed = false) {
    if (!editing) return;
    const hiddenKeys = hiddenFieldKeys(rules ?? [], editing.values, formFields, formSections);
    const { values: data } = withoutHiddenValues(editing.values, hiddenKeys);
    // Meme arbitrage qu'une occurrence ecrite directement : le statut SUIT la completude, il ne
    // la decrete pas. Une ligne incomplete reste en brouillon et rejoindra la file (§8.5).
    const ruleErrors = evaluateRules(
      (rules ?? []).map((rule) => ({ rule: rule.rule, message: rule.message, severity: rule.severity })),
      data,
      hiddenKeys,
    ).blocking;
    const complete = validateValues(formFields, data, true, hiddenKeys).length === 0 && ruleErrors.length === 0;
    const strict = requireComplete || complete;
    const blocking = [
      ...validateValues(formFields, data, strict, hiddenKeys).map((issue) => `${labelOf(issue.fieldKey)} : ${issue.message}`),
      ...ruleErrors,
    ];
    setProblems(blocking);
    if (blocking.length > 0) return;
    if (removed.length > 0 && !confirmed) { setHiddenConfirmation(true); return; }

    const status = complete ? 'complete' : 'draft';
    if (editing.localId === null) {
      onAdd(data, status);
      setAnnouncement(t('form.repeatable_added').replace('{n}', String(rows.length + 1)));
    } else {
      onEdit(editing.localId, data, status);
    }
    close();
  }

  const rowNotice = (row: Encounter) => {
    const pending = rows.find((entry) => entry.localId === row.id);
    if (!pending) return null;
    if (isSavedOccurrence(pending)) {
      return <p className="mt-1 text-xs font-medium text-teal-700 dark:text-teal-300">{t('form.pending_saved')}</p>;
    }
    return (
      <div className="mt-1 max-w-sm space-y-1">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
          {pending.deliveryState === 'unknown' ? t('form.pending_unknown') : t('form.pending_unsaved')}
        </p>
        {/* Le message de l'echec est porte par SA ligne : c'est lui qui dit quoi corriger. */}
        {pending.deliveryState === 'unknown'
          ? <p role="alert" className="text-xs text-red-700 dark:text-red-300">{t('form.pending_unknown_message')}</p>
          : pending.error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{pending.error}</p>}
      </div>
    );
  };

  const rowActions = (row: Encounter) => {
    const pending = rows.find((entry) => entry.localId === row.id);
    // Une ligne ECRITE ne se corrige plus ici : elle existe cote serveur, et c'est la fiche
    // du patient qui la porte desormais. La montrer sans action dit exactement cela.
    if (!pending || isSavedOccurrence(pending) || pending.deliveryState === 'unknown') return null;
    const rank = rankOf(row.id);
    return (
      <>
        {!masked && <button
          type="button"
          className="text-xs font-medium text-teal-700 hover:underline"
          aria-label={t('form.repeatable_edit_occurrence').replace('{n}', String(rank)).replace('{group}', groupLabel)}
          disabled={busy || editing !== null}
          onClick={() => open(pending)}
        >
          {t('encounter.edit')}
        </button>}
        <button
          type="button"
          className="text-xs font-medium text-red-700 hover:underline"
          aria-label={t('form.repeatable_delete_occurrence').replace('{n}', String(rank)).replace('{group}', groupLabel)}
          disabled={busy || (!masked && editing !== null)}
          onClick={() => {
            onRemove(row.id);
            if (editing?.localId === row.id) close();
            setAnnouncement(t('form.repeatable_removed').replace('{n}', String(Math.max(rows.length - 1, 0))));
          }}
        >
          {t('form.pending_remove')}
        </button>
      </>
    );
  };

  return (
    <div className="min-w-0 max-w-full space-y-3">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
        {t('form.repeatable_count').replace('{n}', String(rows.length))}
      </p>
      {/* Annonce du compte a l'ajout et au retrait (§8.6). Vide au montage : une region vivante
          n'annonce que ce qui CHANGE, jamais l'etat initial de la page. */}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      {masked && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {t('form.repeatable_masked_pending').replace('{n}', String(rows.length))}
        </p>
      )}

      {masked ? null : !online
        ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('form.repeatable_offline')}</p>
        : <p className="text-sm text-slate-500 dark:text-slate-400">{t('form.pending_hint')}</p>}

      <RepeatableGroupTable
        groupLabel={groupLabel}
        columns={columns}
        rows={tableRows}
        rowActions={online ? rowActions : undefined}
        rowNotice={rowNotice}
      />

      {editing && !masked && (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
          {t('form.pending_finish_editor_before_other')}
        </p>
      )}
      {/* Une saisie commencee avant le masquage n'est ni perdue ni montree : elle retient
          l'enregistrement du patient, donc la personne doit pouvoir l'abandonner d'ici. */}
      {editing && masked && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <p role="status">{t('form.repeatable_masked_draft')}</p>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDiscarding(true)}>{t('common.cancel')}</button>
        </div>
      )}

      {online && !masked && (
        <div className="space-y-1">
          <button type="button" className="btn-secondary" disabled={limitReached || busy || editing !== null} onClick={() => open(null)}>
            <Plus size={16} aria-hidden /> {t('form.repeatable_add')}
          </button>
          {limitReached && (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {t('form.repeatable_limit').replace('{max}', String(MAX_OCCURRENCES))}
            </p>
          )}
        </div>
      )}

      {online && !masked && editing && (
        // Pas un `form` : le bloc est rendu DANS le formulaire de la fiche. Entree ne doit
        // jamais soumettre la fiche autour, ni enregistrer un patient a la place d'une ligne.
        <fieldset
          disabled={busy}
          id={formId}
          role="group"
          aria-label={editing.localId === null
            ? t('form.repeatable_new_title').replace('{group}', groupLabel)
            : t('form.repeatable_edit_title').replace('{n}', String(rankOf(editing.localId))).replace('{group}', groupLabel)}
          className="min-w-0 space-y-4 rounded-xl border border-teal-200 bg-teal-50/40 p-4 dark:border-teal-900 dark:bg-teal-950/20"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.stopPropagation();
              if (event.target instanceof HTMLInputElement) event.preventDefault();
            }
          }}
        >
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {editing.localId === null
              ? t('form.repeatable_new_title').replace('{group}', groupLabel)
              : t('form.repeatable_edit_title').replace('{n}', String(rankOf(editing.localId))).replace('{group}', groupLabel)}
          </p>

          {/* Le moteur de champs existant, avec ses regles internes, ses valeurs par defaut et
              ses codes de donnee manquante. Aucun second moteur n'est ecrit ici. */}
          <EncounterFields
            key={editing.localId ?? 'new'}
            fields={formFields}
            values={editing.values}
            sections={formSections}
            rules={rules}
            hiddenKeys={hidden}
            prefilledKeys={editing.prefilled}
            requireComplete={requireComplete}
            onChange={(key, value) => setValue(key, value)}
            onRemove={(key) => setValue(key, undefined, true)}
          />

          <HiddenValuesNotice removedKeys={removed} fields={formFields} />
          {hiddenConfirmation && <HiddenValuesConfirmation removedKeys={removed} fields={formFields}
            onConfirm={() => commit(true)} onCancel={() => setHiddenConfirmation(false)} />}

          {problems.length > 0 && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <ul className="list-disc pl-5">{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => commit()}>
              {t('form.pending_keep')}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDiscarding(true)}>
              {t('common.cancel')}
            </button>
          </div>
        </fieldset>
      )}

      <ConfirmDialog open={discarding} title={t('leave.title')} body={t('form.repeatable_discard')}
        confirmLabel={t('leave.confirm')} onCancel={() => setDiscarding(false)}
        onConfirm={() => { setDiscarding(false); close(); }} />
    </div>
  );
}
