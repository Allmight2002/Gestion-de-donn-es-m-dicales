import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useAttachmentRepository, useAuditRepository, useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { Encounter, PatientListItem } from '../../data/patients';
import type { AttachmentItem } from '../../data/attachments';
import type { MessageKey } from '../../i18n/messages';
import { offlineCache, useOnline } from '../../data/offline';
import { getTemplateFields } from '../../data/templates';
import { isMissing, missingCodeOf } from '../../domain/validation';
import { formatDate } from '../../lib/formatDate';
import { StatusBadge } from '../../components/StatusBadge';
import { DeleteWithReason } from './DeleteWithReason';
import { useSignedFile } from '../../lib/useSignedFile';

// Colonne affichee (sous-ensemble commun en ligne / hors-ligne).
type Column = { id: string; fieldKey: string; label: string; scope: string; displayOrder: number };

// §11 : media d'une piece jointe. L'URL signee (et l'audit) ne sont generes qu'au CLIC :
// une image s'affiche apres « Afficher l'image » ; un document s'ouvre dans un onglet.
function AttachmentMedia({ isImage, label, load, onReveal }: {
  isImage: boolean; label: string; load: () => Promise<string | null>; onReveal: () => void;
}) {
  const { t } = useI18n();
  const { url, busy, error, reveal } = useSignedFile(load, onReveal);
  if (isImage && url) {
    return <img src={url} alt={label} className="h-32 w-40 rounded border border-slate-200 object-cover" />;
  }
  return (
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
      if (!online) {
        // HORS-LIGNE : lecture seule depuis l'instantane (analytique, sans identite ni images).
        const snap = await offlineCache.get(baseId);
        const op = snap?.patients.find((pp) => pp.id === patientId) ?? null;
        setOfflineView(true);
        setCanEdit(false);
        setAttachments([]);
        if (!op) { setPatient(null); setEncounters([]); setError(t('offline.not_cached')); return; }
        setPatient({ id: op.id, code: op.code, templateVersionId: op.templateVersionId, data: op.data, validationStatus: op.validationStatus, identity: null });
        setEncounters(op.encounters.map((e) => ({ ...e })));
        // §5.7 : dictionnaire de la VERSION du patient (repli sur la version courante) ; pour les
        // rencontres, union des dictionnaires de LEURS versions -> une ancienne variable garde son libelle.
        const dictFor = (vid?: string | null): Column[] => (vid && snap?.fieldsByVersion?.[vid]) || snap?.fields || [];
        setPatientFields([...dictFor(op.templateVersionId)].sort((a, b) => a.displayOrder - b.displayOrder).filter((f) => f.scope === 'patient'));
        const encFields = new Map<string, Column>();
        for (const e of op.encounters) for (const f of dictFor(e.templateVersionId)) if (f.scope === 'encounter') encFields.set(f.fieldKey, f);
        if (encFields.size === 0) for (const f of (snap?.fields ?? [])) if (f.scope === 'encounter') encFields.set(f.fieldKey, f);
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
      if (base?.base.currentTemplateVersionId) {
        const fields = await getTemplateFields(templates, base.base.currentTemplateVersionId);
        const sorted: Column[] = fields
          .map((f) => ({ id: f.id, fieldKey: f.fieldKey, label: f.label, scope: f.scope, displayOrder: f.displayOrder }))
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

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;
  if (!patient) return <p className="text-slate-500">{t('notfound.title')}</p>;

  return (
    <section className="max-w-3xl space-y-6">
      <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
        ← {t('admin.back')}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">
          {t('patient.detail')} <span className="font-mono text-base font-normal text-slate-400">{patient.code}</span>
          {offlineView && <span className="badge ml-3 bg-amber-100 text-amber-800">{t('offline.read_only')}</span>}
        </h1>
        {!offlineView && (
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
              className="btn-primary"
            >
              + {t('encounter.add')}
            </button>
          </div>
        )}
      </div>

      {patient.identity && (
        <fieldset className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-sm shadow-sm">
          <legend className="px-1 text-sm font-semibold text-amber-800">{t('patient.identity_section')}</legend>
          <div><span className="text-slate-500">{t('patient.full_name')} :</span> {patient.identity.fullName ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.dob')} :</span> {patient.identity.dateOfBirth ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.phone')} :</span> {patient.identity.phone ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.external_id')} :</span> {patient.identity.externalIdentifier ?? '—'}</div>
        </fieldset>
      )}

      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">{t('patient.permanent_section')}</h2>
          <span className="flex items-center gap-3">
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
        </div>
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
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('patient.encounters')}</h2>
        {encounters.length === 0 ? (
          <div className="card border-dashed p-8 text-center text-slate-500">{t('patient.no_encounters')}</div>
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
                      <DeleteWithReason onConfirm={async (reason) => { await patients.softDeleteEncounter(e.id, reason); await load(); }} />
                    </span>
                  )}
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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">{t('image.section')}</h2>
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
              {attachments.map((a) => (
                <figure key={a.id} className="w-40">
                  {/* §11 : l'URL signee (et l'audit) ne sont generes qu'au CLIC, pas au rendu. */}
                  <AttachmentMedia
                    isImage={(a.mimeType ?? '').startsWith('image/')}
                    label={a.label ?? ''}
                    load={() => attachmentsRepo.attachmentUrl(a.id, a.filePath)}
                    onReveal={() => void audit.logAttachmentRead(a.id)}
                  />
                  <figcaption className="truncate text-xs text-slate-500">{a.label ?? a.kind}</figcaption>
                  <DeleteWithReason onConfirm={async (reason) => { await attachmentsRepo.softDeleteAttachment(a.id, reason); await load(); }} />
                </figure>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
