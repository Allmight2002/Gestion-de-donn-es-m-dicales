import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { parseRule } from '../../domain/templateRules';
import type { RuleSeverity } from '../../data/types';

const PLACEHOLDER = '{"operator":"greater_or_equal","left_field":"discharge_date","right_field":"admission_date"}';

export function RuleForm({
  onSubmit,
  busy,
}: {
  onSubmit: (rule: unknown, message: string, severity: RuleSeverity) => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [json, setJson] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<RuleSeverity>('block');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    // Validation cote client : opérateurs autorisés uniquement (cahier §10).
    const res = parseRule(json);
    if (!res.ok) {
      setError(`${t('admin.rule_invalid')} : ${res.error}`);
      return;
    }
    setError(null);
    onSubmit(res.value, message, severity);
    setJson('');
    setMessage('');
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
      <label className="block text-xs text-slate-600">
        {t('admin.rule_json')}
        <textarea
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
          rows={2}
          placeholder={PLACEHOLDER}
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col text-xs text-slate-600">
          {t('admin.message')}
          <input
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          {t('admin.severity')}
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as RuleSeverity)}
          >
            <option value="block">{t('severity.block')}</option>
            <option value="warn">{t('severity.warn')}</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-teal-700 px-3 py-1 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {t('admin.add_rule')}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
