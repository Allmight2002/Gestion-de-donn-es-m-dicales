import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage, structuredErrorCode } from '../../lib/errorMessage';
import { sectionLabel } from '../../domain/templateSections';
import { fieldTypeLabel } from '../../domain/templateLabels';
import type { TemplateRepository } from '../../data/templates';
import type {
  RuleBatchPayload, RuleBatchPlan, RuleBatchReceipt, RuleSeverity,
  TemplateField, TemplateSection, ValidationRule,
} from '../../data/types';
import { RuleSummary } from './RuleForm';

/** Forme minimale lue dans la règle source : le reste appartient au moteur, pas à cet écran. */
type ConditionalRule = {
  if?: Record<string, unknown>;
  then?: { field?: unknown; operator?: unknown; section?: unknown };
};

/** Une règle sert de modèle si elle porte une condition et cible une VARIABLE (pas un bloc).
 * Une comparaison ou une condition de bloc n'a pas de sens multicible : la spécification
 * interdit d'en déduire un. */
export function isBatchSource(rule: unknown): boolean {
  const value = rule as ConditionalRule;
  return !!value?.if && typeof value.then?.field === 'string'
    && (value.then?.operator === 'required' || value.then?.operator === 'visible');
}

const PREVIEW_DEBOUNCE_MS = 350;

