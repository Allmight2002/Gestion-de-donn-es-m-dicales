import { useMemo, useState, type ReactNode } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { TerminologyRepository } from '../../data/terminology';
import type { TemplateField, TemplateSection, TemplateVersion, ValidationRule } from '../../data/types';
import { evaluateRules, hiddenFieldKeys, validateValues, withoutHiddenValues } from '../../domain/validation';
import { findProposalField, isProposalSource, proposalKeysOf } from '../../domain/proposalField';
import { EncounterFields, SectionedFields, fieldAppliesToType } from '../member/EncounterFields';
import { FieldInput } from '../member/FieldInput';
import { ChoiceWithProposal } from '../member/ChoiceWithProposal';
import { FORMULA_TIME_UNITS, formulaUsesTemporalOperands, normalizeFormulaTimeUnit } from '../../domain/fieldFormula';

// L29 — apercu du formulaire tel que le verra la personne qui saisit, sans creer de
// patient d'essai.
//
// Regle premiere : REUTILISER les composants de saisie reels (EncounterFields, ValueInput,
// FieldInput, ChoiceWithProposal, TerminologyInput). Un apercu qui reimplemente le rendu
// finit par diverger du formulaire reel, et un apercu qui diverge est pire qu'aucun apercu.
//
// Regle seconde : RIEN NE S'ECRIT. Ni fiche, ni rencontre, ni brouillon local, ni entree
// d'outbox. L'apercu n'appelle aucun depot en ecriture ; la seule surface a effet de bord
// des composants de saisie est neutralisee par INERT_TERMINOLOGY ci-dessous.

// Repliques des listes du formulaire reel (EncounterForm.tsx). Ces deux listes sont deja
// dupliquees dans EncounterForm, CurationTask et FieldForm : l'apercu suit la convention
// existante plutot que d'introduire une dependance vers un ecran que d'autres lots modifient.
const ENCOUNTER_TYPES = ['consultation', 'hospitalisation', 'suivi', 'autre'] as const;
const STATUSES = ['draft', 'complete', 'curated'] as const;

/** Largeur de reference d'un telephone courant, en pixels CSS. */
const MOBILE_WIDTH = 390;

type PreviewTab = 'patient' | 'encounter';
type PreviewViewport = 'desktop' | 'mobile';

/**
 * Depot de terminologie INERTE, injecte au sous-arbre de l'apercu.
 *
 * `TerminologyInput` est le seul composant de saisie qui porte un effet de bord : il
 * telecharge le referentiel dans IndexedDB des que la copie locale est perimee et que le
 * navigateur est en ligne. On ne modifie pas le composant — on lui presente un depot qui ne
 * repond rien, par le meme `RepositoryProvider` que le reste de l'application. La garantie
 * est donc STRUCTURELLE : le champ diagnostic garde sa place et son encombrement reels dans
 * le formulaire, mais aucune requete ni aucune ecriture ne peut partir de l'apercu.
 *
 * Deux details qui ne sont pas negociables :
 *  - les methodes RESOLVENT (liste vide) au lieu de rejeter : une promesse rejetee non
 *    rattrapee declencherait `unhandledrejection`, donc `reportClientError`, donc la RPC
 *    `record_client_error` — une ECRITURE serveur ;
 *  - `activeRelease` renvoie `null` : `cacheFreshness` repond alors 'absent' ou 'unknown',
 *    jamais 'stale', et le telechargement automatique ne part pas. Renvoyer une fausse
 *    publication ferait au contraire EFFACER la copie locale reelle, `downloadReference`
 *    appelant `clearCache` avant de la remplir.
 */
const INERT_TERMINOLOGY: TerminologyRepository = {
  search: async () => [],
  activeRelease: async () => null,
  listEntries: async () => ({ entries: [], total: 0 }),
};

const sortedScope = (fields: TemplateField[], scope: 'patient' | 'encounter') =>
  fields.filter((f) => f.scope === scope).sort((a, b) => a.displayOrder - b.displayOrder);

const previewUnit = (
  field: TemplateField,
  fields: readonly TemplateField[],
  t: (key: MessageKey) => string,
): string | null => {
  const temporalFormula = Boolean(field.formula && formulaUsesTemporalOperands(field.formula, fields));
  const unit = temporalFormula ? normalizeFormulaTimeUnit(field.unit) : field.unit;
  return temporalFormula && unit && (FORMULA_TIME_UNITS as readonly string[]).includes(unit)
    ? t(`form.unit_${unit}` as MessageKey)
    : unit;
};

