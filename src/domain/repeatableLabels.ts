import type { MessageKey } from '../i18n/messages';
import type { TemplateSection } from '../data/types';

type Translate = (key: MessageKey) => string;

/**
 * Libelles d'un bloc repetable, a la saisie comme dans l'apercu.
 *
 * L'auteur du formulaire peut nommer le bouton d'ajout (phrase ENTIERE : « Ajouter une
 * lesion ») et un element (« Lesion »). Sans eux, les libelles generiques « occurrence »
 * restent. Les formules qui citent l'element sont neutres (« Nouvelle saisie : Lesion »,
 * « Enregistrer : Lesion ») : l'application ne devine jamais un article ni un accord.
 */
export function repeatableLabels(
  t: Translate,
  section: Pick<TemplateSection, 'label' | 'sectionKey' | 'addLabel' | 'itemLabel'>,
) {
  const group = section.label?.trim() || section.sectionKey;
  const item = section.itemLabel?.trim() || null;
  const fill = (key: MessageKey, values: Record<string, string | number>) =>
    Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), t(key));

  return {
    group,
    add: section.addLabel?.trim()
      || (item ? fill('form.repeatable_item_add', { item }) : t('form.repeatable_add')),
    /** Titre d'une ligne : « Lesion 2 » ou « Occurrence 2 ». `rank` commence a 1. */
    rank: (rank: number) => (item
      ? fill('form.repeatable_item_rank', { item, n: rank })
      : fill('form.repeatable_occurrence', { n: rank })),
    newTitle: item
      ? fill('form.repeatable_item_new_title', { item, group })
      : fill('form.repeatable_new_title', { group }),
    editTitle: (rank: number) => (item
      ? fill('form.repeatable_item_edit_title', { item, n: rank, group })
      : fill('form.repeatable_edit_title', { n: rank, group })),
    editAction: (rank: number) => (item
      ? fill('form.repeatable_item_edit', { item, n: rank, group })
      : fill('form.repeatable_edit_occurrence', { n: rank, group })),
    deleteAction: (rank: number) => (item
      ? fill('form.repeatable_item_delete', { item, n: rank, group })
      : fill('form.repeatable_delete_occurrence', { n: rank, group })),
    save: item ? fill('form.repeatable_item_save', { item }) : t('form.repeatable_save'),
  };
}

export type RepeatableLabels = ReturnType<typeof repeatableLabels>;
