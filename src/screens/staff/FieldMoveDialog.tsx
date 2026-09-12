import { useMemo, useState } from 'react';
import type { TemplateField, TemplateSection } from '../../data/types';
import { sectionLabel } from '../../domain/templateSections';
import { fieldTypeLabel } from '../../domain/templateLabels';
import { useI18n } from '../../i18n/useI18n';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FieldSelect } from './FieldSelect';

/** Ce que l'ecran demande au serveur : une section d'arrivee et un rang dans la liste. */
export interface FieldMove {
  /** Section d'arrivee ; `null` = variable commune, sans bloc clinique. */
  section: string | null;
  /** Ordre COMPLET des variables de la version, dans leur nouvel ordre d'enregistrement. */
  orderedIds: string[];
}

type Placement = 'before' | 'after' | 'start' | 'end';

/**
 * Calcule l'ordre complet d'arrivee. Il est exporte pour etre teste sans rendu : c'est lui
 * qui decide ce qui part au serveur, et une erreur ici deplacerait la mauvaise variable.
 *
 * Le rang enregistre est GLOBAL a la version, alors que le formulaire, lui, regroupe par
 * section au rendu. Placer « apres X » revient donc a se placer immediatement apres X dans la
 * liste globale : les deux variables etant dans la meme section d'arrivee, l'ordre rendu suit.
 */
export function computeMovedOrder(
  fields: readonly TemplateField[],
  moved: TemplateField,
  destination: string | null,
  placement: Placement,
  targetKey: string,
): string[] {
  const others = fields.filter((field) => field.id !== moved.id);
  const inDestination = others.filter((field) => (field.section ?? null) === destination);
  if (placement === 'start' || placement === 'end' || targetKey === '') {
    const anchor = placement === 'start' ? inDestination[0] : inDestination[inDestination.length - 1];
    // Section d'arrivee vide : la variable prend simplement la fin de la liste globale.
    if (!anchor) return [...others.map((field) => field.id), moved.id];
    const at = others.findIndex((field) => field.id === anchor.id);
    const index = placement === 'start' ? at : at + 1;
    return [...others.slice(0, index).map((f) => f.id), moved.id, ...others.slice(index).map((f) => f.id)];
  }
  const at = others.findIndex((field) => field.fieldKey === targetKey);
  if (at < 0) return fields.map((field) => field.id);
  const index = placement === 'before' ? at : at + 1;
  return [...others.slice(0, index).map((f) => f.id), moved.id, ...others.slice(index).map((f) => f.id)];
}

/**
 * UX-14(d) — deplacement DIRECT d'une variable.
 *
 * Sur 216 lignes, un glisser-deposer traverse plusieurs ecrans et une paire de fleches demande
 * autant de clics que de rangs franchis. La destination se choisit donc explicitement, avec des
 * controles natifs — donc utilisables au clavier et au doigt sans geste de precision — et la
 * phrase de destination dit ce qui va se passer avant de le faire.
 *
 * Ce panneau ne touche ni la cle, ni le type, ni les regles, ni la provenance : il ne remet au
 * serveur qu'une section d'arrivee et un ordre. Le rattachement VISUEL d'une variable commune a
 * une rubrique reste, lui, l'affaire de l'organisation UX-16, qui a son propre contrat.
 */
export function FieldMoveDialog({ field, fields, sections, busy, onCancel, onMove }: {
  field: TemplateField;
  fields: readonly TemplateField[];
  sections: readonly TemplateSection[];
  busy?: boolean;
  onCancel: () => void;
  onMove: (move: FieldMove) => void;
}) {
  const { t } = useI18n();
  const [destination, setDestination] = useState<string>(field.section ?? '');
  const [placement, setPlacement] = useState<Placement>('after');
  const [targetKey, setTargetKey] = useState('');

  const destinationSection = destination === '' ? null : destination;
  // Cibles possibles : les variables DEJA dans la section d'arrivee, la variable deplacee
  // exclue — se placer avant soi-meme ne veut rien dire.
  const targets = useMemo(
    () => fields.filter((candidate) => candidate.id !== field.id
      && (candidate.section ?? null) === destinationSection),
    [fields, field.id, destinationSection],
  );
  const target = targets.find((candidate) => candidate.fieldKey === targetKey);
  const relative = placement === 'before' || placement === 'after';
  const sectionName = sectionLabel(t, {
    sectionKey: destinationSection,
    label: sections.find((section) => section.sectionKey === destinationSection)?.label,
  });

  // La phrase de destination est le coeur du panneau : elle dit, avant de confirmer, ou la
  // variable va atterrir. Sans elle, « avant/apres » sur une liste filtree est une devinette.
  const summary = relative && target
    ? t(placement === 'before' ? 'admin.move_summary_before' : 'admin.move_summary_after')
      .replace('{field}', field.label).replace('{target}', target.label).replace('{section}', sectionName)
    : relative
      ? t('admin.move_summary_pending')
      : t(placement === 'start' ? 'admin.move_summary_start' : 'admin.move_summary_end')
        .replace('{field}', field.label).replace('{section}', sectionName);

  const ready = !relative || !!target;

  return (
    <ConfirmDialog
      open
      title={t('admin.move_title').replace('{field}', field.label)}
      body={t('admin.move_help')}
      confirmLabel={t('admin.move_confirm')}
      confirmDisabled={!ready}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => onMove({
        section: destinationSection,
        orderedIds: computeMovedOrder(fields, field, destinationSection, placement, targetKey),
      })}
    >
      <div className="space-y-3">
        <label className="flex flex-col text-xs text-slate-600">
          {t('admin.move_destination')}
          <select
            className="input mt-1"
            value={destination}
            onChange={(event) => { setDestination(event.target.value); setTargetKey(''); }}
          >
            <option value="">{t('section.common')}</option>
            {sections.map((section) => (
              <option key={section.id} value={section.sectionKey}>{sectionLabel(t, section)}</option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-1">
          <legend className="text-xs text-slate-600">{t('admin.move_position')}</legend>
          {(['start', 'before', 'after', 'end'] as const).map((option) => (
            <label key={option} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                name="field-move-placement"
                className="h-4 w-4 accent-teal-700"
                checked={placement === option}
                onChange={() => setPlacement(option)}
              />
              {t(`admin.move_placement_${option}` as 'admin.move_placement_start')}
            </label>
          ))}
        </fieldset>

        {relative && (
          <FieldSelect
            label={t('admin.move_target')}
            value={targetKey}
            options={targets}
            optionLabel={(candidate) => `${candidate.label} · ${fieldTypeLabel(t, candidate.type)}`}
            onChange={setTargetKey}
            searchLabel={t('rule.search_variable')}
            chooseLabel={t('rule.choose')}
            emptyLabel={t('rule.search_no_match')}
            countLabel={(shown, total) => t('rule.search_count')
              .replace('{shown}', String(shown)).replace('{total}', String(total))}
          />
        )}

        <p role="status" className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{summary}</p>
      </div>
    </ConfirmDialog>
  );
}
