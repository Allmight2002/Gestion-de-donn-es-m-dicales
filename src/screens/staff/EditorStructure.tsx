import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, MoveVertical, Trash2 } from 'lucide-react';
import type { TemplateCommonLayout, TemplateField, TemplateSection } from '../../data/types';
import { groupFieldsBySection, sectionLabel } from '../../domain/templateSections';
import { fieldTypeLabel } from '../../domain/templateLabels';
import { useI18n } from '../../i18n/useI18n';

/** Lignes construites d'un coup. Au-dela, l'ecran propose d'en afficher davantage. */
const PAGE_SIZE = 60;

export interface EditorGroup {
  key: string;
  label: string;
  parentKey: string | null;
  common: boolean;
  fields: TemplateField[];
}

/** Editing also exposes empty sections. Common groups use the renderer's actual assignments. */
export function editorGroups(
  fields: TemplateField[], sections: TemplateSection[], layout: TemplateCommonLayout | undefined,
  t: Parameters<typeof sectionLabel>[0],
): EditorGroup[] {
  const rendered = groupFieldsBySection(fields, sections, layout);
  const groups = new Map<string, EditorGroup>();
  for (const group of rendered) groups.set(group.key, {
    key: group.key, label: sectionLabel(t, { sectionKey: group.key, label: group.label }),
    parentKey: group.parentSectionKey ?? null,
    common: group.key === '__common__' || group.key.startsWith('__common_group__:'), fields: group.fields,
  });
  for (const section of sections) if (!groups.has(section.sectionKey)) groups.set(section.sectionKey, {
    key: section.sectionKey, label: sectionLabel(t, section), parentKey: section.parentSectionKey ?? null,
    common: false, fields: [],
  });
  for (const group of layout?.groups ?? []) {
    const key = `__common_group__:${group.key}`;
    if (!groups.has(key)) groups.set(key, { key, label: group.label, parentKey: null, common: true, fields: [] });
  }
  if (!layout?.groups.length && !groups.has('__common__')) groups.set('__common__', {
    key: '__common__', label: t('section.common'), parentKey: null, common: true, fields: [],
  });
  const roots = sections.filter((section) => !section.parentSectionKey)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.sectionKey.localeCompare(b.sectionKey));
  const result: EditorGroup[] = [];
  const append = (key: string) => { const group = groups.get(key); if (group) { result.push(group); groups.delete(key); } };
  append('__common__');
  for (let anchor = 0; anchor <= roots.length; anchor++) {
    for (const common of layout?.groups ?? []) if (Math.min(common.anchor, roots.length) === anchor) append(`__common_group__:${common.key}`);
    const root = roots[anchor];
    if (!root) continue;
    append(root.sectionKey);
    sections.filter((section) => section.parentSectionKey === root.sectionKey)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.sectionKey.localeCompare(b.sectionKey))
      .forEach((section) => append(section.sectionKey));
  }
  return [...result, ...groups.values()];
}

