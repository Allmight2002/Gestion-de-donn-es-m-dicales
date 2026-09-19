// L31 — gestion des sections d'une version de gabarit.
//
// Une section est le regroupement visuel du formulaire : « identification », « imagerie »,
// « evolution ». Elle appartient a la VERSION, donc elle est gelee des que la version est
// publiee, exactement comme une variable — l'ecran n'est simplement pas rendu dans ce cas.
//
// Le CODE INTERNE ne se modifie jamais (lecon de L30) : il est propose a la creation, puis
// affiche en lecture seule. Seul le libelle se corrige.

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { Checkbox } from '../../components/Checkbox';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { ObservationModel } from '../../data/bases';
import type { TemplateField, TemplateSection } from '../../data/types';
import { makeValueKey } from '../../domain/fieldOptions';
import { sectionLabel } from '../../domain/templateSections';

/**
 * Code interne propose depuis le libelle saisi — meme derivation que les codes d'options
 * (L30), avec deux garanties de plus exigees par la base :
 *   * commencer par une lettre (« 2024 » seul serait refuse) ;
 *   * ne pas entrer en collision avec un code deja pris dans la version.
 */
export function makeSectionKey(label: string, taken: readonly string[] = []): string {
  const raw = makeValueKey(label, []);
  const seed = (/^[a-z]/.test(raw) ? raw : `s_${raw}`).slice(0, 63);
  if (!taken.includes(seed)) return seed;
  for (let n = 2; ; n += 1) {
    const candidate = `${seed.slice(0, 60)}_${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export function SectionsEditor({
  sections,
  fields,
  busy,
  onAdd,
  onRename,
  onDelete,
  onReorder,
  onMove,
  onReorderSiblings,
  onImportBlock,
  onRepeatableChange,
  observationModel,
  onDirtyChange,
}: {
  sections: TemplateSection[];
  /** Sert a dire, avant tout clic, combien de variables une section porte. */
  fields: TemplateField[];
  busy?: boolean;
  onAdd: (sectionKey: string, label: string, parentKey?: string | null) => void | Promise<unknown>;
  onRename: (sectionId: string, label: string) => void | Promise<unknown>;
  onDelete: (sectionId: string) => void;
  onMove?: (id: string, parentKey: string | null) => void;
  onReorderSiblings?: (parentKey: string | null, ids: string[]) => void;
  onReorder: (orderedIds: string[]) => void;
  /** L59 : ouvre le choix d'un bloc reutilisable. Absente quand le serveur ne sait pas
   *  encore lister les blocs importables : la commande ne se rend alors pas du tout. */
  onImportBlock?: () => void;
  /**
   * L67 : declare un bloc racine repetable. `fieldsToConvert` porte les variables que
   * l'ecran doit basculer en portee rencontre AVANT d'ecrire l'indicateur — la base refuse
   * un groupe repetable qui contient encore une variable de portee patient.
   * Absente quand le serveur ne sait pas encore ecrire l'indicateur : la case ne se rend pas.
   */
  onRepeatableChange?: (
    sectionId: string, isRepeatable: boolean, fieldsToConvert: TemplateField[],
  ) => void | Promise<unknown>;
  /** Modele d'observation de la base. Un groupe repetable exige des variables de rencontre. */
  observationModel?: ObservationModel;
  /** Notifie le parent de la saisie locale non accusee (ajout ou renommage). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const [parentKey, setParentKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [pendingEditAction, setPendingEditAction] = useState<
    { kind: 'switch'; sectionId: string } | { kind: 'cancel' } | null
  >(null);
  const originalLabel = useRef('');
  const pendingRename = useRef<{ sectionId: string; label: string } | null>(null);
  const pendingAdd = useRef<{ sectionKey: string; label: string } | null>(null);

  const fieldsIn = (sectionKey: string) => fields.filter((f) => f.section === sectionKey);
  const countIn = (sectionKey: string) => fieldsIn(sectionKey).length;

  // L67 — une variable de rencontre est refusee sur une base transversale (garde serveur
  // `enforce_observation_model_on_template_field`), donc un groupe repetable l'est aussi.
  // Le modele se verrouille a la premiere fiche : c'est un fait acquis, pas un reglage a
  // contourner, et l'ecran le presente comme tel.
  const isCrossSectional = observationModel === 'cross_sectional';
  const [pendingRepeatable, setPendingRepeatable] = useState<TemplateSection | null>(null);
  const repeatableFields = pendingRepeatable ? fieldsIn(pendingRepeatable.sectionKey) : [];
  // Le sens des lignes deja ecrites changerait : c'est ce qui bloque, avant toute conversion.
  const repeatableBlocked = repeatableFields.filter((f) => f.inUse);
  const repeatableToConvert = repeatableFields.filter((f) => f.scope !== 'encounter');
  // L'ecriture couvre aussi les variables qui portent encore des types de rencontre : §5 veut
  // `encounter_types` NUL sur les variables d'un bloc repetable, ce n'est plus lui qui filtre.
  const repeatableToNormalize = repeatableFields.filter(
    (f) => f.scope !== 'encounter' || (f.encounterTypes?.length ?? 0) > 0,
  );

  const editingDirty = editingId !== null && draftLabel !== originalLabel.current;
  const dirty = (newLabel !== '' || parentKey !== '') || editingDirty;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  function finishEditing() {
    setEditingId(null);
    setDraftLabel('');
    originalLabel.current = '';
  }

  function beginEditing(section: TemplateSection) {
    pendingRename.current = null;
    setEditingId(section.id);
    setDraftLabel(section.label);
    originalLabel.current = section.label;
  }

  function requestEditing(section: TemplateSection) {
    if (editingId && editingId !== section.id && editingDirty) {
      setPendingEditAction({ kind: 'switch', sectionId: section.id });
      return;
    }
    beginEditing(section);
  }

  function requestCancelEditing() {
    if (editingDirty) setPendingEditAction({ kind: 'cancel' });
    else finishEditing();
  }

  function sectionRenameConfirmed(sectionId: string, label: string) {
    if (pendingRename.current?.sectionId !== sectionId || pendingRename.current.label !== label) return;
    pendingRename.current = null;
    finishEditing();
  }

  function sectionAddConfirmed(sectionKey: string) {
    if (pendingAdd.current?.sectionKey !== sectionKey) return;
    pendingAdd.current = null;
    setNewLabel('');
    setParentKey('');
  }

  // Les callbacks historiques etaient `void run(...)`. Avec un callback qui retourne la
  // promesse de `run`, l'accuse de succes nettoie le brouillon meme si les props arrivent un
  // peu plus tard. Le second chemin ci-dessous couvre le callback historique en observant la
  // version rechargee ; dans les deux cas un refus laisse le texte intact.
  useEffect(() => {
    const rename = pendingRename.current;
    if (rename && sections.some((section) => section.id === rename.sectionId && section.label === rename.label)) {
      pendingRename.current = null;
      setEditingId(null);
      setDraftLabel('');
      originalLabel.current = '';
    }
    const add = pendingAdd.current;
    if (add && sections.some((section) => section.sectionKey === add.sectionKey && section.label === add.label)) {
      pendingAdd.current = null;
      setNewLabel('');
      setParentKey('');
    }
  }, [sections]);

  function isPromiseLike(value: unknown): value is Promise<unknown> {
    return !!value && typeof (value as { then?: unknown }).then === 'function';
  }

  function move(sectionId: string, delta: -1 | 1) {
    const parent = sections.find((s) => s.id === sectionId)?.parentSectionKey ?? null;
    const ordered = sections.filter((s) => (s.parentSectionKey ?? null) === parent);
    const from = ordered.findIndex((s) => s.id === sectionId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    if (onReorderSiblings) onReorderSiblings(parent, ordered.map((s) => s.id));
    else onReorder(ordered.map((s) => s.id));
  }

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-slate-700">{t('admin.sections')}</h3>

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const label = newLabel.trim();
          if (label === '') return;
          const sectionKey = makeSectionKey(label, sections.map((s) => s.sectionKey));
          pendingAdd.current = { sectionKey, label };
          try {
            const result = onAdd(sectionKey, label, parentKey || null);
            if (isPromiseLike(result)) {
              void result.then((outcome) => {
                if (outcome !== false) sectionAddConfirmed(sectionKey);
              }).catch(() => { /* le parent affiche le refus, la saisie reste locale */ });
            }
          } catch {
            pendingAdd.current = null;
          }
        }}
      >
        <label className="form-label min-w-0 flex-1">
          {t('admin.section_label')}
          <input
            className="input"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('admin.section_placeholder')}
          />
        </label>
        <label className="form-label">{t('section.parent')}
          <select className="input" value={parentKey} onChange={(e) => setParentKey(e.target.value)}>
            <option value="">{t('section.root')}</option>
            {sections.filter((s) => !s.parentSectionKey).map((s) => <option key={s.id} value={s.sectionKey}>{sectionLabel(t, s)}</option>)}
          </select>
        </label>
        <button type="submit" className="btn-secondary" disabled={busy || newLabel.trim() === ''}>
          {t('admin.section_add')}
        </button>
        {/* Importer et creer sont le meme geste vu de l'utilisateur : ajouter un
            regroupement a cette version. Les deux commandes restent donc cote a cote. */}
        {onImportBlock && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={onImportBlock}>
            {t('blockimport.command')}
          </button>
        )}
      </form>

      <ul className="mt-3 space-y-2 text-sm">
        {sections.map((section) => {
          const siblings = sections.filter((s) => (s.parentSectionKey ?? null) === (section.parentSectionKey ?? null));
          const index = siblings.findIndex((s) => s.id === section.id);
          const hasChildren = sections.some((s) => s.parentSectionKey === section.sectionKey);
          const used = countIn(section.sectionKey);
          return (
            <li key={section.id} className={`card flex min-w-0 flex-wrap items-start gap-2 px-3 py-2 ${section.parentSectionKey ? 'ml-6 border-l-4' : ''}`}>
              <span className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => move(section.id, -1)}
                  disabled={busy || index === 0}
                  aria-label={t('admin.move_up')}
                  className="min-h-6 px-1 text-slate-400 disabled:opacity-30 hover:text-slate-700"
                >
                  <ArrowUp size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(section.id, 1)}
                  disabled={busy || index === siblings.length - 1}
                  aria-label={t('admin.move_down')}
                  className="min-h-6 px-1 text-slate-400 disabled:opacity-30 hover:text-slate-700"
                >
                  <ArrowDown size={14} aria-hidden />
                </button>
              </span>

              {editingId === section.id ? (
                <>
                  <input
                    className="input min-w-[min(12rem,100%)] flex-1"
                    value={draftLabel}
                    onChange={(e) => setDraftLabel(e.target.value)}
                    aria-label={t('admin.section_label')}
                  />
                  <button
                    type="button"
                    className="btn-primary min-h-11 px-3 text-xs"
                    disabled={busy || draftLabel.trim() === ''}
                    onClick={() => {
                      const label = draftLabel.trim();
                      pendingRename.current = { sectionId: section.id, label };
                      try {
                        const result = onRename(section.id, label);
                        if (isPromiseLike(result)) {
                          void result.then((outcome) => {
                            if (outcome !== false) sectionRenameConfirmed(section.id, label);
                          }).catch(() => { /* le parent affiche le refus, la saisie reste locale */ });
                        }
                      } catch {
                        pendingRename.current = null;
                      }
                    }}
                  >
                    {t('admin.save')}
                  </button>
                  <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={requestCancelEditing}>
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <>
                  {/* Le libelle ne partage plus sa ligne avec les commandes. Reduit a `min-w-0`,
                      il tombait a quelques pixels des que la liste deroulante des parents etait
                      large, et s'affichait alors une lettre par ligne. */}
                  <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                    <span className="break-words font-medium text-slate-900">{sectionLabel(t, section)}</span>
                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
                      {/* Le code interne est montre, jamais modifiable : c'est lui que portent
                          les fiches deja saisies et les instantanes hors-ligne. */}
                      <span className="break-all font-mono text-slate-400">{section.sectionKey}</span>
                      <span className="text-slate-500">{t('admin.section_field_count').replace('{n}', String(used))}</span>
                    </span>
                  </div>
                  <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-ghost min-h-11 px-3 text-xs"
                      disabled={busy}
                      onClick={() => {
                        requestEditing(section);
                      }}
                    >
                      {t('admin.rename')}
                    </button>
                    {onMove && <select aria-label={t('section.parent')} className="input w-auto max-w-full sm:max-w-[12rem]" value={section.parentSectionKey ?? ''}
                      disabled={busy || hasChildren} onChange={(e) => onMove(section.id, e.target.value || null)}>
                      <option value="">{t('section.root')}</option>
                      {sections.filter((s) => !s.parentSectionKey && s.id !== section.id).map((s) => <option key={s.id} value={s.sectionKey}>{sectionLabel(t, s)}</option>)}
                    </select>}
                    {used > 0 || hasChildren ? (
                      // Supprimer une section peuplee ferait basculer ses variables sur
                      // « Autre » : le formulaire changerait d'apparence sans decision.
                      <button
                        type="button"
                        disabled
                        className="min-h-11 cursor-not-allowed px-2 text-xs font-medium text-slate-500"
                        title={t('admin.section_not_empty')}
                      >
                        {t('admin.delete')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete(section.id)}
                        className="min-h-11 px-2 text-xs font-medium text-red-600 hover:underline"
                      >
                        {t('admin.delete')}
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* L67 — un bloc racine peut devenir un GROUPE REPETABLE. La case porte la regle
                  de decision du §3.3 en libelle secondaire : elle se tranche sur l'unite
                  d'analyse, pas sur la forme du formulaire. */}
              {!section.parentSectionKey && onRepeatableChange && (
                <div className="basis-full border-t border-slate-100 pt-2 dark:border-slate-700">
                  <Checkbox
                    label={t('section.repeatable')}
                    description={isCrossSectional ? t('section.repeatable_locked_model') : t('section.repeatable_hint')}
                    checked={section.isRepeatable === true}
                    disabled={busy || isCrossSectional}
                    onChange={(event) => {
                      if (event.target.checked) setPendingRepeatable(section);
                      else void onRepeatableChange(section.id, false, []);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pendingEditAction !== null}
        title={t('admin.leave_variable_title')}
        body={t('admin.leave_variable_body')}
        confirmLabel={t('admin.leave_variable_confirm')}
        onCancel={() => setPendingEditAction(null)}
        onConfirm={() => {
          const action = pendingEditAction;
          setPendingEditAction(null);
          if (!action) return;
          if (action.kind === 'cancel') {
            finishEditing();
            return;
          }
          const section = sections.find((candidate) => candidate.id === action.sectionId);
          if (section) beginEditing(section);
        }}
      />

      {/* L67 — cocher ne bascule rien avant que les trois consequences aient ete lues, et
          rien du tout si une variable du bloc porte deja des donnees. */}
      <ConfirmDialog
        open={pendingRepeatable !== null}
        title={t('section.repeatable_confirm_title')
          .replace('{block}', pendingRepeatable ? sectionLabel(t, pendingRepeatable) : '')}
        confirmLabel={t('section.repeatable_confirm')}
        confirmDisabled={busy || repeatableBlocked.length > 0}
        onCancel={() => setPendingRepeatable(null)}
        onConfirm={() => {
          const target = pendingRepeatable;
          setPendingRepeatable(null);
          if (!target || repeatableBlocked.length > 0) return;
          void onRepeatableChange?.(target.id, true, repeatableToNormalize);
        }}
      >
        <div className="space-y-3 text-sm">
          {repeatableBlocked.length > 0 ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              <p className="font-medium">{t('section.repeatable_blocked_title')}</p>
              <ul className="mt-1 list-disc pl-5">
                {repeatableBlocked.map((field) => <li key={field.id}>{field.label}</li>)}
              </ul>
              <p className="mt-2">{t('section.repeatable_blocked_body')}</p>
            </div>
          ) : (
            <>
              <div>
                <p className="font-medium text-slate-800 dark:text-slate-100">{t('section.repeatable_scope_title')}</p>
                {repeatableFields.length === 0 ? (
                  <p className="text-slate-600 dark:text-slate-300">{t('section.repeatable_empty')}</p>
                ) : repeatableToConvert.length === 0 ? (
                  <p className="text-slate-600 dark:text-slate-300">{t('section.repeatable_scope_none')}</p>
                ) : (
                  <ul className="mt-1 list-disc pl-5 text-slate-600 dark:text-slate-300">
                    {repeatableToConvert.map((field) => <li key={field.id}>{field.label}</li>)}
                  </ul>
                )}
              </div>
              <p className="text-slate-600 dark:text-slate-300">{t('section.repeatable_types_note')}</p>
            </>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}
