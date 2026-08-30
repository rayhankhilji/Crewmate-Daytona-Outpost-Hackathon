import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger'
export type ButtonSize = 'default' | 'launch'

const BASE =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-sm border font-medium transition-colors duration-fast ease-crewmate disabled:cursor-not-allowed disabled:opacity-40'

const VARIANT: Record<ButtonVariant, string> = {
  // Exactly one primary button is visible per view: graphite on cream.
  primary: 'border-action bg-action text-action-text shadow-card hover:opacity-90',
  secondary: 'border-border bg-surface text-text shadow-card hover:bg-surface-raised',
  danger: 'border-danger bg-surface text-danger shadow-card hover:bg-danger-tint',
}

const SIZE: Record<ButtonSize, string> = {
  default: 'h-control px-3 text-sm',
  launch: 'h-control-lg px-6 text-sm',
}

function classesFor(variant: ButtonVariant, size: ButtonSize, extra: string | undefined): string {
  return [BASE, VARIANT[variant], SIZE[size], extra ?? ''].join(' ').trim()
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'default',
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={classesFor(variant, size, className)} {...rest}>
      {children}
    </button>
  )
}

interface ButtonLinkProps {
  href: string
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  children: ReactNode
}

/** Same visual contract as Button, for actions that are a navigation. */
export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'default',
  className,
  children,
}: ButtonLinkProps) {
  return (
    <a href={href} className={classesFor(variant, size, className)}>
      {children}
    </a>
  )
}