export function FormPreview({
  version,
  fields,
  rules,
  sections,
  onClose,
}: {
  version: TemplateVersion;
  fields: TemplateField[];
  rules: ValidationRule[];
  /** Sections de la version (L31) : l'apercu doit montrer les regroupements REELS. */
  sections?: readonly TemplateSection[] | null;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const patientFields = useMemo(() => sortedScope(fields, 'patient'), [fields]);
  const encounterFields = useMemo(() => sortedScope(fields, 'encounter'), [fields]);

  const [tab, setTab] = useState<PreviewTab>(encounterFields.length > 0 ? 'encounter' : 'patient');
  const [viewport, setViewport] = useState<PreviewViewport>('desktop');
  const [encounterType, setEncounterType] = useState<string>('consultation');
  const [encounterDate, setEncounterDate] = useState('');
  const [status, setStatus] = useState<string>('draft');
  // Deux jeux de valeurs distincts : passer d'un onglet a l'autre ne melange pas les saisies.
  const [patientValues, setPatientValues] = useState<Record<string, unknown>>({});
  const [encounterValues, setEncounterValues] = useState<Record<string, unknown>>({});
  const [checked, setChecked] = useState<{ blocking: string[]; warnings: string[] } | null>(null);

  const labelOf = (key: string) => fields.find((f) => f.fieldKey === key)?.label ?? key;

  // Meme filtre que le formulaire reel : le type de rencontre pilote les variables affichees.
  const applicable = encounterFields.filter((f) => fieldAppliesToType(f, encounterType));

  // Les champs compagnons « valeur proposee » sont rendus AVEC leur source, jamais isolement.
  const patientCompanions = proposalKeysOf(patientFields);
  // L32 — l'apercu montre EXACTEMENT ce que la saisie montrera, regles d'affichage comprises :
  // c'est la seule facon de verifier une regle qu'on vient d'ecrire sans creer de fiche d'essai.
  const patientHidden = useMemo(() => hiddenFieldKeys(rules, patientValues), [rules, patientValues]);
  const encounterHidden = useMemo(() => hiddenFieldKeys(rules, encounterValues), [rules, encounterValues]);
  const patientVisible = patientFields.filter(
    (f) => !patientCompanions.has(f.fieldKey) && !patientHidden.has(f.fieldKey),
  );

  /**
   * Rejoue les controles du formulaire de rencontre — `validateValues` et `evaluateRules`,
   * les memes fonctions de domaine, avec la meme frontiere : la completude et les regles
   * bloquantes ne s'imposent qu'au statut `curated` (cf. EncounterForm). Fonctions pures :
   * aucun appel serveur, aucune ecriture.
   */
  function runChecks() {
    const applicableData = withoutHiddenValues(
      Object.fromEntries(
        Object.entries(encounterValues).filter(([k]) => applicable.some((f) => f.fieldKey === k)),
      ),
      encounterHidden,
    ).values;
    const requireComplete = status === 'curated';
    const fieldErrors = validateValues(applicable, applicableData, requireComplete, encounterHidden).map(
      (fe) => `${labelOf(fe.fieldKey)} : ${fe.message}`,
    );
    const ruleEval = evaluateRules(
      rules.map((r) => ({ rule: r.rule, message: r.message, severity: r.severity })),
      applicableData,
      encounterHidden,
    );
    const blocking = [...fieldErrors, ...(requireComplete ? ruleEval.blocking : [])];
    if (!encounterDate) blocking.unshift(t('encounter.date'));
    setChecked({ blocking, warnings: ruleEval.warnings });
  }

  const tabButton = (value: PreviewTab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => { setTab(value); setChecked(null); }}
      className={
        'min-h-11 rounded-lg px-3 text-sm font-medium transition '
        + (tab === value
          ? 'bg-teal-700 text-white'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')
      }
    >
      {label} <span className="text-xs opacity-70">({count})</span>
    </button>
  );

  const viewportButton = (value: PreviewViewport, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={viewport === value}
      onClick={() => setViewport(value)}
      className={
        'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition '
        + (viewport === value
          ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')
      }
    >
      {icon} {label}
    </button>
  );

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onClose} className="btn-ghost min-h-11 px-2">
            ← {t('preview.back')}
          </button>
          <h2 className="text-xl font-semibold tracking-tight">{t('preview.title')}</h2>
          <span className="badge">
            {t('admin.version')} {version.versionNumber}
          </span>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 p-1 dark:border-slate-700">
          {viewportButton('desktop', t('preview.desktop'), <Monitor size={16} aria-hidden />)}
          {viewportButton('mobile', t('preview.mobile'), <Smartphone size={16} aria-hidden />)}
        </div>
      </div>

      {/* Le message le plus important de l'ecran : ce qui est tape ici ne part nulle part. */}
      <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
        {t('preview.no_write')}
      </p>

      <div role="tablist" aria-label={t('preview.title')} className="flex flex-wrap gap-1">
        {tabButton('patient', t('preview.tab_patient'), patientFields.length)}
        {tabButton('encounter', t('preview.tab_encounter'), encounterFields.length)}
      </div>

      {/* Cadre de rendu. En vue mobile, la largeur est celle d'un telephone courant : les
          composants de saisie ne portent aucun point de rupture de fenetre, l'encombrement
          reel se decide donc a la largeur, et c'est bien elle qu'on reproduit ici. */}
      <div
        data-viewport={viewport}
        style={viewport === 'mobile' ? { width: MOBILE_WIDTH } : undefined}
        className={
          viewport === 'mobile'
            ? 'mx-auto max-w-full overflow-hidden rounded-[2rem] border-8 border-slate-800 bg-white p-4 shadow-xl dark:bg-slate-950'
            : 'max-w-2xl'
        }
      >
        {/* Depots inertes pour tout le sous-arbre de saisie : aucune ecriture possible. */}
        <RepositoryProvider terminology={INERT_TERMINOLOGY}>
          <div className="space-y-5">
            {tab === 'patient' ? (
              <>
                <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {t('preview.patient_header_note')}
                </p>
                {patientVisible.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('patient.no_permanent_fields')}</p>
                ) : (
                  // Rendu identique a NewPatient.tsx pour la portee `patient` : les donnees
                  // permanentes n'offrent pas les codes de valeur manquante, elles passent
                  // donc par FieldInput et non par ValueInput. Toute evolution du rendu de
                  // NewPatient doit etre reportee ici.
                  <SectionedFields
                    fields={patientVisible}
                    sections={sections}
                    renderField={(field) => {
                      const proposal = isProposalSource(field) ? findProposalField(patientFields, field) : undefined;
                      const renderedUnit = previewUnit(field, patientFields, t);
                      return (
                        <div className="flex flex-col text-sm">
                          <span className="text-slate-700 dark:text-slate-200">
                            {field.label}
                            {field.required && <span className="text-red-500"> *</span>}
                            {renderedUnit && <span className="text-slate-400"> ({renderedUnit})</span>}
                          </span>
                          <div className="mt-1">
                            {proposal ? (
                              <ChoiceWithProposal
                                field={field}
                                proposal={proposal}
                                value={patientValues[field.fieldKey]}
                                proposalValue={patientValues[proposal.fieldKey]}
                                onChange={(key, value) => setPatientValues((current) => ({ ...current, [key]: value }))}
                                onRemove={(key) => setPatientValues((current) => {
                                  const { [key]: _removed, ...remaining } = current;
                                  return remaining;
                                })}
                              />
                            ) : (
                              <FieldInput
                                field={field}
                                value={patientValues[field.fieldKey]}
                                onChange={(value) => setPatientValues((current) => ({ ...current, [field.fieldKey]: value }))}
                              />
                            )}
                          </div>
                        </div>
                      );
                    }}
                  />
                )}
              </>
            ) : (
              <>
                {/* Entete reelle du formulaire de rencontre : type, date, statut. Le type
                    pilote les variables affichees, le statut la severite des controles. */}
                <div className="grid grid-cols-3 gap-3">
                  <label className="flex flex-col text-sm">
                    <span className="text-slate-700 dark:text-slate-200">{t('encounter.type')}</span>
                    <select
                      className="input mt-1"
                      value={encounterType}
                      onChange={(e) => { setEncounterType(e.target.value); setChecked(null); }}
                    >
                      {ENCOUNTER_TYPES.map((x) => (
                        <option key={x} value={x}>{t(`encountertype.${x}`)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col text-sm">
                    <span className="text-slate-700 dark:text-slate-200">{t('encounter.date')}</span>
                    <input type="date" className="input mt-1" value={encounterDate} onChange={(e) => setEncounterDate(e.target.value)} />
                  </label>
                  <label className="flex flex-col text-sm">
                    <span className="text-slate-700 dark:text-slate-200">{t('encounter.status')}</span>
                    <select
                      className="input mt-1"
                      value={status}
                      onChange={(e) => { setStatus(e.target.value); setChecked(null); }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{t(`encstatus.${s}`)}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* L'age est calcule par le systeme a partir d'un patient reel : il reste
                    vide en apercu, mais garde sa place dans la page. */}
                <div className="rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100">
                  {t('encounter.age')} : <strong>—</strong>
                  <span className="ml-2 text-xs text-teal-600 dark:text-teal-300">{t('preview.age_note')}</span>
                </div>

                {applicable.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('preview.no_field_for_type')}</p>
                ) : (
                  <EncounterFields
                    hiddenKeys={encounterHidden}
                    fields={applicable}
                    sections={sections}
                    values={encounterValues}
                    onChange={(k, v) => setEncounterValues((p) => ({ ...p, [k]: v }))}
                    onRemove={(key) => setEncounterValues((current) => {
                      const { [key]: _removed, ...remaining } = current;
                      return remaining;
                    })}
                  />
                )}

                {checked && checked.blocking.length === 0 && checked.warnings.length === 0 && (
                  <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
                    {t('preview.check_ok')}
                  </p>
                )}
                {checked && checked.blocking.length > 0 && (
                  <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                    <p className="font-medium">{t('encounter.blocking')}</p>
                    <ul className="list-disc pl-5">
                      {checked.blocking.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  </div>
                )}
                {checked && checked.warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    <p className="font-medium">{t('encounter.warnings')}</p>
                    <ul className="list-disc pl-5">
                      {checked.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={runChecks} className="btn-secondary">
                    {t('preview.check')}
                  </button>
                  <span className="text-xs text-slate-400">{t('preview.check_hint')}</span>
                </div>
              </>
            )}
          </div>
        </RepositoryProvider>
      </div>

      {(tab === 'patient' ? patientVisible : applicable).some((f) => f.type === 'terminology') && (
        <p className="text-xs text-slate-500">{t('preview.terminology_disabled')}</p>
      )}
    </section>
  );
}
