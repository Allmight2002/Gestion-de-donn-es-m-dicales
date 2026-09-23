import { useI18n } from '../i18n/useI18n';

// Code a recopier avant une suppression de base : affichage + saisie, communs a la mise en
// corbeille (code tire localement) et a la purge definitive (code emis par le serveur).
// Meme alphabet que le challenge serveur : sans 0/O, 1/I/L, pour une lecture sans ambiguite.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomConfirmationCode(length = 5): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export const normalizeConfirmationCode = (value: string) => value.trim().toUpperCase();

interface Props {
  id: string;
  code: string | null;
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
}

export function ConfirmationCode({ id, code, value, disabled, onChange }: Props) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      {code && (
        <p
          className="rounded-lg bg-slate-100 px-3 py-2 text-center font-mono text-lg font-semibold tracking-[0.3em] text-slate-900"
          aria-label={t('base.confirm_code_display')}
        >
          {code}
        </p>
      )}
      <label className="block space-y-1 text-sm font-medium text-slate-700" htmlFor={id}>
        <span>{t('base.confirm_code_label')}</span>
        <input
          id={id}
          className="input w-full"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={5}
          disabled={disabled || !code}
        />
      </label>
    </div>
  );
}
