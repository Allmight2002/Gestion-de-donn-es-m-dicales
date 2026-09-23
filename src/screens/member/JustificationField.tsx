import { useI18n } from '../../i18n/useI18n';

/**
 * Motif d'audit d'une correction autorisée, facultatif pour tous : le serveur journalise
 * l'auteur, la date et les valeurs, avec ou sans texte. Aucun motif n'est fabriqué à la place
 * de l'utilisateur.
 */
export function JustificationField({ value, onChange, disabled }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col">
      <label className="flex flex-col text-sm">
        <span className="font-medium text-slate-700">
          {t('encounter.reason')}
          <span className="ml-2 text-xs font-normal text-slate-500">{t('justification.optional')}</span>
        </span>
        <input className="input mt-1" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      </label>
    </div>
  );
}
