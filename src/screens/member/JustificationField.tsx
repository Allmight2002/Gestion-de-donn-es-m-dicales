import { useI18n } from '../../i18n/useI18n';

/**
 * Motif d'audit d'une correction autorisée.
 *
 * Le champ reste le même pour tout le monde ; seule l'EXIGENCE change. Le propriétaire réel de
 * la base, vérifié par le serveur, peut enregistrer sans rédiger de texte (spécification §4.5).
 * L'écran ne réclame alors plus l'astérisque et dit ce qui continue d'être journalisé ; il
 * n'envoie jamais de motif fabriqué à la place de l'utilisateur.
 */
export function JustificationField({ value, onChange, optional, disabled }: {
  value: string;
  onChange: (value: string) => void;
  optional: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col">
      <label className="flex flex-col text-sm">
        <span className="font-medium text-slate-700">
          {t('encounter.reason')}
          {optional
            ? <span className="ml-2 text-xs font-normal text-slate-500">{t('justification.owner_optional')}</span>
            : <span className="text-red-500"> *</span>}
        </span>
        <input className="input mt-1" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      </label>
      {optional && <p className="mt-1 text-xs text-slate-500">{t('justification.owner_optional_hint')}</p>}
    </div>
  );
}
