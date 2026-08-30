import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** Shown beneath the field. Colour never carries the error on its own. */
  error?: string
  /** Machine-produced content — targets, variable names — renders in mono. */
  mono?: boolean
}

export function Input({ label, error, mono = false, className, id, ...rest }: InputProps) {
  const invalid = error !== undefined
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1" htmlFor={id}>
      <span className="font-mono text-xs text-text-faint">{label}</span>
      <input
        id={id}
        aria-invalid={invalid}
        className={[
          'h-control w-full rounded-sm border bg-surface px-3 text-sm text-text transition-colors duration-fast ease-crewmate placeholder:text-text-faint focus:border-border-strong',
          invalid ? 'border-danger' : 'border-border',
          mono ? 'font-mono text-xs' : '',
          className ?? '',
        ]
          .join(' ')
          .trim()}
        {...rest}
      />
      {invalid ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  )
}
