import { useState } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { ValueInput } from './ValueInput';
import type { TemplateField } from '../../data/types';
import { Checkbox } from '../../components/Checkbox';

// F5 — rendu couple d'un champ a liste controlee et de son champ compagnon « valeur proposee ».
//
// Choisir « Autre » n'ecrit RIEN dans le champ a liste : la colonne analysable ne contient que
// des valeurs de la liste. Le texte saisi va dans le champ compagnon, et la fiche part dans la
// file de completion existante tant que le champ source reste vide.
export function ChoiceWithProposal({
  field,
  proposal,
  value,
  proposalValue,
  onChange,
  onRemove,
}: {
  field: TemplateField;
  proposal: TemplateField;
  value: unknown;
  proposalValue: unknown;
  onChange: (key: string, v: unknown) => void;
  /** Retire une cle de la saisie : aucune valeur n'est envoyee pour un champ controle vide. */
  onRemove: (key: string) => void;
}) {
  const { t } = useI18n();
  const isTerminology = field.type === 'terminology';
  const hasProposal = typeof proposalValue === 'string' && proposalValue.trim() !== '';
  // Revele des qu'une proposition existe (relecture) ou que l'utilisateur vient de la demander.
  const [asked, setAsked] = useState(false);
  const open = asked || hasProposal;

  function toggleProposal(next: boolean) {
    setAsked(next);
    if (next) {
      // La valeur hors liste ne doit jamais occuper le champ source, pas meme a null :
      // il est retire du payload avant l'appel serveur.
      onRemove(field.fieldKey);
    } else {
      onRemove(proposal.fieldKey);
    }
  }

  function changeSource(next: unknown) {
    const selected = Array.isArray(next) ? next.length > 0 : next !== null && next !== undefined && next !== '';
    if (selected) {
      onChange(field.fieldKey, next);
      // Les deux valeurs sont mutuellement exclusives : une ancienne proposition ne doit
      // pas subsister silencieusement apres le choix d'une valeur controlee.
      setAsked(false);
      onRemove(proposal.fieldKey);
    } else {
      onRemove(field.fieldKey);
    }
  }

  return (
    <div className="space-y-2">
      <ValueInput field={field} value={value} onChange={changeSource} />
      <Checkbox
        checked={open}
        onChange={(e) => toggleProposal(e.target.checked)}
        label={t(isTerminology ? 'field.terminology_proposal_option' : 'field.proposal_option')}
        containerClassName="px-1 text-xs"
      />
      {open && (
        <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950">
          <label className="flex flex-col text-xs text-amber-900 dark:text-amber-100">
            {t(isTerminology ? 'field.terminology_proposal_prompt' : 'field.proposal_prompt')}
            <input
              className="input mt-1"
              value={typeof proposalValue === 'string' ? proposalValue : ''}
              onChange={(e) => e.target.value ? onChange(proposal.fieldKey, e.target.value) : onRemove(proposal.fieldKey)}
            />
          </label>
          <p role="status" className="text-xs text-amber-800 dark:text-amber-200">
            {t(isTerminology ? 'field.terminology_proposal_warning' : 'field.proposal_warning')}
          </p>
        </div>
      )}
    </div>
  );
}
