import { errorMessage } from '../../lib/errorMessage';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useAttachmentRepository } from '../../data/RepositoryProvider';
import { validateAttachmentFile, ALLOWED_ATTACHMENT_ACCEPT } from '../../domain/imageUpload';
import { Checkbox } from '../../components/Checkbox';

// Ecran "Ajouter un document" (cahier §8.8, §14) : images (jpg/png/webp), PDF et Office.
// Un fichier a la fois, LIBELLE obligatoire, case de deidentification OBLIGATOIRE. Les
// images sont reencodees (EXIF supprime) cote repo ; les autres envoyees telles quelles.
export function AddImage() {
  const { id: baseId, patientId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const attachments = useAttachmentRepository();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [masking, setMasking] = useState(false);

  // Chaque createObjectURL reserve de la memoire jusqu'a revocation explicite : on revoque
  // l'apercu PRECEDENT a chaque remplacement, et le dernier au demontage (audit externe).
  useEffect(() => {
    if (!preview) return;
    return () => {
      try { URL.revokeObjectURL(preview); } catch { /* environnement sans createObjectURL */ }
    };
  }, [preview]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setPreview(null);
    if (!f) {
      setFile(null);
      return;
    }
    const v = validateAttachmentFile(f);
    if (!v.ok) {
      setError(v.error);
      setFile(null);
      return;
    }
    setError(null);
    setFile(f);
    if (v.isImage) {
      try {
        setPreview(URL.createObjectURL(f));
      } catch {
        setPreview(null);
      }
    }
  }

  const canSend = !!file && !!label.trim() && masking;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !patientId || !file) return;
    if (!label.trim()) {
      setError(t('image.label_required'));
      return;
    }
    if (!masking) {
      setError(t('image.masking_required'));
      return;
    }
    setBusy(true);
    try {
      await attachments.addImage({ patientId, baseId, file, label: label.trim(), deidentificationConfirmed: true });
      navigate(`/bases/${baseId}/patients/${patientId}`);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-lg space-y-5">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}/patients/${patientId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('image.new_title')}</h1>
      </div>

      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{t('image.note')}</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">{t('image.file')}</span>
          <input
            type="file"
            accept={ALLOWED_ATTACHMENT_ACCEPT}
            onChange={onFile}
            className="mt-1 block w-full text-sm"
          />
          <span className="text-xs text-slate-400">{t('image.formats_hint')}</span>
        </label>

        {preview ? (
          <div>
            <span className="text-xs text-slate-500">{t('image.preview')}</span>
            <img src={preview} alt={t('image.preview')} className="mt-1 max-h-48 rounded-xl border border-slate-200" />
          </div>
        ) : (
          file && <p className="text-xs text-slate-500">📄 {file.name}</p>
        )}

        <label className="block text-sm">
          <span className="text-slate-700">
            {t('image.label')} <span className="text-red-500">*</span>
          </span>
          <input
            className="input mt-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
          />
        </label>

        <div className="rounded-xl border border-amber-300 bg-amber-50 p-2">
          <Checkbox
            checked={masking}
            onChange={(e) => setMasking(e.target.checked)}
            label={<span className="font-medium text-amber-900">{t('image.masking_confirm')}</span>}
            containerClassName="w-full hover:bg-amber-100/70 focus-within:bg-amber-100/70"
          />
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={busy || !canSend} className="btn-primary">
            {t('image.save')}
          </button>
          <button type="button" onClick={() => navigate(`/bases/${baseId}/patients/${patientId}`)} className="btn-secondary">
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </section>
  );
}
