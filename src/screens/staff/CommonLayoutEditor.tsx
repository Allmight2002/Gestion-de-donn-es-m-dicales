import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { CommonLayoutPayload, TemplateCommonLayout, TemplateField, TemplateSection } from '../../data/types';
import { findProposalField, isProposalSource } from '../../domain/proposalField';
import { errorMessage, structuredErrorCode } from '../../lib/errorMessage';
import { useI18n } from '../../i18n/useI18n';

type DraftGroup = CommonLayoutPayload['groups'][number];
type Draft = { defaultKey: string | null; groups: DraftGroup[] };

const copyGroup = (group: DraftGroup): DraftGroup => ({ ...group, fields: [...group.fields] });

function draftFrom(layout: TemplateCommonLayout, fields: readonly TemplateField[]): Draft {
  const keys = new Set(fields.filter((field) => field.section === null).map((field) => field.fieldKey));
  const assigned = new Set<string>();
  const groups = layout.groups.map((group) => ({
    key: group.key,
    label: group.label,
    anchor: group.anchor,
    fields: group.fields.filter((key) => keys.has(key) && !assigned.has(key) && (assigned.add(key), true)),
  }));
  return {
    defaultKey: layout.defaultKey && groups.some((group) => group.key === layout.defaultKey)
      ? layout.defaultKey : groups[0]?.key ?? null,
    groups,
  };
}

function stablePayload(draft: Draft): CommonLayoutPayload {
  return { defaultKey: draft.defaultKey, groups: draft.groups.map(copyGroup) };
}

function nextGroupKey(groups: readonly DraftGroup[]): string {
  const keys = new Set(groups.map((group) => group.key));
  for (let index = 1; ; index += 1) {
    const key = `rubrique_${index}`;
    if (!keys.has(key)) return key;
  }
}

/**
 * Editeur UX-16. Il ne touche jamais `template_field.section` : le seul effet ecrit est la
 * charge complete remise a la RPC atomique. Les choix restent locaux jusqu'au recu, y compris
 * apres une perte de reponse ou un conflit d'empreinte.
 */
