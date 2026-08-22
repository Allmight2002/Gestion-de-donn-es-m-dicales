import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, FileText, Image as ImageIcon, Plus } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useAttachmentRepository, useAuditRepository, useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { Encounter, PatientListItem } from '../../data/patients';
import type { AttachmentItem } from '../../data/attachments';
import type { MessageKey } from '../../i18n/messages';
import { InspectionStatusBadge, RetryInspectionButton } from '../../components/InspectionStatusBadge';
import { isInspectionReadable, isInspectionRetryable } from '../../data/inspection';
import { offlineCache, useOnline } from '../../data/offline';
import { getTemplateFields } from '../../data/templates';
import { displayFieldValue } from '../../data/types';
import { isMissing, missingCodeOf } from '../../domain/validation';
import { evaluateFormulaText, formulaFieldIndex } from '../../domain/export';
import { FORMULA_TIME_UNITS, formulaUsesTemporalOperands, normalizeFormulaTimeUnit } from '../../domain/fieldFormula';
import { formatDate } from '../../lib/formatDate';
import { SkeletonList } from '../../components/Skeleton';
import { StatusBadge } from '../../components/StatusBadge';
import { DeleteWithReason } from './DeleteWithReason';
import { useSignedFile } from '../../lib/useSignedFile';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { EmptyState } from '../../components/EmptyState';
import { canCorrectPatientIdentity } from '../../domain/patientIdentity';
import { groupFieldsBySection, sectionLabel } from '../../domain/templateSections';

// Colonne affichee (sous-ensemble commun en ligne / hors-ligne).
// L30 : `type` et les options voyagent avec la colonne pour que la fiche affiche le
// LIBELLE de l'option et non son code -- en ligne comme depuis un instantane.
type Column = {
  id: string; fieldKey: string; label: string; scope: string; section: string; displayOrder: number;
  sectionLabel?: string | null; sectionOrder?: number | null;
  type?: string; unit?: string | null; allowedValues?: unknown; allowedOptions?: unknown;
  formula?: string | null;
};

type ColumnSource = {
  id: string; fieldKey: string; label: string; scope: string; section?: string | null; displayOrder: number;
  sectionLabel?: string | null; sectionOrder?: number | null;
  type?: string; unit?: string | null; allowedValues?: unknown; allowedOptions?: unknown;
  formula?: string | null;
};

const toColumn = (field: ColumnSource): Column => ({
  id: field.id,
  fieldKey: field.fieldKey,
  label: field.label,
  scope: field.scope,
  section: field.section ?? '',
  sectionLabel: field.sectionLabel ?? null,
  sectionOrder: field.sectionOrder ?? null,
  displayOrder: field.displayOrder,
  type: field.type,
  unit: field.unit ?? null,
  allowedValues: field.allowedValues,
  allowedOptions: field.allowedOptions,
  formula: field.formula ?? null,
});

const formulaFieldsOf = (fields: readonly Column[]) => fields.map((field) => ({
  fieldKey: field.fieldKey,
  type: field.type ?? '',
  formula: field.formula ?? null,
}));

const unitOf = (field: Column, fields: readonly Column[], t: (key: MessageKey) => string): string | null => {
  const temporalFormula = Boolean(field.formula && formulaUsesTemporalOperands(field.formula, formulaFieldsOf(fields)));
  const unit = temporalFormula ? normalizeFormulaTimeUnit(field.unit) : field.unit;
  return temporalFormula && unit && (FORMULA_TIME_UNITS as readonly string[]).includes(unit)
    ? t(`form.unit_${unit}` as MessageKey)
    : unit ?? null;
};

