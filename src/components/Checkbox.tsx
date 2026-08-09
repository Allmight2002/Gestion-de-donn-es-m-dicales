import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type ForwardedRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  description?: ReactNode;
  indeterminate?: boolean;
  containerClassName?: string;
}

function assignRef(ref: ForwardedRef<HTMLInputElement>, node: HTMLInputElement | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

/**
 * Case native partagee : la logique metier reste chez l'appelant, tandis que
 * la cible tactile, le focus, les themes et les etats visuels restent coherents.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({
  label,
  description,
  indeterminate = false,
  disabled = false,
  className = '',
  containerClassName = '',
  ...inputProps
}, forwardedRef) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasCopy = label !== undefined || description !== undefined;
  const setInputRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    assignRef(forwardedRef, node);
  }, [forwardedRef]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={`${hasCopy
        ? 'inline-flex min-h-11 items-center gap-2.5 px-2 py-1.5'
        : 'inline-grid h-11 w-11 place-items-center'
      } rounded-lg text-sm transition-colors motion-reduce:transition-none ${disabled
        ? 'cursor-not-allowed opacity-60'
        : 'cursor-pointer hover:bg-slate-100/80 focus-within:bg-slate-100/80 dark:hover:bg-slate-800/70 dark:focus-within:bg-slate-800/70'
      } ${containerClassName}`}
    >
      <input
        {...inputProps}
        ref={setInputRef}
        type="checkbox"
        disabled={disabled}
        className={`h-5 w-5 shrink-0 accent-teal-700 dark:accent-teal-500 ${className}`}
      />
      {hasCopy && (
        <span className="min-w-0 leading-5 text-slate-700 dark:text-slate-200">
          {label}
          {description && <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</span>}
        </span>
      )}
    </label>
  );
});
