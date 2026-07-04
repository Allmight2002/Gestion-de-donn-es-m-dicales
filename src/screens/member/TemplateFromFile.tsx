import { errorMessage } from '../../lib/errorMessage';
import { useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import type { FieldScope, FieldSection, FieldType, NewField } from '../../data/types';
import { parseSpreadsheetOffThread } from '../../domain/spreadsheet';
import { proposeFieldsFromSheet, type ProposedField } from '../../domain/templateFromSheet';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo : on ne lit qu'une STRUCTURE, pas un gros jeu de donnees
const TYPES: FieldType[] = ['text', 'integer', 'number', 'date', 'datetime', 'boolean', 'select', 'multiselect'];
const SCOPES: FieldScope[] = ['patient', 'encounter'];
const SECTIONS: FieldSection[] = ['clinique', 'biologie', 'paraclinique'];

// F1 — Assistant « creer un gabarit depuis mon Excel » : on lit le fichier existant du medecin, on
// propose les variables detectees (type infere), il ajuste et valide -> un gabarit personnel.
export function TemplateFromFile() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const templates = useTemplateRepository();

  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [fields, setFields] = useState<ProposedField[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const msg = (e: unknown) => errorMessage(e, t('common.error'));
  const patch = (i: number, p: Partial<ProposedField>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)));

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setError(t('tfile.too_large')); return; }
    setBusy(true);
    try {
      const parsed = await parseSpreadsheetOffThread(await file.arrayBuffer());
      const proposed = proposeFieldsFromSheet(parsed.headers, parsed.rows);
      setFields(proposed);
      setFileName(file.name);
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, '')); // pre-remplit le nom du gabarit
      setError(proposed.length === 0 ? t('tfile.no_columns') : null);
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const chosen = fields.filter((f) => f.include);
    if (!name.trim() || chosen.length === 0) { setError(t('tfile.need_name_fields')); return; }
    setBusy(true);
    try {
      const version = await templates.createPersonalTemplate(name.trim(), specialty.trim() || null);
      for (const f of chosen) {
        const field: NewField = {
          fieldKey: f.fieldKey, label: f.label, scope: f.scope, section: f.section, type: f.type, required: false,
          allowedValues: (f.type === 'select' || f.type === 'multiselect') ? (f.allowedValues ?? null) : null,
        };
        await templates.addField(version.id, field);
      }
      navigate('/templates');
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-3xl space-y-5">
      <div>
        <button onClick={() => navigate('/templates')} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('mytemplates.title')}</button>
        <h1 className="page-title mt-2">{t('tfile.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('tfile.subtitle')}</p>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="card space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col">
            <span className="text-slate-700">{t('tfile.name')}</span>
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="text-slate-700">{t('admin.specialty')}</span>
            <input className="input mt-1" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col text-sm">
          <span className="text-slate-700">{t('tfile.file')}</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => void onFile(e)} className="mt-1 text-sm" />
          {fileName && <span className="mt-1 text-xs text-slate-400">{fileName} — {fields.length} {t('tfile.columns')}</span>}
        </label>
      </div>

      {fields.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-2 py-1">{t('tfile.include')}</th>
                  <th className="px-2 py-1">{t('tfile.label')}</th>
                  <th className="px-2 py-1">{t('tfile.type')}</th>
                  <th className="px-2 py-1">{t('tfile.scope')}</th>
                  <th className="px-2 py-1">{t('tfile.section')}</th>
                  <th className="px-2 py-1">{t('tfile.samples')}</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={i} className={`border-t border-slate-100 ${f.include ? '' : 'opacity-40'}`}>
                    <td className="px-2 py-1"><input type="checkbox" checked={f.include} onChange={(e) => patch(i, { include: e.target.checked })} /></td>
                    <td className="px-2 py-1"><input className="input w-40 py-1" value={f.label} onChange={(e) => patch(i, { label: e.target.value })} /></td>
                    <td className="px-2 py-1">
                      <select className="input py-1" value={f.type} onChange={(e) => patch(i, { type: e.target.value as FieldType })}>
                        {TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select className="input py-1" value={f.scope} onChange={(e) => patch(i, { scope: e.target.value as FieldScope })}>
                        {SCOPES.map((x) => <option key={x} value={x}>{t(`scope.${x}`)}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select className="input py-1" value={f.section} onChange={(e) => patch(i, { section: e.target.value as FieldSection })}>
                        {SECTIONS.map((x) => <option key={x} value={x}>{t(`section.${x}`)}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-slate-400">{f.samples.join(', ')}{f.type === 'select' && f.allowedValues ? ` (${f.allowedValues.length})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={() => void create()} disabled={busy} className="btn-primary">
            {t('tfile.create')} ({fields.filter((f) => f.include).length})
          </button>
        </>
      )}
    </section>
  );
}
