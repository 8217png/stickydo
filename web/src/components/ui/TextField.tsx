import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  /** 字段错误：标红并朗读给读屏软件 */
  error?: string
  /** 字段下方的说明，有错误时被错误替换 */
  hint?: ReactNode
  /** 标签右侧的附加内容，例如“忘记密码” */
  labelAside?: ReactNode
}

/** 带标签、说明和错误提示的输入框；type="password" 时带“显示密码”开关。 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, labelAside, type = 'text', id, className = '', ...rest },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const noteId = `${inputId}-note`
  const [reveal, setReveal] = useState(false)
  const isPassword = type === 'password'
  const note = error ?? hint

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type={isPassword && reveal ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          className={`h-10 w-full rounded-ui border bg-field px-3 text-[14px] text-ink transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-ink-faint focus:border-focus focus:ring-3 focus:ring-focus/20 ${
            error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-field-border hover:border-field-border-hover'
          } ${isPassword ? 'pr-10' : ''}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? '隐藏密码' : '显示密码'}
            aria-pressed={reveal}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-ui text-ink-faint transition-colors hover:text-ink-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
              <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
              <circle cx="8" cy="8" r="2" />
              {reveal && <path d="M2.5 13.5l11-11" />}
            </svg>
          </button>
        )}
      </div>
      {note && (
        <p id={noteId} role={error ? 'alert' : undefined} className={`text-[12.5px] ${error ? 'text-danger' : 'text-ink-muted'}`}>
          {note}
        </p>
      )}
    </div>
  )
})