export function EditorStructure({ groups, activeKey, onSelect, displayedFields, allFields, editable, busy,
  canReorder, onOpen, onMove, onStep, onDelete, onDrop, onRules, ruleCount, context, management,
}: {
  groups: EditorGroup[]; activeKey: string; onSelect: (key: string) => void;
  displayedFields: TemplateField[]; allFields: TemplateField[]; editable: boolean; busy: boolean;
  canReorder: boolean; onOpen: (field: TemplateField) => void; onMove: (field: TemplateField) => void;
  onStep: (id: string, direction: -1 | 1) => void; onDelete: (field: TemplateField) => void;
  onDrop: (fromId: string, toId: string) => void;
  onRules: (field?: TemplateField) => void; ruleCount: (field: TemplateField) => number;
  context: ReactNode; management: ReactNode;
}) {
  const { t } = useI18n();
  // A largeur etroite, le sommaire passe AU-DESSUS de la liste : le laisser deroule imposerait
  // de franchir 24 entrees avant d'atteindre la premiere variable. Il s'ouvre donc a la demande
  // sur petit ecran, et reste deroule des qu'il tient dans sa colonne.
  const [outlineOpen, setOutlineOpen] = useState(
    () => typeof window === 'undefined' || !window.matchMedia
      || window.matchMedia('(min-width: 1024px)').matches,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const active = groups.find((group) => group.key === activeKey);
  // Index construits UNE fois par rendu de liste. Recherchés ligne par ligne, `groupOf`,
  // `pathOf` et le rang coûtaient chacun un parcours complet : sur 216 lignes, la sous-vue
  // « Toutes les variables » payait des dizaines de milliers de comparaisons par rendu, et le
  // moindre changement de filtre en payait deux fois plus.
  const pathByKey = useMemo(() => {
    const labels = new Map(groups.map((group) => [group.key, group.label]));
    return new Map(groups.map((group) => [group.key,
      [group.parentKey ? labels.get(group.parentKey) : null, group.label].filter(Boolean).join(' / ')]));
  }, [groups]);
  const groupByFieldId = useMemo(() => {
    const index = new Map<string, EditorGroup>();
    for (const group of groups) for (const field of group.fields) index.set(field.id, group);
    return index;
  }, [groups]);
  const rankByFieldId = useMemo(
    () => new Map(allFields.map((field, index) => [field.id, index])), [allFields]);
  const pathOf = (group: EditorGroup) => pathByKey.get(group.key) ?? group.label;
  const groupOf = (field: TemplateField) => groupByFieldId.get(field.id);
  const children = groups.filter((group) => group.parentKey === activeKey);
  // Rendu BORNE. La mesure jsdom sur 216 variables (UX-14(d)) montre qu'une liste entiere
  // coute plusieurs secondes par rendu, et qu'un changement de filtre la paie deux fois. La
  // recherche et les filtres, eux, portent toujours sur TOUT le modele : seule la quantite de
  // lignes construites est bornee, et l'ecran dit combien il en rend et sur combien.
  const listKey = `${activeKey}|${displayedFields.length}`;
  const [window_, setWindow] = useState({ key: listKey, count: PAGE_SIZE });
  const shown = window_.key === listKey ? window_.count : PAGE_SIZE;
  const visibleFields = displayedFields.length > shown ? displayedFields.slice(0, shown) : displayedFields;
  return <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
    <details open={outlineOpen} onToggle={(event) => setOutlineOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:bg-slate-900">
      <summary className="min-h-11 cursor-pointer px-2 py-3 text-sm font-semibold">{t('admin.section_index')}</summary>
      <nav aria-label={t('editor.outline')} className="space-y-1">
        <button type="button" className={`min-h-11 w-full rounded px-2 text-left text-sm ${activeKey === '' ? 'bg-teal-100 font-semibold text-teal-900' : 'hover:bg-slate-100'}`}
          aria-current={activeKey === '' ? 'page' : undefined} onClick={() => onSelect('')}>
          {t('editor.all_variables')} <span className="text-xs">({allFields.length})</span>
        </button>
        {groups.filter((group) => !group.parentKey).map((root) => {
          const descendants = groups.filter((group) => group.parentKey === root.key);
          const expanded = !collapsed.has(root.key);
          return <div key={root.key}>
            <div className="flex items-center">
              {descendants.length > 0 && <button type="button" className="icon-button shrink-0" aria-label={`${t('editor.toggle_block')} · ${root.label}`}
                aria-expanded={expanded} onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(root.key)) next.delete(root.key); else next.add(root.key); return next; })}>
                {expanded ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
              </button>}
              {/* Le compteur est colle au libelle dans le texte : sans nom accessible explicite,
                  la commande s'annonce « Bloc 0126 ». */}
              <button type="button" aria-current={activeKey === root.key ? 'page' : undefined}
                aria-label={`${root.label} · ${t('admin.variable_count').replace('{n}', String(root.fields.length + descendants.reduce((n, child) => n + child.fields.length, 0)))}`}
                className={`flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 text-left text-sm ${activeKey === root.key ? 'bg-teal-100 font-semibold text-teal-900' : 'hover:bg-slate-100'}`}
                onClick={() => onSelect(root.key)}>
                <span className="break-words">{root.label}</span><span className="text-xs text-slate-500">{root.fields.length + descendants.reduce((n, child) => n + child.fields.length, 0)}</span>
              </button>
            </div>
            {expanded && descendants.map((child) => <button key={child.key} type="button" aria-current={activeKey === child.key ? 'page' : undefined}
              aria-label={`${child.label} · ${t('admin.variable_count').replace('{n}', String(child.fields.length))}`}
              className={`flex min-h-11 w-full items-center justify-between gap-2 rounded py-2 pl-9 pr-2 text-left text-sm ${activeKey === child.key ? 'bg-teal-100 font-semibold text-teal-900' : 'hover:bg-slate-100'}`}
              onClick={() => onSelect(child.key)}><span className="break-words">{child.label}</span><span className="text-xs text-slate-500">{child.fields.length}</span></button>)}
          </div>;
        })}
      </nav>
    </details>
    <div className="min-w-0">
      <div className="mb-4 border-b border-slate-200 pb-4">
        {active && <p className="mb-1 text-xs text-slate-500">{pathOf(active)}</p>}
        <h3 id="editor-structure-heading" tabIndex={-1} className="text-lg font-semibold">{active?.label ?? t(activeKey ? 'editor.selection_unavailable' : 'editor.all_variables')}</h3>
        <p className="mt-1 text-sm text-slate-500">{t('admin.variable_count').replace('{n}', String(displayedFields.length))}</p>
        {/* Maquette : la condition du bloc et l'acces a ses regles tiennent sur une meme ligne,
            la condition a gauche et le renvoi a droite. Une rubrique commune n'a pas de
            condition : elle le dit au lieu de laisser la ligne vide. */}
        {active && <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="min-w-0 space-y-1">
            {active.common ? <p className="text-sm text-slate-500">{t('editor.common_hint')}</p> : context}
          </div>
          <button type="button" className="shrink-0 text-sm font-medium text-teal-700 underline underline-offset-2" onClick={() => onRules()}>{t('editor.section_rules')}</button>
        </div>}
        {children.length > 0 && <div className="mt-4 flex flex-wrap gap-2" aria-label={t('editor.subsections')}>
          {children.map((child) => <button key={child.key} type="button" className="btn-secondary" onClick={() => onSelect(child.key)}>{child.label} <span className="text-xs">({child.fields.length})</span></button>)}
        </div>}
      </div>
      {management}
      <div role="table" aria-label={t('admin.variables')} className="divide-y divide-slate-200 border-y border-slate-200">
        <div role="row" className="grid grid-cols-[minmax(0,1fr)_4rem_2.5rem_auto] items-center gap-2 py-2 text-xs text-slate-500 sm:grid-cols-[minmax(0,1fr)_6rem_5rem_auto]">
          <span role="columnheader">{t('admin.label')}</span><span role="columnheader">{t('admin.type')}</span><span role="columnheader">{t('admin.rules')}</span>
          <span role="columnheader" className={editable ? undefined : 'sr-only'}>{t('common.actions')}</span>
        </div>
        <div role="rowgroup" className="divide-y divide-slate-100">
          {visibleFields.map((field) => {
            const group = groupOf(field);
            const index = rankByFieldId.get(field.id) ?? -1;
            return <div key={field.id} id={`template-field-${field.id}`} role="row"
              draggable={editable && canReorder && !busy} onDragStart={() => setDragId(field.id)}
              onDragOver={editable && canReorder && !busy ? (event) => event.preventDefault() : undefined}
              onDrop={() => { if (dragId && editable && canReorder && !busy) onDrop(dragId, field.id); setDragId(null); }}
              className="py-2">
              {/* A largeur etroite, les colonnes fixes se resserrent et les actions passent sur
                  deux rangs plutot que de pousser la ligne hors de l'ecran. */}
              <div className="grid grid-cols-[minmax(0,1fr)_4rem_2.5rem_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_5rem_auto]">
                <div role="cell" className="min-w-0">
                  <button type="button" className="min-h-11 w-full break-words text-left text-sm font-medium text-slate-900 hover:text-teal-700 dark:text-slate-100"
                    aria-label={`${t(editable ? 'admin.edit_variable' : 'editor.view_variable')} · ${field.label}`} onClick={() => onOpen(field)}>{field.label}</button>
                  {!activeKey && group && <p className="text-xs text-slate-500">{pathOf(group)}</p>}
                </div>
                <span role="cell" className="break-words text-xs text-slate-500">{fieldTypeLabel(t, field.type)}</span>
                <div role="cell"><button type="button" className="min-h-11 px-2 text-sm text-teal-700" aria-label={`${t('admin.rules')} · ${field.label}`} onClick={() => onRules(field)}>{ruleCount(field)}</button></div>
                {/* Les actions restent DANS l'arbre d'accessibilite : repliees derriere un
                    <details> par ligne, monter/descendre/deplacer/supprimer deviennent
                    invisibles au clavier et aux technologies d'assistance. */}
                <div role="cell" className="flex max-w-[5.5rem] flex-wrap items-center gap-0.5 sm:max-w-none sm:flex-nowrap sm:gap-1">
                  {editable && <>
                    <button type="button" className="icon-button" disabled={busy || !canReorder || index === 0} aria-label={`${t('admin.move_up')} · ${field.label}`} onClick={() => onStep(field.id, -1)}><ArrowUp size={16} aria-hidden /></button>
                    <button type="button" className="icon-button" disabled={busy || !canReorder || index === allFields.length - 1} aria-label={`${t('admin.move_down')} · ${field.label}`} onClick={() => onStep(field.id, 1)}><ArrowDown size={16} aria-hidden /></button>
                    <button type="button" className="icon-button" disabled={busy || !canReorder} onClick={() => onMove(field)} aria-label={`${t('admin.move_variable')} · ${field.label}`}><MoveVertical size={16} aria-hidden /></button>
                    <button type="button" className="icon-button text-red-600" disabled={busy || field.inUse} aria-label={`${t('admin.delete')} · ${field.label}`} title={field.inUse ? t('admin.field_locked_hint') : t('admin.delete')} onClick={() => onDelete(field)}><Trash2 size={16} aria-hidden /></button>
                  </>}
                </div>
              </div>
            </div>;
          })}
        </div>
      </div>
      {displayedFields.length > visibleFields.length && (
        <div className="flex flex-wrap items-center gap-3 py-3">
          <button type="button" className="btn-secondary"
            onClick={() => setWindow({ key: listKey, count: shown + PAGE_SIZE })}>
            {t('editor.show_more')}
          </button>
          <p className="text-xs text-slate-500" aria-live="polite">
            {t('editor.shown_limited')
              .replace('{shown}', String(visibleFields.length))
              .replace('{total}', String(displayedFields.length))}
          </p>
        </div>
      )}
      {displayedFields.length === 0 && <p className="py-6 text-sm text-slate-500">{t('admin.no_matching_variables')}</p>}
    </div>
  </div>;
}
