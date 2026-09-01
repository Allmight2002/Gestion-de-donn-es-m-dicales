// L31 — gestion des sections d'une version de gabarit.
//
// Une section est le regroupement visuel du formulaire : « identification », « imagerie »,
// « evolution ». Elle appartient a la VERSION, donc elle est gelee des que la version est
// publiee, exactement comme une variable — l'ecran n'est simplement pas rendu dans ce cas.
//
// Le CODE INTERNE ne se modifie jamais (lecon de L30) : il est propose a la creation, puis
// affiche en lecture seule. Seul le libelle se corrige.

import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
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
}: {
  sections: TemplateSection[];
  /** Sert a dire, avant tout clic, combien de variables une section porte. */
  fields: TemplateField[];
  busy?: boolean;
  onAdd: (sectionKey: string, label: string) => void;
  onRename: (sectionId: string, label: string) => void;
  onDelete: (sectionId: string) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const { t } = useI18n();
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');

  const countIn = (sectionKey: string) => fields.filter((f) => f.section === sectionKey).length;

  function move(sectionId: string, delta: -1 | 1) {
    const ordered = [...sections];
    const from = ordered.findIndex((s) => s.id === sectionId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    onReorder(ordered.map((s) => s.id));
  }

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-slate-700">{t('admin.sections')}</h3>

      <ul className="space-y-2 text-sm">
        {sections.map((section, index) => {
          const used = countIn(section.sectionKey);
          return (
            <li key={section.id} className="card flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="flex flex-col">
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
                  disabled={busy || index === sections.length - 1}
                  aria-label={t('admin.move_down')}
                  className="min-h-6 px-1 text-slate-400 disabled:opacity-30 hover:text-slate-700"
                >
                  <ArrowDown size={14} aria-hidden />
                </button>
              </span>

              {editingId === section.id ? (
                <>
                  <input
                    className="input min-w-0 flex-1"
                    value={draftLabel}
                    onChange={(e) => setDraftLabel(e.target.value)}
                    aria-label={t('admin.section_label')}
                  />
                  <button
                    type="button"
                    className="btn-primary min-h-11 px-3 text-xs"
                    disabled={busy || draftLabel.trim() === ''}
                    onClick={() => {
                      onRename(section.id, draftLabel.trim());
                      setEditingId(null);
                    }}
                  >
                    {t('admin.save')}
                  </button>
                  <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => setEditingId(null)}>
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-[10rem] flex-1 break-words font-medium text-slate-900 sm:min-w-0">
                    {sectionLabel(t, section)}
                  </span>
                  {/* Le code interne est montre, jamais modifiable : c'est lui que portent
                      les fiches deja saisies et les instantanes hors-ligne. */}
                  <span className="min-w-0 max-w-full break-all font-mono text-xs text-slate-400 sm:max-w-none sm:break-normal">{section.sectionKey}</span>
                  <span className="text-xs text-slate-500">
                    {t('admin.section_field_count').replace('{n}', String(used))}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost min-h-11 px-3 text-xs"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(section.id);
                      setDraftLabel(section.label);
                    }}
                  >
                    {t('admin.rename')}
                  </button>
                  {used > 0 ? (
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
                </>
              )}
            </li>
          );
        })}
      </ul>

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const label = newLabel.trim();
          if (label === '') return;
          onAdd(makeSectionKey(label, sections.map((s) => s.sectionKey)), label);
          setNewLabel('');
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
        <button type="submit" className="btn-secondary" disabled={busy || newLabel.trim() === ''}>
          {t('admin.section_add')}
        </button>
      </form>
    </div>
  );
}