// §11 : media d'une piece jointe. L'URL signee (et l'audit) ne sont generes qu'au CLIC :
// une image s'affiche apres « Afficher l'image » ; un document s'ouvre dans un onglet.
function AttachmentMedia({ isImage, label, load, onReveal, readable }: {
  isImage: boolean; label: string; load: () => Promise<string | null>; onReveal: () => void; readable: boolean;
}) {
  const { t } = useI18n();
  const { url, busy, error, errorMessage: refusal, reveal } = useSignedFile(load, onReveal);
  const Icon = isImage ? ImageIcon : FileText;
  if (!readable) {
    return (
      <div
        aria-disabled="true"
        className="flex h-32 w-40 flex-col items-center justify-center gap-1 rounded border border-slate-200 bg-slate-50 text-slate-400"
      >
        <Icon className="h-7 w-7" aria-hidden="true" />
        <span className="text-xs">{t('inspection.blocked')}</span>
      </div>
    );
  }
  if (isImage && url) {
    return <img src={url} alt={label} className="h-32 w-40 rounded border border-slate-200 object-cover" />;
  }
  return (
    <>
      <button
        type="button"
        onClick={() => { if (isImage) void reveal(); else void reveal().then((u) => { if (u) window.open(u, '_blank', 'noopener,noreferrer'); }); }}
        disabled={busy}
        className="flex h-32 w-40 flex-col items-center justify-center gap-1 rounded border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
      >
        <span className="text-2xl">{isImage ? '🖼️' : '📄'}</span>
        <span className="text-xs text-teal-700 hover:underline">
          {busy ? t('common.loading') : error ? t('common.error') : isImage ? t('image.show') : t('image.open')}
        </span>
      </button>
      {/* Chantier D : le motif choisi par le serveur, sinon un refus reste indiscernable d'une panne. */}
      {refusal && <p role="alert" className="mt-1 break-words text-xs text-red-600">{refusal}</p>}
    </>
  );
}

