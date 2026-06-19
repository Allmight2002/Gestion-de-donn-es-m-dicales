import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useAttachmentRepository, useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { Encounter, PatientListItem } from '../../data/patients';
import type { AttachmentItem } from '../../data/attachments';
import type { TemplateField } from '../../data/types';
import type { MessageKey } from '../../i18n/messages';
import { isMissing, missingCodeOf } from '../../domain/validation';
import { DeleteWithReason } from './DeleteWithReason';

// Fiche patient (cahier §8.6) : Identite (si autorise) / donnees permanentes /
// rencontres par section. La fiche identite n'est rendue que si la RLS a renvoye
// l'identite (acces zone restreinte).
export function PatientDetail() {
  const { id: baseId, patientId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();
  const attachmentsRepo = useAttachmentRepository();

  const [patient, setPatient] = useState<PatientListItem | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [patientFields, setPatientFields] = useState<TemplateField[]>([]);
  const [encounterFields, setEncounterFields] = useState<TemplateField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fmt = useCallback(
    (v: unknown): string => {
      if (isMissing(v)) return t(`missing.${missingCodeOf(v)!}`);
      if (v === null || v === undefined || v === '') return '—';
      if (Array.isArray(v)) return v.join(', ');
      if (typeof v === 'boolean') return v ? '✓' : '✗';
      return String(v);
    },
    [t],
  );

  const load = useCallback(async () => {
    if (!baseId || !patientId) return;
    setLoading(true);
    try {
      const [p, encs, base, atts] = await Promise.all([
        patients.getPatient(baseId, patientId),
        patients.listEncounters(patientId),
        bases.getBase(baseId),
        attachmentsRepo.listAttachments(patientId),
      ]);
      setPatient(p);
      setEncounters(encs);
      setAttachments(atts);
      if (base?.base.currentTemplateVersionId) {
        const version = await templates.getVersion(base.base.currentTemplateVersionId);
        const sorted = [...version.fields].sort((a, b) => a.displayOrder - b.displayOrder);
        setPatientFields(sorted.filter((f) => f.scope === 'patient'));
        setEncounterFields(sorted.filter((f) => f.scope === 'encounter'));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, patientId, bases, templates, patients, attachmentsRepo]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;
  if (!patient) return <p className="text-slate-500">{t('notfound.title')}</p>;

  return (
    <section className="max-w-3xl space-y-6">
      <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm text-teal-700 hover:underline">
        ← {t('admin.back')}
      </button>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {t('patient.detail')} <span className="font-mono text-base text-slate-500">{patient.code}</span>
        </h1>
        <div className="flex items-center gap-3">
          <DeleteWithReason
            label={t('del.patient')}
            onConfirm={async (reason) => {
              if (!patientId) return;
              await patients.softDeletePatient(patientId, reason);
              navigate(`/bases/${baseId}`);
            }}
          />
          <button
            onClick={() => navigate(`/bases/${baseId}/patients/${patientId}/encounters/new`)}
            className="rounded bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            + {t('encounter.add')}
          </button>
        </div>
      </div>

      {patient.identity && (
        <fieldset className="space-y-1 rounded border border-amber-200 bg-amber-50/40 p-4 text-sm">
          <legend className="px-1 text-sm font-semibold text-amber-800">{t('patient.identity_section')}</legend>
          <div><span className="text-slate-500">{t('patient.full_name')} :</span> {patient.identity.fullName ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.dob')} :</span> {patient.identity.dateOfBirth ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.phone')} :</span> {patient.identity.phone ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.external_id')} :</span> {patient.identity.externalIdentifier ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.auth_status')} :</span> {t(`authstatus.${patient.identity.authStatus}` as MessageKey)}</div>
        </fieldset>
      )}

      <div className="rounded border border-slate-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('patient.permanent_section')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {patientFields.map((f) => (
            <div key={f.id} className="contents">
              <dt className="text-slate-500">{f.label}</dt>
              <dd>{fmt(patient.data[f.fieldKey])}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <h2 className="mb-2 font-medium">{t('patient.encounters')}</h2>
        {encounters.length === 0 ? (
          <p className="text-slate-500">{t('patient.no_encounters')}</p>
        ) : (
          <ul className="space-y-3">
            {encounters.map((e) => (
              <li key={e.id} className="rounded border border-slate-200 p-3 text-sm">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium">
                    {t(`encountertype.${e.encounterType}` as MessageKey)} · {e.encounterDate}
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{t(`encstatus.${e.validationStatus}` as MessageKey)}</span>
                    {e.ageValue != null && (
                      <span className="ml-2 text-xs text-slate-500">
                        {t('encounter.age')} : {e.ageValue} {e.ageUnit ? t(`ageunit.${e.ageUnit}` as MessageKey) : ''}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    <button
                      onClick={() => navigate(`/bases/${baseId}/patients/${patientId}/encounters/${e.id}/edit`)}
                      className="text-xs text-teal-700 hover:underline"
                    >
                      {t('encounter.edit')}
                    </button>
                    <DeleteWithReason onConfirm={async (reason) => { await patients.softDeleteEncounter(e.id, reason); await load(); }} />
                  </span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                  {encounterFields
                    .filter((f) => f.fieldKey in e.data)
                    .map((f) => (
                      <div key={f.id} className="contents">
                        <dt className="text-slate-500">{f.label}</dt>
                        <dd>{fmt(e.data[f.fieldKey])}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>

      {patient.identity && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">{t('image.section')}</h2>
            <button
              onClick={() => navigate(`/bases/${baseId}/patients/${patientId}/images/new`)}
              className="text-sm text-teal-700 hover:underline"
            >
              + {t('image.add')}
            </button>
          </div>
          {attachments.length === 0 ? (
            <p className="text-sm text-slate-500">{t('image.none')}</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {attachments.map((a) => {
                const isImage = (a.mimeType ?? '').startsWith('image/');
                return (
                  <figure key={a.id} className="w-40">
                    {isImage && a.signedUrl ? (
                      <img src={a.signedUrl} alt={a.label ?? ''} className="h-32 w-40 rounded border border-slate-200 object-cover" />
                    ) : (
                      <a
                        href={a.signedUrl ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-32 w-40 flex-col items-center justify-center gap-1 rounded border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
                      >
                        <span className="text-2xl">📄</span>
                        <span className="text-xs text-teal-700 hover:underline">{t('image.open')}</span>
                      </a>
                    )}
                    <figcaption className="truncate text-xs text-slate-500">{a.label ?? a.kind}</figcaption>
                    <DeleteWithReason onConfirm={async (reason) => { await attachmentsRepo.softDeleteAttachment(a.id, reason); await load(); }} />
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
