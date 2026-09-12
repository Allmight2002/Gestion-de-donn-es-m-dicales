import { useState } from 'react';
import type { DiagnosisConfiguration, FieldScope, TemplateField, TemplateSection, TemplateVersion, ValidationRule } from '../../data/types';
import type { TemplateRepository } from '../../data/templates';
import { findProposalField } from '../../domain/proposalField';
import { visibilityRuleOf } from '../../domain/templateRules';
import { useI18n } from '../../i18n/useI18n';

/** Le responsable associe des codes ; la seule écriture d'association reste une règle L52. */
export function DiagnosisConfigurationEditor({ version, fields, rules, sections, repo, busy, run }: {
  version: TemplateVersion; fields: TemplateField[]; rules: ValidationRule[]; sections: TemplateSection[];
  repo: TemplateRepository; busy: boolean; run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [scope, setScope] = useState<FieldScope>('patient');
  const saved = version.diagnosisConfiguration?.find((c) => c.scope === scope);
  const [draft, setDraft] = useState<DiagnosisConfiguration | null>(null);
  const config = draft ?? saved ?? {scope,diagnosisFieldKey:'',terminologyReleaseId:null,commonOnlyCodes:[]};
  const [common, setCommon] = useState<string | null>(null);
  const [block, setBlock] = useState('');
  const [codes, setCodes] = useState('');
  const editable = version.status === 'draft' && !fields.some((f) => f.inUse);
  // UX-16 : UNE seule definition de l'eligibilite. La liste proposee et l'explication d'un
  // refus lisent la meme fonction, sinon l'ecran expliquerait autre chose que ce qu'il offre.
  // Le PLACEMENT n'y entre pas : une variable reste eligible quelle que soit sa rubrique.
  // Le motif le plus explicatif d'abord : une variable calculee est TOUJOURS numerique
  // (le serveur impose le type de sortie), donc l'annoncer « type incompatible » dirait vrai
  // sans rien apprendre. Ce qui bloque, c'est qu'elle n'est pas saisie.
  const refusal = (f: TemplateField) =>
    f.formula ? 'diagnosis.ineligible_reason_formula' as const
    : !['select','multiselect','terminology'].includes(f.type) ? 'diagnosis.ineligible_reason_type' as const
    : rules.some((r) => {
      const parsed = visibilityRuleOf(r.rule);
      return parsed !== null && 'field' in parsed.then && parsed.then.field === f.fieldKey;
    }) ? 'diagnosis.ineligible_reason_hidden' as const
    : null;
  const commonOfScope = fields.filter((f) => f.scope === scope && !f.section);
  const candidates = commonOfScope.filter((f) => refusal(f) === null);
  const refused = commonOfScope.filter((f) => refusal(f) !== null);
  // Une variable compatible rangee dans un bloc n'apparait pas dans la liste : le dire evite
  // de la chercher, et dit quoi faire pour la rendre eligible.
  const compatibleInBlocks = fields.filter((f) => f.scope === scope && f.section && refusal(f) === null).length;
  const selected = candidates.find((f) => f.fieldKey === config.diagnosisFieldKey);
  const companion = selected ? findProposalField(fields, selected) : undefined;
  const split = (text: string) => text.split('\n').map((v) => v.trim()).filter(Boolean);
  // Une règle déjà posée sur ce bloc n'est réécrite que si elle est DEJA l'association
  // canonique du pilote. Un bloc générique du responsable reste indépendant (§3.1) et le
  // serveur refuserait de toute façon un bloc portant deux conditions.
  const associationOf = (sectionKey: string) => {
    const found = sectionKey ? rules.filter((r) => {
      const parsed = visibilityRuleOf(r.rule);
      return parsed !== null && 'section' in parsed.then && parsed.then.section === sectionKey;
    }) : [];
    const parsed = found.length === 1 ? visibilityRuleOf(found[0].rule) : null;
    const own = parsed !== null && parsed.if.field === saved?.diagnosisFieldKey
      && parsed.if.operator === 'contains_any';
    return {
      rule: own ? found[0] : undefined,
      foreign: found.length > 0 && !own,
      codes: own && Array.isArray(parsed.if.value) ? parsed.if.value.join('\n') : '',
    };
  };
  const association = associationOf(block);
  return <div className="card space-y-3 p-4">
    <h3 className="font-semibold">{t('diagnosis.config_title')}</h3>
    <p className="text-sm text-slate-600">{t('diagnosis.config_help')}</p>
    <label className="block">{t('diagnosis.scope')}
      <select className="input" value={scope} onChange={(e) => {setScope(e.target.value as FieldScope); setDraft(null); setCommon(null); setBlock(''); setCodes('');}}>
        <option value="patient">{t('scope.patient')}</option><option value="encounter">{t('scope.encounter')}</option>
      </select>
    </label>
    <fieldset disabled={busy || !editable} className="space-y-3">
      <label className="block">{t('diagnosis.driver')}
        <select className="input" value={config.diagnosisFieldKey} onChange={(e) => {
          setDraft({...config,diagnosisFieldKey:e.target.value,terminologyReleaseId:null,commonOnlyCodes:[]}); setCommon('');
        }}><option value="">{t('diagnosis.disabled')}</option>
          {candidates.map((f) => <option key={f.id} value={f.fieldKey}>{f.label} ({f.fieldKey})</option>)}
        </select>
      </label>
      <p className="text-sm text-slate-600">{t('diagnosis.driver_help')}</p>
      {refused.length > 0 && <details className="text-sm text-slate-600">
        <summary className="min-h-11 cursor-pointer">{t('diagnosis.ineligible').replace('{n}', String(refused.length))}</summary>
        <ul className="mt-1 space-y-1">
          {refused.map((f) => <li key={f.id}>
            {f.label} <span className="font-mono text-xs">{f.fieldKey}</span> — {t(refusal(f)!)}
          </li>)}
        </ul>
      </details>}
      {compatibleInBlocks > 0 && <p className="text-sm text-slate-600">
        {t('diagnosis.ineligible_blocks').replace('{n}', String(compatibleInBlocks))}
      </p>}
      {selected?.type === 'terminology' && <label className="block">{t('diagnosis.release')}
        <input className="input" value={config.terminologyReleaseId ?? ''} onChange={(e) => setDraft({...config,terminologyReleaseId:e.target.value})} />
      </label>}
      {selected && <>
        <p className="text-sm">{companion ? `${t('diagnosis.proposal')}: ${companion.label} (${companion.fieldKey})` : t('diagnosis.proposal_missing')}</p>
        <label className="block">{t('diagnosis.common_codes')}
          <textarea className="input" rows={3} value={common ?? config.commonOnlyCodes.join('\n')} onChange={(e) => setCommon(e.target.value)} />
        </label>
      </>}
      <button type="button" className="btn-primary" disabled={!repo.setDiagnosisConfiguration || (!!selected && !companion)} onClick={() => {
        const others = (version.diagnosisConfiguration ?? []).filter((c) => c.scope !== scope);
        const next = config.diagnosisFieldKey ? [...others,{...config,commonOnlyCodes:split(common ?? config.commonOnlyCodes.join('\n'))}] : others;
        void run(() => repo.setDiagnosisConfiguration!(version.id,next)).then((ok) => {if (ok) {setDraft(null); setCommon(null);}});
      }}>{t('diagnosis.save')}</button>
      {saved && <div className="space-y-3 border-t pt-3">
        <h4 className="font-medium">{t('diagnosis.associations')}</h4>
        <label className="block">{t('diagnosis.block')}
          <select className="input" value={block} onChange={(e) => {
            setBlock(e.target.value);
            setCodes(associationOf(e.target.value).codes);
          }}><option value="">—</option>{sections.filter((s) => !s.parentSectionKey).map((s) => <option key={s.id} value={s.sectionKey}>{s.label}</option>)}</select>
        </label>
        <label className="block">{t('diagnosis.block_codes')}<textarea className="input" value={codes} onChange={(e) => setCodes(e.target.value)} /></label>
        {association.foreign && <p className="text-sm text-amber-700">{t('diagnosis.block_taken')}</p>}
        <button type="button" className="btn-primary" disabled={!block || association.foreign || !split(codes).length} onClick={() => {
          const rule = {if:{field:saved.diagnosisFieldKey,operator:'contains_any',value:split(codes),
            ...(saved.terminologyReleaseId ? {terminologyReleaseId:saved.terminologyReleaseId} : {})},then:{section:block,operator:'visible'}};
          void run(() => association.rule ? repo.updateRule(association.rule.id,rule,association.rule.message ?? '',association.rule.severity)
            : repo.addRule(version.id,rule,'','block'));
        }}>{t('diagnosis.save_association')}</button>
      </div>}
    </fieldset>
  </div>;
}
