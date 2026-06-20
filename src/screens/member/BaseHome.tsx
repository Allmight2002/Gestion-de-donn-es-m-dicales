import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { BaseListing } from '../../data/bases';
import type { PatientListItem } from '../../data/patients';
import type { TemplateField } from '../../data/types';

const PAGE_SIZE = 20;

// Accueil d'une base : informations + tableau des patients (cahier §8.4), pagine.
// La fiche patient complete, les rencontres et l'export arrivent aux etapes 8+.
export function BaseHome() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();

  const [listing, setListing] = useState<BaseListing | null>(null);
  const [rows, setRows] = useState<PatientListItem[]>([]);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const b = await bases.getBase(id);
      setListing(b);
      if (b?.base.currentTemplateVersionId) {
        const version = await templates.getVersion(b.base.currentTemplateVersionId);
        setFields(version.fields.filter((f) => f.scope === 'patient').sort((a, b2) => a.displayOrder - b2.displayOrder));
      }
      const pageRes = await patients.listPatientsPage(id, PAGE_SIZE, page * PAGE_SIZE);
      setRows(pageRes.rows);
      setTotal(pageRes.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, page, bases, templates, patients]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;
  if (!listing) return <p className="text-slate-500">{t('notfound.title')}</p>;

  return (
    <section className="space-y-5">
      <button onClick={() => navigate('/')} className="text-sm font-medium text-slate-500 hover:text-teal-700">
        ← {t('base.back_to_dashboard')}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="page-title">{listing.base.name}</h1>
          <span className="badge">{t(`baserole.${listing.role}`)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {listing.role === 'owner' && (
            <button onClick={() => navigate(`/bases/${id}/template`)} className="btn-secondary">
              {t('basetemplate.edit')}
            </button>
          )}
          {listing.role === 'owner' && (
            <button onClick={() => navigate(`/bases/${id}/access`)} className="btn-secondary">
              {t('access.manage')}
            </button>
          )}
          {listing.role === 'owner' && (
            <button onClick={() => navigate(`/bases/${id}/curation`)} className="btn-secondary">
              {t('curation.board')}
            </button>
          )}
          {(listing.role === 'owner' || listing.permissions.canExportData || listing.permissions.canEditStructuredData) && (
            <button onClick={() => navigate(`/bases/${id}/cohorts`)} className="btn-secondary">
              {t('cohort.build')}
            </button>
          )}
          {(listing.role === 'owner' || listing.permissions.canEditStructuredData) && (
            <button onClick={() => navigate(`/bases/${id}/patients/new`)} className="btn-primary">
              + {t('patient.new')}
            </button>
          )}
        </div>
      </div>

      <div className="text-sm text-slate-500">
        {t('base.gabarit')} : {listing.templateName ? `${listing.templateName} v${listing.versionNumber}` : '—'}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('patient.list_title')}</h2>
        {rows.length === 0 ? (
          <div className="card border-dashed p-10 text-center text-slate-500">{t('patient.no_patients')}</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">{t('patient.code')}</th>
                  <th className="px-4 py-2.5">{t('patient.full_name')}</th>
                  {fields.map((f) => (
                    <th key={f.id} className="px-4 py-2.5">{f.label}</th>
                  ))}
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0 transition hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      <button onClick={() => navigate(`/bases/${id}/patients/${p.id}`)} className="font-medium text-teal-700 hover:text-teal-800 hover:underline">
                        {p.code}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      {p.identity ? p.identity.fullName : <span className="text-slate-400">{t('patient.name_hidden')}</span>}
                    </td>
                    {fields.map((f) => (
                      <td key={f.id} className="px-4 py-2.5">{formatCell(p.data[f.fieldKey])}</td>
                    ))}
                    <td className="px-4 py-2.5 text-right">
                      {(listing.role === 'owner' || listing.permissions.canEditStructuredData) && (
                        <button
                          onClick={() => navigate(`/bases/${id}/patients/${p.id}/encounters/new`)}
                          className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline"
                        >
                          + {t('encounter.add')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} {t('pager.of')} {total}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100 disabled:opacity-50"
              >
                {t('pager.prev')}
              </button>
              <button
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100 disabled:opacity-50"
              >
                {t('pager.next')}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  return String(v);
}
