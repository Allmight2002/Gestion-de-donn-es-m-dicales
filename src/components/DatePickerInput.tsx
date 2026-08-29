import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function localDate(parts: DateParts): Date {
  // setFullYear avoids Date's special handling of years 0–99 in the constructor.
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(parts.year, parts.month, parts.day);
  return date;
}

function todayParts(): DateParts {
  const today = new Date();
  return { year: today.getFullYear(), month: today.getMonth(), day: today.getDate() };
}

function parseIsoDate(value: string | null | undefined): DateParts | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
  const date = localDate(parts);
  return date.getFullYear() === parts.year && date.getMonth() === parts.month && date.getDate() === parts.day
    ? parts
    : null;
}

function toIsoDate(parts: DateParts): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month + 1).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const date = localDate({ year, month, day: 1 });
  date.setMonth(date.getMonth() + delta);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function localeFor(lang: string): string {
  return lang === 'fr' ? 'fr-FR' : 'en-GB';
}

/**
 * Calendrier de saisie interne pour une date seule.
 *
 * Le navigateur ne permet pas de demander au widget natif `date` d'adopter le
 * rendu de `datetime-local` sans afficher aussi l'heure. Ce composant garde le
 * format metier ISO YYYY-MM-DD tout en rendant explicitement le mois et l'annee.
 */
export function DatePickerInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  ariaLabel: string;
}) {
  const { lang, t } = useI18n();
  const locale = localeFor(lang);
  const selected = parseIsoDate(value);
  const [open, setOpen] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => {
    const initial = selected ?? todayParts();
    return { year: initial.year, month: initial.month };
  });
  const [draft, setDraft] = useState(() => {
    const initial = selected ?? todayParts();
    return {
      day: String(initial.day),
      month: String(initial.month + 1),
      year: String(initial.year),
    };
  });
  const [draftError, setDraftError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  const dateFormatter = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    // 2024-01-01 is a Monday, so the grid always starts on Monday.
    const date = new Date(2024, 0, index + 1, 12);
    return weekdayFormatter.format(date);
  });

  useEffect(() => {
    if (!open) return;
    const current = parseIsoDate(value) ?? todayParts();
    setDisplayMonth({ year: current.year, month: current.month });
    setDraft({ day: String(current.day), month: String(current.month + 1), year: String(current.year) });
    setDraftError(false);
    dialogRef.current?.focus();
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const monthStart = localDate({ year: displayMonth.year, month: displayMonth.month, day: 1 });
  const firstWeekday = (monthStart.getDay() + 6) % 7;
  const daysInMonth = localDate({ year: displayMonth.year, month: displayMonth.month + 1, day: 0 }).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const today = todayParts();
  const displayValue = selected
    ? dateFormatter.format(localDate(selected))
    : value || t('date.choose');

  function chooseDate(day: number) {
    onChange(toIsoDate({ year: displayMonth.year, month: displayMonth.month, day }));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function applyDraftDate() {
    const parts = {
      day: Number(draft.day),
      month: Number(draft.month) - 1,
      year: Number(draft.year),
    };
    const date = localDate(parts);
    const valid = /^\d{1,2}$/.test(draft.day)
      && /^\d{1,2}$/.test(draft.month)
      && /^\d{4}$/.test(draft.year)
      && date.getFullYear() === parts.year
      && date.getMonth() === parts.month
      && date.getDate() === parts.day;
    if (!valid) {
      setDraftError(true);
      return;
    }
    onChange(toIsoDate(parts));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function clearDate() {
    onChange(null);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        ref={triggerRef}
        className="input flex items-center justify-between gap-2 text-left"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`min-w-0 truncate ${selected ? 'text-slate-700 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>
          {displayValue}
        </span>
        <CalendarDays size={18} aria-hidden className="shrink-0 text-slate-500 dark:text-slate-400" />
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
          aria-label={t('date.picker_label')}
          className="absolute left-0 top-full z-50 mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:w-80"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{t('date.picker_label')}</p>
              <p className="mt-1 truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                {selected ? dateFormatter.format(localDate(selected)) : t('date.no_date')}
              </p>
            </div>
            <button type="button" className="icon-button h-9 w-9 shrink-0" aria-label={t('common.cancel')} onClick={() => setOpen(false)}>
              <X size={17} aria-hidden />
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              className="icon-button h-10 w-10 shrink-0"
              aria-label={t('date.previous_month')}
              onClick={() => setDisplayMonth((current) => shiftMonth(current.year, current.month, -1))}
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <p className="text-center text-sm font-semibold capitalize text-slate-900 dark:text-slate-100" aria-live="polite">
              {monthFormatter.format(monthStart)}
            </p>
            <button
              type="button"
              className="icon-button h-10 w-10 shrink-0"
              aria-label={t('date.next_month')}
              onClick={() => setDisplayMonth((current) => shiftMonth(current.year, current.month, 1))}
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>

          <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('date.direct_entry')}</p>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-300">
                {t('date.day')}
                <input
                  className="input mt-1 text-center"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.day}
                  onChange={(event) => { setDraft((current) => ({ ...current, day: event.target.value.replace(/\D/g, '').slice(0, 2) })); setDraftError(false); }}
                  aria-invalid={draftError}
                />
              </label>
              <label className="text-xs text-slate-600 dark:text-slate-300">
                {t('date.month')}
                <input
                  className="input mt-1 text-center"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.month}
                  onChange={(event) => { setDraft((current) => ({ ...current, month: event.target.value.replace(/\D/g, '').slice(0, 2) })); setDraftError(false); }}
                  aria-invalid={draftError}
                />
              </label>
              <label className="text-xs text-slate-600 dark:text-slate-300">
                {t('date.year')}
                <input
                  className="input mt-1 text-center"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.year}
                  onChange={(event) => { setDraft((current) => ({ ...current, year: event.target.value.replace(/\D/g, '').slice(0, 4) })); setDraftError(false); }}
                  aria-invalid={draftError}
                />
              </label>
            </div>
            {draftError && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{t('date.invalid')}</p>}
            <button type="button" className="btn-primary mt-3 w-full" onClick={applyDraftDate}>
              {t('date.apply')}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-slate-400 dark:text-slate-500">
            {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: cellCount }, (_, index) => {
              const day = index - firstWeekday + 1;
              if (day < 1 || day > daysInMonth) {
                return <span key={`empty-${index}`} className="h-10" aria-hidden />;
              }
              const isSelected = selected?.year === displayMonth.year
                && selected.month === displayMonth.month
                && selected.day === day;
              const isToday = today.year === displayMonth.year && today.month === displayMonth.month && today.day === day;
              const parts = { year: displayMonth.year, month: displayMonth.month, day };
              return (
                <button
                  key={day}
                  type="button"
                  className={`h-10 w-full rounded-lg text-sm font-medium transition ${isSelected
                    ? 'bg-teal-700 text-white hover:bg-teal-800'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                  } ${isToday && !isSelected ? 'ring-1 ring-inset ring-teal-600/60 dark:ring-teal-400/70' : ''}`}
                  aria-label={dateFormatter.format(localDate(parts))}
                  aria-pressed={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                  onClick={() => chooseDate(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-2 dark:border-slate-700">
            <button type="button" className="btn-ghost min-h-9 px-2 text-xs" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            {selected && (
              <button type="button" className="btn-ghost min-h-9 px-2 text-xs text-red-600 dark:text-red-400" onClick={clearDate}>
                {t('date.clear')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
