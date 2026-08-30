import type { ReactNode } from 'react'

interface ViewHeaderProps {
  title: string
  /** Machine-produced context — counts, ids, timestamps. Rendered in mono. */
  meta?: ReactNode
  /** At most one primary action per view. */
  action?: ReactNode
}

export function ViewHeader({ title, meta, action }: ViewHeaderProps) {
  return (
    <header className="mb-6 flex items-end justify-between gap-6 border-b border-border pb-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-text">{title}</h1>
        {meta !== undefined ? <p className="font-mono text-xs text-text-muted">{meta}</p> : null}
      </div>
      {action !== undefined ? <div className="flex items-center gap-2">{action}</div> : null}
    </header>
  )
}