export function RuleBatchPanel({ versionId, source, fields, sections, repo, onClose, onApplied, onOpenRule }: {
  versionId: string;
  source: ValidationRule;
  fields: TemplateField[];
  sections: readonly TemplateSection[];
  repo: TemplateRepository;
  onClose: () => void;
  onApplied: () => void;
  /** Ouvre une règle créée dans la liste : le lot ne se termine pas sur un cul-de-sac. */
  onOpenRule?: (ruleId: string) => void;
}) {
  const { t } = useI18n();
  const rule = source.rule as ConditionalRule;
  const condition = (rule.if ?? {}) as Record<string, unknown>;
  const effect = rule.then?.operator === 'visible' ? 'visible' : 'required';
  const driverKey = typeof condition.field === 'string' ? condition.field : '';
  const sourceTarget = typeof rule.then?.field === 'string' ? rule.then.field : '';

  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState<RuleBatchPlan | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  // Deux erreurs distinctes : celle de la verification et celle de la confirmation. Les
  // confondre ferait disparaitre le motif d'un refus des que l'apercu se rafraichit.
  const [checkError, setCheckError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<RuleBatchReceipt | null>(null);
  // La clé d'opération appartient à une charge donnée : une reprise après conflit ou erreur
  // réseau rejoue la MÊME clé, sinon le rejeu créerait un second lot.
  const operation = useRef<{ key: string; id: string } | null>(null);

  const labelOf = useCallback(
    (key: string) => fields.find((field) => field.fieldKey === key)?.label ?? key,
    [fields],
  );
  // Le pilote ne peut pas être sa propre cible ; le reste est jugé par le serveur, qui rend
  // la vraie raison d'un refus au lieu d'une compatibilité devinée ici.
  const candidates = useMemo(
    () => fields.filter((field) => field.fieldKey !== driverKey),
    [fields, driverKey],
  );
  const needle = query.trim().toLocaleLowerCase();
  const shown = candidates.filter((field) => !needle
    || `${field.label} ${field.fieldKey}`.toLocaleLowerCase().includes(needle));
  // Regroupées par section : sur un modèle volumineux, une liste plate ne dit pas d'où vient
  // une variable, et deux libellés proches deviennent impossibles à départager.
  const groups = useMemo(() => {
    const bySection = new Map<string, TemplateField[]>();
    for (const field of shown) {
      const key = field.section ?? '';
      bySection.set(key, [...(bySection.get(key) ?? []), field]);
    }
    return [...bySection.entries()].map(([key, items]) => ({
      key,
      label: sectionLabel(t, {
        sectionKey: key === '' ? null : key,
        label: sections.find((section) => section.sectionKey === key)?.label,
      }),
      items,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.map((field) => field.id).join(','), sections, t]);

  const payload: RuleBatchPayload = useMemo(() => ({
    condition,
    effect,
    targets: selected,
    message: source.message,
    severity: source.severity as RuleSeverity,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [JSON.stringify(condition), effect, selected, source.message, source.severity]);
  const payloadKey = JSON.stringify(payload);

  const check = useCallback(async () => {
    if (!repo.previewRuleBatch || selected.length === 0) { setPlan(null); return; }
    setChecking(true);
    try {
      setPlan(await repo.previewRuleBatch(versionId, payload));
      setCheckError(null);
    } catch (failure) {
      setPlan(null);
      setCheckError(errorMessage(failure, t('common.error')));
    } finally {
      setChecking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, versionId, payloadKey, selected.length]);

  // L'aperçu suit la sélection : ce qui est affiché est toujours le verdict du serveur pour
  // la sélection courante, jamais une estimation locale devenue fausse.
  useEffect(() => {
    if (receipt) return;
    const handle = setTimeout(() => { void check(); }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [check, receipt]);

  function toggle(key: string) {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  async function confirm() {
    if (!repo.createRuleBatch || !plan || busy) return;
    if (operation.current?.key !== payloadKey) operation.current = { key: payloadKey, id: crypto.randomUUID() };
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await repo.createRuleBatch(versionId, operation.current.id, payload, plan.fingerprint);
      setReceipt(result);
      onApplied();
    } catch (failure) {
      const code = structuredErrorCode(failure);
      // Une version modifiée depuis la vérification conserve condition et cibles : seul
      // l'aperçu est refait, avec l'empreinte à jour.
      setSubmitError(code === 'rule_batch_conflict' ? t('rulebatch.conflict') : errorMessage(failure, t('common.error')));
      if (code === 'rule_batch_conflict') void check();
    } finally {
      setBusy(false);
    }
  }

  const invalid = plan?.invalid ?? [];
  const toCreate = plan?.create ?? [];
  const duplicates = plan?.duplicates ?? [];
  const frozen = plan?.locked || plan?.inUse;
  const ready = !!plan && !checking && invalid.length === 0 && toCreate.length > 0 && !frozen;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button type="button" className="absolute inset-0 bg-slate-950/30" aria-label={t('rulebatch.close')} onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl"
        role="dialog" aria-modal="true" aria-labelledby="rule-batch-title"
        onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white/95 p-4 backdrop-blur">
          <h3 id="rule-batch-title" className="text-lg font-semibold text-slate-900">{t('rulebatch.title')}</h3>
          <button type="button" className="icon-button h-11 w-11" onClick={onClose} aria-label={t('rulebatch.close')}>
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="space-y-4 p-4 text-sm">
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-medium text-slate-500">{t('rulebatch.source')}</p>
            <div className="mt-1"><RuleSummary rule={source.rule} fields={fields} sections={sections} /></div>
            <p className="mt-2 text-xs text-slate-500">{t('rulebatch.block_hint')}</p>
          </div>

          {receipt ? (
            <div className="space-y-3">
              <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-teal-900">
                {t('rulebatch.done')
                  .replace('{created}', String(receipt.created.length))
                  .replace('{duplicates}', String(receipt.duplicates.length))}
              </p>
              <ul className="space-y-1 text-slate-700">
                {receipt.created.map((item) => (
                  <li key={item.id}>
                    {onOpenRule ? (
                      <button type="button" className="font-medium text-teal-700 underline underline-offset-2"
                        onClick={() => onOpenRule(item.id)}>
                        {labelOf(item.target)}
                      </button>
                    ) : labelOf(item.target)}
                  </li>
                ))}
              </ul>
              <button type="button" className="btn-secondary" onClick={onClose}>{t('rulebatch.close')}</button>
            </div>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-slate-500">{t('rulebatch.targets')}</legend>
                <input type="search" className="input" value={query} autoComplete="off"
                  aria-label={t('rulebatch.search')} placeholder={t('rulebatch.search')}
                  onChange={(event) => setQuery(event.target.value)} />
                {/* « Sélectionner les résultats » dit exactement combien et lesquels : jamais
                    une sélection implicite de variables masquées par la recherche. */}
                <button type="button" className="btn-ghost min-h-11 px-2 text-xs"
                  onClick={() => setSelected((current) => [...new Set([...current, ...shown.map((field) => field.fieldKey)])])}>
                  {t('rulebatch.select_shown').replace('{n}', String(shown.length))}
                </button>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-2">
                  {groups.map((group) => (
                    <div key={group.key}>
                      <p className="px-2 text-xs font-semibold text-slate-500">{group.label}</p>
                      <ul>
                        {group.items.map((field) => (
                          <li key={field.id}>
                            <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                              <input type="checkbox" className="mt-1 h-4 w-4 accent-teal-700"
                                checked={selected.includes(field.fieldKey)} onChange={() => toggle(field.fieldKey)} />
                              <span className="min-w-0">
                                <span className="block break-words font-medium text-slate-800">{field.label}</span>
                                <span className="block text-xs text-slate-500">
                                  {fieldTypeLabel(t, field.type)}
                                  {field.fieldKey === sourceTarget ? ` · ${t('rulebatch.source_target')}` : ''}
                                </span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {shown.length === 0 && <p className="px-2 py-3 text-xs text-slate-500">{t('rulebatch.no_match')}</p>}
                </div>
              </fieldset>

              {/* Récapitulatif : la sélection survit au filtrage, et chaque choix se retire un par un. */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600" role="status">
                  {t('rulebatch.selected_count').replace('{n}', String(selected.length))}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {selected.map((key) => (
                    <li key={key} className="flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-xs text-teal-900">
                      <span className="break-words">{labelOf(key)}</span>
                      <button type="button" className="min-h-11 min-w-11 px-1 font-medium"
                        aria-label={t('rulebatch.remove').replace('{label}', labelOf(key))}
                        onClick={() => toggle(key)}>×</button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">{t('rulebatch.preview')}</p>
                {checking && <p role="status" className="text-xs text-slate-500">{t('rulebatch.preview_pending')}</p>}
                <ul className="space-y-1">
                  {toCreate.map((item) => (
                    <li key={item.target}>
                      <RuleSummary
                        rule={{ if: condition, then: { field: item.target, operator: effect } }}
                        fields={fields}
                        sections={sections}
                      />
                    </li>
                  ))}
                </ul>
                {duplicates.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <p className="font-medium">{t('rulebatch.duplicates')}</p>
                    <ul className="mt-1">{duplicates.map((item) => <li key={item.target}>{labelOf(item.target)}</li>)}</ul>
                  </div>
                )}
                {invalid.length > 0 && (
                  <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    <p className="font-medium">{t('rulebatch.invalid')}</p>
                    <ul className="mt-1 space-y-1">
                      {invalid.map((item) => (
                        <li key={item.target}>
                          <span className="font-medium">{labelOf(item.target)}</span> : {item.reason}
                          <button type="button" className="ml-2 underline" onClick={() => toggle(item.target)}>
                            {t('rulebatch.remove').replace('{label}', labelOf(item.target))}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {plan?.locked && <p role="alert" className="text-xs text-amber-800">{t('rulebatch.locked')}</p>}
                {plan?.inUse && <p role="alert" className="text-xs text-amber-800">{t('rulebatch.in_use')}</p>}
                {plan && !checking && toCreate.length === 0 && duplicates.length > 0 && invalid.length === 0 && (
                  <p className="text-xs text-slate-600">{t('rulebatch.none')}</p>
                )}
              </div>

              {checkError && <p role="alert" className="text-sm text-red-600">{checkError}</p>}
              {submitError && <p role="alert" className="text-sm text-red-600">{submitError}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={`btn-primary${busy ? ' btn-pending' : ''}`}
                  disabled={!ready || busy} aria-busy={busy || undefined} onClick={() => void confirm()}>
                  {t('rulebatch.confirm').replace('{n}', String(toCreate.length))}
                </button>
                <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
