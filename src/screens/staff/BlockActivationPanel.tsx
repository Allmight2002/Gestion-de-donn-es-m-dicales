// L60 — reconnexion de la regle d'activation, dans l'espace Regles.
//
// Ce panneau ne decide rien de plus que `domain/blockActivation` : il rend la proposition
// ou LA condition qui manque. Deux choix de forme, tous deux imposes par le §6.
//
//   * L'ecriture passe par `onCreate`, que l'editeur branche sur `repo.addRule` — le meme
//     chemin que le constructeur de regles. Aucune RPC nouvelle, aucune garde contournee.
//   * Un refus n'efface rien et ne masque rien : l'avertissement de L59 reste au-dessus, le
//     bloc reste visible sans condition, et le constructeur reste ouvert en dessous.

import { useMemo } from 'react';
import { useI18n } from '../../i18n/useI18n';
import {
  ACTIVATION_BLOCKER_MESSAGE_KEY,
  activationProposal,
  type ImportedBlockActivation,
} from '../../domain/blockActivation';
import type { VisibilityRule } from '../../domain/templateRules';
import type { DiagnosisContext, TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { RuleSummary } from './RuleForm';

export function BlockActivationPanel({
  activation,
  fields,
  sections,
  rules,
  diagnosis,
  busy,
  onCreate,
}: {
  activation: ImportedBlockActivation;
  fields: TemplateField[];
  sections: readonly TemplateSection[];
  rules: readonly ValidationRule[];
  /** Contexte diagnostique L55 de la version CIBLE ; absent = aucune configuration. */
  diagnosis?: readonly DiagnosisContext[] | null;
  busy: boolean;
  onCreate: (rule: VisibilityRule) => void;
}) {
  const { t } = useI18n();
  const proposal = useMemo(
    () => activationProposal({ ...activation, fields, sections, rules, diagnosis }),
    [activation, fields, sections, rules, diagnosis],
  );

  // Rien a reconnecter : pas de condition dans la source, ou bloc deja conditionne.
  if (!proposal) return null;

  // Le pilote est nomme par sa CLE : c'est ce que le rapport d'import porte, et le libelle
  // de la cible peut differer de celui de la source alors que la cle, elle, est la meme.
  const driverKey = activation.activation?.field ?? '';
  const driverLabel = fields.find((field) => field.fieldKey === driverKey)?.label ?? driverKey;

  if (!proposal.ok) {
    const { code, detail } = proposal.blocker;
    return (
      <section className="mb-3 space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm">
        <h4 className="font-semibold text-slate-800">{t('blockactivation.title')}</h4>
        <p className="text-slate-700">
          {t('blockactivation.blocked_intro').replace('{field}', driverLabel)}
        </p>
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-800">
          {t(ACTIVATION_BLOCKER_MESSAGE_KEY[code]).replace('{detail}', detail ?? '')}
        </p>
        <p className="text-slate-600">{t('blockactivation.fallback')}</p>
      </section>
    );
  }

  return (
    <section className="mb-3 space-y-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
      <h4 className="font-semibold text-slate-800">{t('blockactivation.title')}</h4>
      <p className="text-slate-700">{t('blockactivation.ready').replace('{field}', driverLabel)}</p>
      {/* La regle est montree en clair AVANT d'etre ecrite : « en un geste » ne veut pas
          dire a l'aveugle. C'est le meme rendu que dans la liste des regles. */}
      <div className="rounded-lg border border-teal-200 bg-white p-2">
        <RuleSummary rule={proposal.rule} fields={fields} sections={sections} />
      </div>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => onCreate(proposal.rule)}>
        {busy ? t('blockactivation.creating') : t('blockactivation.create')}
      </button>
    </section>
  );
}
