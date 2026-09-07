import { useMemo } from 'react';
import { Info } from 'lucide-react';
import type {
  DiagnosisContext, FieldScope, TemplateField, TemplateSection, ValidationRule,
} from '../../data/types';
import { calculateDiagnosisCoverage, type DiagnosisCoverage } from '../../domain/diagnosisCoverage';
import { useI18n } from '../../i18n/useI18n';

/**
 * L56 — couverture diagnostique d'un dossier, calculee LOCALEMENT avec le meme code que le
 * serveur (L55) et la VERSION de ce dossier.
 *
 * Elle n'est qu'une information : elle ne conditionne aucune validation, ne change aucune
 * obligation et n'est jamais enregistree. Une configuration absente rend `null`, exactement
 * comme une collecte historique. Une configuration que cet ecran ne sait pas resoudre rend
 * `null` elle aussi : la saisie continue, et le serveur reste seul juge de ce qu'il accepte.
 */
export function diagnosisCoverageOrNull(
  versionId: string | null | undefined,
  diagnosisContext: DiagnosisContext[] | undefined,
  scope: FieldScope,
  values: Record<string, unknown>,
  fields: readonly TemplateField[],
  rules: readonly Pick<ValidationRule, 'rule'>[],
  sections: readonly TemplateSection[] = [],
): DiagnosisCoverage | null {
  if (!versionId || !diagnosisContext?.length) return null;
  try {
    return calculateDiagnosisCoverage(
      { id: versionId, diagnosisContext }, scope, values, fields, rules, sections,
    );
  } catch {
    return null;
  }
}

/** Meme calcul, memorise : les formulaires le reevaluent a chaque frappe. */
export function useDiagnosisCoverage(
  versionId: string | null | undefined,
  diagnosisContext: DiagnosisContext[] | undefined,
  scope: FieldScope,
  values: Record<string, unknown>,
  fields: readonly TemplateField[],
  rules: readonly Pick<ValidationRule, 'rule'>[],
  sections: readonly TemplateSection[] = [],
): DiagnosisCoverage | null {
  return useMemo(
    () => diagnosisCoverageOrNull(versionId, diagnosisContext, scope, values, fields, rules, sections),
    [versionId, diagnosisContext, scope, values, fields, rules, sections],
  );
}

/**
 * Information NON BLOQUANTE : « ce diagnostic n'a pas de bloc dans cette version ». Elle ne
 * propose pas de le changer, n'invite pas a en choisir un autre et ne dit rien de la
 * completude du dossier — la couverture ne remplace jamais draft/complete/curated.
 *
 * Seuls des CODES sont affiches : ni libelle de bloc, ni texte de proposition. La decision
 * « le socle suffit » (`common_only`) est un choix du responsable, pas un manque : elle ne
 * declenche aucun message.
 */
export function DiagnosisCoverageNotice({ coverage }: { coverage: DiagnosisCoverage | null }) {
  const { t } = useI18n();
  if (!coverage) return null;
  const uncovered = coverage.diagnostics
    .filter((d) => d.status === 'uncovered')
    .map((d) => d.code)
    .filter((code): code is string => !!code);
  const unclassified = coverage.counts.unclassified > 0;
  if (uncovered.length === 0 && !unclassified) return null;
  return (
    <div role="status" className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
      <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
      <div>
        {uncovered.length > 0 && (
          <p>
            {t('diagnosis.coverage_uncovered').replace('{n}', String(uncovered.length))}{' '}
            <span className="font-mono text-xs">{uncovered.join(', ')}</span>
          </p>
        )}
        {unclassified && <p className={uncovered.length > 0 ? 'mt-1' : undefined}>{t('diagnosis.coverage_unclassified')}</p>}
        <p className="mt-1 text-xs text-sky-700">{t('diagnosis.coverage_hint')}</p>
      </div>
    </div>
  );
}
