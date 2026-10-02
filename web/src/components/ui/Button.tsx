import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover shadow-chrome',
  secondary: 'border border-field-border bg-field text-ink hover:border-field-border-hover',
  ghost: 'text-ink-muted hover:bg-chrome-hover hover:text-ink',
}

const SIZE: Record<Size, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-[13px]',
  md: 'h-10 gap-2 rounded-ui px-4 text-[14px]',
  lg: 'h-11 gap-2 rounded-ui px-5 text-[15px]',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** 提交中：显示转圈并禁用，宽度不变 */
  loading?: boolean
  block?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`relative inline-flex items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100 ${VARIANT[variant]} ${SIZE[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {/* 转圈叠在文字上方，文字保持占位，按钮宽度不跳动 */}
      <span className={`inline-flex items-center gap-[inherit] ${loading ? 'invisible' : ''}`}>
        {icon}
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner />
        </span>
      )}
    </button>
  )
}