// Fiche patient (cahier §8.6) : Identite (si autorise) / donnees permanentes /
// rencontres par section. La fiche identite n'est rendue que si la RLS a renvoye
// l'identite (acces zone restreinte).
export function PatientDetail() {
  const { id: baseId, patientId } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const online = useOnline();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();
  const attachmentsRepo = useAttachmentRepository();
  const audit = useAuditRepository();

  const [patient, setPatient] = useState<PatientListItem | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [patientFields, setPatientFields] = useState<Column[]>([]);
  const [encounterFields, setEncounterFields] = useState<Column[]>([]);
  const [offlineView, setOfflineView] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canCorrectIdentity, setCanCorrectIdentity] = useState(false);
  const [isCrossSectional, setIsCrossSectional] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmt = useCallback(
    (v: unknown, field?: Column, data?: Record<string, unknown>, fields: readonly Column[] = []): string => {
      if (field?.formula) {
        const result = evaluateFormulaText(field.formula, data, formulaFieldIndex(formulaFieldsOf(fields)), field.unit);
        return result === null ? '—' : String(result);
      }
      if (isMissing(v)) return t(`missing.${missingCodeOf(v)!}`);
      if (typeof v === 'boolean') return v ? '✓' : '✗';
      // La variable est passee pour que le LIBELLE de l'option s'affiche, et non son code.
      return displayFieldValue(v, '—', field);
    },
    [t],
  );

  const load = useCallback(async () => {
    if (!baseId || !patientId) return;
    setLoading(true);
    try {
      if (!online) {
        // HORS-LIGNE : lecture seule depuis l'instantane (analytique, sans identite ni images).
        const snap = await offlineCache.get(baseId);
        const op = snap?.patients.find((pp) => pp.id === patientId) ?? null;
        setOfflineView(true);
        setCanEdit(false);
        setCanCorrectIdentity(false);
        setIsCrossSectional(false);
        setAttachments([]);
        if (!op) { setPatient(null); setEncounters([]); setError(t('offline.not_cached')); return; }
        setPatient({ id: op.id, code: op.code, templateVersionId: op.templateVersionId, data: op.data, validationStatus: op.validationStatus, identity: null });
        setEncounters(op.encounters.map((e) => ({ ...e })));
        // §5.7 : dictionnaire de la VERSION du patient (repli sur la version courante) ; pour les
        // rencontres, union des dictionnaires de LEURS versions -> une ancienne variable garde son libelle.
        const dictFor = (vid?: string | null): Column[] => ((vid && snap?.fieldsByVersion?.[vid]) || snap?.fields || []).map(toColumn);
        setPatientFields(dictFor(op.templateVersionId).sort((a, b) => a.displayOrder - b.displayOrder).filter((f) => f.scope === 'patient'));
        const encFields = new Map<string, Column>();
        for (const e of op.encounters) for (const f of dictFor(e.templateVersionId)) if (f.scope === 'encounter') encFields.set(f.fieldKey, f);
        if (encFields.size === 0) for (const f of (snap?.fields ?? []).map(toColumn)) if (f.scope === 'encounter') encFields.set(f.fieldKey, f);
        setEncounterFields([...encFields.values()].sort((a, b) => a.displayOrder - b.displayOrder));
        setError(null);
        return;
      }

      setOfflineView(false);
      const [p, encs, base, atts] = await Promise.all([
        patients.getPatient(baseId, patientId),
        patients.listEncounters(patientId),
        bases.getBase(baseId),
        attachmentsRepo.listAttachments(patientId),
      ]);
      setPatient(p);
      setEncounters(encs);
      setAttachments(atts);
      setCanEdit(base?.role === 'owner' || !!base?.permissions.canEditStructuredData);
      setCanCorrectIdentity(canCorrectPatientIdentity(base, p));
      setIsCrossSectional((base?.base.observationModel ?? 'longitudinal') === 'cross_sectional');
      if (base?.base.currentTemplateVersionId) {
        const fields = await getTemplateFields(templates, base.base.currentTemplateVersionId);
        const sorted: Column[] = fields
          .map(toColumn)
          .sort((a, b) => a.displayOrder - b.displayOrder);
        setPatientFields(sorted.filter((f) => f.scope === 'patient'));
        setEncounterFields(sorted.filter((f) => f.scope === 'encounter'));
      }
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, patientId, online, bases, templates, patients, attachmentsRepo, audit]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retryAttachmentInspection(id: string) {
    setBusy(true);
    try {
      await attachmentsRepo.retryInspection(id);
      await load();
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonList rows={7} label={t('common.loading')} />;
  if (!patient) return <p className="text-slate-500">{t('notfound.title')}</p>;

  return (
    <section className="max-w-4xl space-y-5 sm:space-y-6">
      <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
        ← {t('admin.back')}
      </button>

      <PageHeader
        title={t('patient.detail')}
        eyebrow={<span className="font-mono">{patient.code}</span>}
        badge={offlineView ? <span className="badge bg-amber-100 text-amber-800">{t('offline.read_only')}</span> : undefined}
        actions={!offlineView ? (
          <>
            {canEdit && (
              <DeleteWithReason
                label={t('del.patient')}
                onConfirm={async (reason) => {
                  if (!patientId) return;
                  await patients.softDeletePatient(patientId, reason);
                }}
                onSuccess={() => navigate(`/bases/${baseId}`)}
                verifyDeletedAfterError={async () => !!baseId && !!patientId && (await patients.getPatient(baseId, patientId)) === null}
              />
            )}
            {!isCrossSectional && (
              <button
                onClick={() => navigate(`/bases/${baseId}/patients/${patientId}/encounters/new`)}
                className="btn-primary"
              >
                <Plus size={16} aria-hidden /> {t('encounter.add')}
              </button>
            )}
          </>
        ) : undefined}
      />

      {patient.identity && (
        <fieldset className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-sm shadow-sm">
          <legend className="px-1 text-sm font-semibold text-amber-800">{t('patient.identity_section')}</legend>
          <div><span className="text-slate-500">{t('patient.full_name')} :</span> {patient.identity.fullName ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.dob')} :</span> {patient.identity.dateOfBirth ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.phone')} :</span> {patient.identity.phone ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.address')} :</span> {patient.identity.address ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.external_id')} :</span> {patient.identity.externalIdentifier ?? '—'}</div>
          {canCorrectIdentity && (
            <button
              type="button"
              onClick={() => navigate(`/bases/${baseId}/patients/${patientId}/identity/edit`)}
              className="mt-3 text-xs font-medium text-teal-700 hover:underline"
            >
              {t('patient.edit_identity')}
            </button>
          )}
        </fieldset>
      )}

      <SectionCard
        title={t('patient.permanent_section')}
        actions={(
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={patient.validationStatus} />
            {canEdit && (
              <button
                onClick={() => navigate(`/bases/${baseId}/patients/${patientId}/edit`)}
                className="text-xs font-medium text-teal-700 hover:underline"
              >
                {t('patient.edit_permanent')}
              </button>
            )}
            {canEdit && patient.validationStatus !== 'curated' && (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await patients.finalizePatient(patientId!); await load(); setError(null); }
                  catch (e) { setError(errorMessage(e, t('common.error'))); }
                  finally { setBusy(false); }
                }}
                className="text-xs font-medium text-teal-700 hover:underline"
              >
                {t('patient.finalize')}
              </button>
            )}
          </span>
        )}
      >
        <div className="space-y-4">
          {groupFieldsBySection(patientFields).map((group) => (
            <fieldset key={group.key} className="rounded-xl border border-slate-100 p-3">
              <legend className="px-1 text-sm font-semibold text-slate-700">
                {sectionLabel(t, { sectionKey: group.key, label: group.label })}
              </legend>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {group.fields.map((f) => {
                  const renderedUnit = unitOf(f, patientFields, t);
                  return (
                    <div key={f.id} className="rounded-lg bg-slate-50/70 px-3 py-2">
                      <dt className="text-xs text-slate-500">
                        {f.label}{renderedUnit && <span className="text-slate-400"> ({renderedUnit})</span>}
                      </dt>
                      <dd className="mt-0.5 text-slate-900">{fmt(patient.data[f.fieldKey], f, patient.data, patientFields)}</dd>
                    </div>
                  );
                })}
              </dl>
            </fieldset>
          ))}
        </div>
      </SectionCard>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('patient.encounters')}</h2>
        {encounters.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t('patient.no_encounters')} compact />
        ) : (
          <ul className="space-y-3">
            {encounters.map((e) => (
              <li key={e.id} className="card p-4 text-sm">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium">
                    {t(`encountertype.${e.encounterType}` as MessageKey)} · {formatDate(e.encounterDate, lang)}
                    <span className="ml-2"><StatusBadge status={e.validationStatus} /></span>
                    {(e as { pending?: boolean }).pending && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{t('offline.pending_badge')}</span>
                    )}
                    {e.ageValue != null && (
                      <span className="ml-2 text-xs text-slate-500">
                        {t('encounter.age')} : {e.ageValue} {e.ageUnit ? t(`ageunit.${e.ageUnit}` as MessageKey) : ''}
                      </span>
                    )}
                  </span>
                  {!offlineView && (
                    <span className="flex items-center gap-3">
                      <button
                        onClick={() => navigate(`/bases/${baseId}/patients/${patientId}/encounters/${e.id}/edit`)}
                        className="text-xs text-teal-700 hover:underline"
                      >
                        {t('encounter.edit')}
                      </button>
                      <DeleteWithReason
                        onConfirm={(reason) => patients.softDeleteEncounter(e.id, reason)}
                        onSuccess={load}
                        verifyDeletedAfterError={async () => !(await patients.listEncounters(patientId!)).some((current) => current.id === e.id)}
                      />
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {groupFieldsBySection(encounterFields.filter((f) => f.formula || f.fieldKey in e.data)).map((group) => (
                    <fieldset key={group.key} className="rounded-lg border border-slate-100 p-3">
                      <legend className="px-1 text-xs font-semibold text-slate-600">
                        {sectionLabel(t, { sectionKey: group.key, label: group.label })}
                      </legend>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                        {group.fields.map((f) => {
                          const renderedUnit = unitOf(f, encounterFields, t);
                          return (
                            <div key={f.id} className="contents">
                              <dt className="text-slate-500">
                                {f.label}{renderedUnit && <span className="text-slate-400"> ({renderedUnit})</span>}
                              </dt>
                              <dd>{fmt(e.data[f.fieldKey], f, e.data, encounterFields)}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    </fieldset>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {patient.identity && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">{t('image.section')}</h2>
            {canEdit && (
              <button
                onClick={() => navigate(`/bases/${baseId}/patients/${patientId}/images/new`)}
                className="text-sm text-teal-700 hover:underline"
              >
                + {t('image.add')}
              </button>
            )}
          </div>
          {attachments.length === 0 ? (
            <p className="text-sm text-slate-500">{t('image.none')}</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {attachments.map((a) => {
                const readable = isInspectionReadable(a.inspectionStatus);
                return (
                  <figure key={a.id} className="w-40">
                    {/* §11 : l'URL signee (et l'audit) ne sont generes qu'au CLIC, pas au rendu. */}
                    <AttachmentMedia
                      isImage={(a.mimeType ?? '').startsWith('image/')}
                      label={a.label ?? ''}
                      load={() => attachmentsRepo.attachmentUrl(a.id, a.filePath)}
                      onReveal={() => void audit.logAttachmentRead(a.id)}
                      readable={readable}
                    />
                    <figcaption className="truncate text-xs text-slate-500">{a.label ?? a.kind}</figcaption>
                    <div className="mt-1 flex items-center gap-1">
                      <InspectionStatusBadge status={a.inspectionStatus} />
                      {canEdit && isInspectionRetryable(a.inspectionStatus) && (
                        <RetryInspectionButton disabled={busy} onClick={() => void retryAttachmentInspection(a.id)} />
                      )}
                    </div>
                    {canEdit && (
                      <DeleteWithReason
                        onConfirm={(reason) => attachmentsRepo.softDeleteAttachment(a.id, reason)}
                        onSuccess={load}
                        verifyDeletedAfterError={async () => !(await attachmentsRepo.listAttachments(patientId!)).some((current) => current.id === a.id)}
                      />
                    )}
                  </figure>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