export function CommonLayoutEditor({
  layout,
  fields,
  sections,
  disabled = false,
  onSave,
  onDirtyChange,
}: {
  layout: TemplateCommonLayout;
  fields: readonly TemplateField[];
  sections: readonly TemplateSection[];
  disabled?: boolean;
  onSave: (operationId: string, payload: CommonLayoutPayload, expectedFingerprint: string) => Promise<void>;
  /** Notifie le parent de la difference entre le brouillon local et son baseline serveur. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const commonFields = useMemo(() => fields.filter((field) => field.section === null)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.fieldKey.localeCompare(b.fieldKey)), [fields]);
  const fieldByKey = useMemo(() => new Map(commonFields.map((field) => [field.fieldKey, field])), [commonFields]);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(layout, commonFields));
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const attempt = useRef<{ fingerprint: string; payload: string; operationId: string } | null>(null);
  // Le baseline reste celui qui a servi a ouvrir l'ecran jusqu'a un accuse de succes. Il
  // permet d'envoyer l'ancienne empreinte apres un changement concurrent, afin que la RPC
  // refuse l'ecrasement au lieu d'accepter silencieusement le nouvel etat des props.
  const baselineSnapshot = useRef<string | null>(null);
  const baselineFingerprint = useRef(layout.fingerprint);
  const commonFieldSignature = commonFields.map((field) => `${field.fieldKey}:${field.label}:${field.displayOrder}`).join('|');
  const incomingSignature = `${layout.fingerprint}|${commonFieldSignature}`;
  const seenIncoming = useRef(incomingSignature);
  if (baselineSnapshot.current === null) baselineSnapshot.current = JSON.stringify(stablePayload(draft));

  const currentSnapshot = JSON.stringify(stablePayload(draft));
  const dirty = currentSnapshot !== baselineSnapshot.current;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Une remise a jour apres accuse remplace le brouillon par le recu serveur. Un changement
  // externe pendant une frappe, lui, ne doit jamais effacer les inputs locaux : le brouillon
  // reste base sur l'ancienne empreinte et la prochaine tentative sera refusee proprement.
  useEffect(() => {
    if (seenIncoming.current === incomingSignature) return;
    seenIncoming.current = incomingSignature;
    const nextDraft = draftFrom(layout, commonFields);
    const nextSnapshot = JSON.stringify(stablePayload(nextDraft));
    const hasLocalChanges = currentSnapshot !== baselineSnapshot.current;
    if (!hasLocalChanges) {
      setDraft(nextDraft);
      baselineSnapshot.current = nextSnapshot;
      baselineFingerprint.current = layout.fingerprint;
      attempt.current = null;
      setFailure(null);
    } else if (layout.fingerprint !== baselineFingerprint.current) {
      // Le parent peut relire la version apres une operation d'un autre panneau. Garder le
      // texte local permet au parent de demander une decision explicite sans perte de saisie.
      setFailure(t('commonlayout.conflict'));
    }
  }, [commonFields, currentSnapshot, incomingSignature, layout, t]);

  const rootSections = useMemo(() => sections.filter((section) => !section.parentSectionKey)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.sectionKey.localeCompare(b.sectionKey)), [sections]);
  const assigned = useMemo(() => new Set(draft.groups.flatMap((group) => group.fields)), [draft.groups]);
  const unassigned = commonFields.filter((field) => !assigned.has(field.fieldKey));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = (field: TemplateField) => !normalizedQuery
    || [field.label, field.fieldKey].join(' ').toLocaleLowerCase().includes(normalizedQuery);

  const linkedKeys = (fieldKey: string): string[] => {
    const current = fieldByKey.get(fieldKey);
    const source = current && isProposalSource(current)
      ? current
      : commonFields.find((candidate) => isProposalSource(candidate)
        && findProposalField(commonFields, candidate)?.fieldKey === fieldKey);
    if (!source) return [fieldKey];
    const companion = findProposalField(commonFields, source);
    return companion ? [source.fieldKey, companion.fieldKey] : [source.fieldKey];
  };

  function updateGroups(change: (groups: DraftGroup[]) => DraftGroup[]) {
    setDraft((current) => ({ ...current, groups: change(current.groups.map(copyGroup)) }));
    setFailure(null);
  }

  function place(fieldKey: string, destination: string) {
    const keys = new Set(linkedKeys(fieldKey));
    updateGroups((groups) => {
      const next = groups.map((group) => ({ ...group, fields: group.fields.filter((key) => !keys.has(key)) }));
      const target = next.find((group) => group.key === destination);
      if (target) target.fields.push(...[...keys].filter((key) => fieldByKey.has(key)));
      return next;
    });
  }

  function moveWithin(groupKey: string, fieldKey: string, delta: -1 | 1) {
    const keys = new Set(linkedKeys(fieldKey));
    updateGroups((groups) => groups.map((group) => {
      if (group.key !== groupKey) return group;
      const unit = group.fields.filter((key) => keys.has(key));
      if (unit.length === 0) return group;
      const first = group.fields.findIndex((key) => keys.has(key));
      const rest = group.fields.filter((key) => !keys.has(key));
      const currentIndex = group.fields.slice(0, first).filter((key) => !keys.has(key)).length;
      const targetIndex = Math.max(0, Math.min(rest.length, currentIndex + delta));
      return { ...group, fields: [...rest.slice(0, targetIndex), ...unit, ...rest.slice(targetIndex)] };
    }));
  }

  function changeLabel(key: string, label: string) {
    updateGroups((groups) => groups.map((group) => group.key === key ? { ...group, label } : group));
  }

  function changeAnchor(key: string, anchor: number) {
    updateGroups((groups) => groups.map((group) => group.key === key ? { ...group, anchor } : group));
  }

  function addGroup() {
    setDraft((current) => {
      const key = nextGroupKey(current.groups);
      return { defaultKey: current.defaultKey ?? key, groups: [...current.groups, {
        key, label: t('commonlayout.new_group'), anchor: 0, fields: [],
      }] };
    });
    setFailure(null);
  }

  function activateLegacyLayout() {
    if (draft.groups.length > 0) return;
    const key = 'tronc_commun';
    setDraft({ defaultKey: key, groups: [{
      key, label: t('section.common'), anchor: 0, fields: commonFields.map((field) => field.fieldKey),
    }] });
    setFailure(null);
  }

  const blankLabel = draft.groups.some((group) => group.label.trim() === '');
  const complete = draft.groups.length === 0 ? unassigned.length === commonFields.length : unassigned.length === 0;
  const readOnly = disabled || layout.locked || layout.inUse;
  const canSave = !readOnly && !saving && !blankLabel && complete;

  async function save() {
    const payload = stablePayload(draft);
    const serialized = JSON.stringify(payload);
    const expectedFingerprint = baselineFingerprint.current;
    const currentAttempt = attempt.current?.fingerprint === expectedFingerprint && attempt.current.payload === serialized
      ? attempt.current
      : { fingerprint: expectedFingerprint, payload: serialized, operationId: crypto.randomUUID() };
    attempt.current = currentAttempt;
    setSaving(true);
    setFailure(null);
    try {
      await onSave(currentAttempt.operationId, payload, expectedFingerprint);
      // Seul l'accuse de succes avance le baseline. En particulier, un conflit conserve le
      // meme payload et la meme operation pour une reprise idempotente.
      baselineSnapshot.current = serialized;
      baselineFingerprint.current = expectedFingerprint;
      attempt.current = null;
      onDirtyChange?.(false);
    } catch (error) {
      // La cle reste en memoire : un clic de reprise apres une reponse perdue est le MEME
      // rejeu idempotent, pas une deuxieme operation. Le brouillon n'est pas recharge non
      // plus : un refus ne doit pas effacer des choix que le serveur n'a jamais ecrits.
      const code = structuredErrorCode(error);
      setFailure(
        code === 'common_layout_conflict' ? t('commonlayout.conflict')
        : code === 'common_layout_version_locked' || code === 'common_layout_version_in_use' ? t('commonlayout.frozen')
        // Les autres refus du contrat sont des etats que l'ecran empeche deja : les montrer
        // en clair vaut mieux que d'exposer leur jeton technique.
        : code?.startsWith('common_layout_') ? t('commonlayout.refused')
        : errorMessage(error, t('common.error')),
      );
    } finally {
      setSaving(false);
    }
  }

  if (commonFields.length === 0) return null;

  return (
    <section aria-labelledby="common-layout-title" className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div>
        <h3 id="common-layout-title" className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('commonlayout.title')}</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t('commonlayout.hint')}</p>
      </div>
      {readOnly ? (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{t('commonlayout.readonly')}</p>
      ) : draft.groups.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="min-w-0 flex-1 text-sm text-slate-600 dark:text-slate-300">{t('commonlayout.legacy')}</p>
          <button type="button" className="btn-secondary" onClick={activateLegacyLayout}>{t('commonlayout.customize')}</button>
        </div>
      ) : (
        <>
          <label className="block max-w-md text-sm text-slate-700 dark:text-slate-200">
            <span>{t('commonlayout.search')}</span>
            <input type="search" className="input mt-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('commonlayout.search_hint')} />
          </label>
          <div className="space-y-3">
            {draft.groups.map((group) => {
              const groupFields = group.fields.map((key) => fieldByKey.get(key)).filter((field): field is TemplateField => !!field);
              return (
                <fieldset key={group.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <legend className="sr-only">{group.label || group.key}</legend>
                  <div className="grid gap-3 lg:grid-cols-[minmax(14rem,1fr)_minmax(16rem,1fr)_auto] lg:items-end">
                    <label className="text-sm text-slate-700 dark:text-slate-200">
                      <span>{t('commonlayout.label')}</span>
                      <input className="input mt-1" value={group.label} maxLength={120} onChange={(event) => changeLabel(group.key, event.target.value)} />
                    </label>
                    <label className="text-sm text-slate-700 dark:text-slate-200">
                      <span>{t('commonlayout.position')}</span>
                      <select className="input mt-1" value={group.anchor} onChange={(event) => changeAnchor(group.key, Number(event.target.value))}>
                        <option value={0}>{t('commonlayout.before_blocks')}</option>
                        {rootSections.map((section, index) => <option key={section.sectionKey} value={index + 1}>
                          {t('commonlayout.after_block').replace('{label}', section.label)}
                        </option>)}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn-ghost min-h-11 px-2 text-sm text-red-700"
                      disabled={group.fields.length > 0}
                      title={group.fields.length > 0 ? t('commonlayout.remove_hint') : undefined}
                      aria-label={t('commonlayout.remove').replace('{label}', group.label || group.key)}
                      onClick={() => setDraft((current) => ({
                        defaultKey: current.defaultKey === group.key ? current.groups.find((item) => item.key !== group.key)?.key ?? null : current.defaultKey,
                        groups: current.groups.filter((item) => item.key !== group.key),
                      }))}
                    >
                      {t('admin.delete')}
                    </button>
                  </div>
                  <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input type="radio" name="common-layout-default" checked={draft.defaultKey === group.key}
                      onChange={() => setDraft((current) => ({ ...current, defaultKey: group.key }))} />
                    {t('commonlayout.default')}
                  </label>
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">{t('commonlayout.fields')}</p>
                  <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
                    {groupFields.filter(visible).map((field) => {
                      const linked = linkedKeys(field.fieldKey);
                      const index = group.fields.findIndex((key) => key === field.fieldKey);
                      const hasBefore = group.fields.slice(0, index).some((key) => !linked.includes(key));
                      const hasAfter = group.fields.slice(index + 1).some((key) => !linked.includes(key));
                      const isCompanion = linked[0] !== field.fieldKey;
                      return <li key={field.fieldKey} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <span className="min-w-0 flex-1 break-words">{field.label} <span className="font-mono text-xs text-slate-500">{field.fieldKey}</span>
                          {isCompanion && <span className="ml-1 text-xs text-slate-500">· {t('commonlayout.linked')}</span>}
                        </span>
                        <select className="input min-h-9 max-w-56 py-1 text-xs" aria-label={t('commonlayout.destination').replace('{label}', field.label)} value={group.key}
                          onChange={(event) => place(field.fieldKey, event.target.value)}>
                          {draft.groups.map((destination) => <option key={destination.key} value={destination.key}>{destination.label || destination.key}</option>)}
                        </select>
                        <button type="button" className="icon-button h-9 w-9" disabled={!hasBefore} aria-label={t('commonlayout.move_up').replace('{label}', field.label)} onClick={() => moveWithin(group.key, field.fieldKey, -1)}><ArrowUp size={16} aria-hidden /></button>
                        <button type="button" className="icon-button h-9 w-9" disabled={!hasAfter} aria-label={t('commonlayout.move_down').replace('{label}', field.label)} onClick={() => moveWithin(group.key, field.fieldKey, 1)}><ArrowDown size={16} aria-hidden /></button>
                      </li>;
                    })}
                  </ul>
                </fieldset>
              );
            })}
          </div>
          {unassigned.filter(visible).length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">{t('commonlayout.unassigned')}</p>
              <ul className="mt-1 divide-y divide-amber-100 dark:divide-amber-900">
                {unassigned.filter(visible).map((field) => <li key={field.fieldKey} className="flex flex-wrap items-center gap-2 py-2 text-sm text-amber-950 dark:text-amber-50">
                  <span className="min-w-0 flex-1 break-words">{field.label} <span className="font-mono text-xs">{field.fieldKey}</span></span>
                  <select className="input min-h-9 max-w-56 py-1 text-xs" aria-label={t('commonlayout.destination').replace('{label}', field.label)} value="" onChange={(event) => place(field.fieldKey, event.target.value)}>
                    <option value="">{t('commonlayout.unassigned')}</option>
                    {draft.groups.map((destination) => <option key={destination.key} value={destination.key}>{destination.label || destination.key}</option>)}
                  </select>
                </li>)}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary" onClick={addGroup}>{t('commonlayout.add')}</button>
            <button type="button" className="btn-primary" disabled={!canSave} onClick={() => void save()}>{saving ? t('admin.state_saving') : t('commonlayout.save')}</button>
            {blankLabel && <span role="status" className="text-sm text-amber-800">{t('commonlayout.label_required')}</span>}
            {!blankLabel && !complete && <span role="status" className="text-sm text-amber-800">{t('commonlayout.incomplete')}</span>}
            {failure && <span role="alert" className="text-sm text-red-700">{failure}</span>}
          </div>
        </>
      )}
    </section>
  );
}
