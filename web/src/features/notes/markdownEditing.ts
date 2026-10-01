/**
 * 纯文本框里的 Markdown 快捷输入（docs/frontend-design.md §2.2）。
 * 通过 execCommand('insertText') 修改内容，保留浏览器原生的撤销（Ctrl+Z）。
 */

const LIST_PREFIX = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) )/

function replaceRange(el: HTMLTextAreaElement, start: number, end: number, text: string, caret?: number) {
  el.focus()
  el.setSelectionRange(start, end)
  // 删除用 'delete'：Chrome 里插入空字符串后光标位置不可靠
  const ok =
    text === '' && start === end
      ? true
      : document.execCommand?.(text === '' ? 'delete' : 'insertText', false, text)
  if (!ok) {
    el.setRangeText(text, start, end, 'end')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const at = caret ?? start + text.length
  el.setSelectionRange(at, at)
}

function currentLine(el: HTMLTextAreaElement) {
  const v = el.value
  const pos = el.selectionStart
  const start = v.lastIndexOf('\n', pos - 1) + 1
  const endIdx = v.indexOf('\n', pos)
  const end = endIdx === -1 ? v.length : endIdx
  return { start, end, text: v.slice(start, end), before: v.slice(start, pos) }
}

function wrapSelection(el: HTMLTextAreaElement, mark: string) {
  const { selectionStart: a, selectionEnd: b, value } = el
  const sel = value.slice(a, b)
  // 已经包着就去掉
  if (value.slice(a - mark.length, a) === mark && value.slice(b, b + mark.length) === mark) {
    replaceRange(el, a - mark.length, b + mark.length, sel)
    el.setSelectionRange(a - mark.length, b - mark.length)
    return
  }
  replaceRange(el, a, b, `${mark}${sel}${mark}`)
  el.setSelectionRange(a + mark.length, b + mark.length)
}

/** 处理按键；返回 true 表示已处理（调用方应 preventDefault） */
export function handleMarkdownKey(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.nativeEvent.isComposing) return false
  const el = e.currentTarget
  const mod = e.metaKey || e.ctrlKey

  if (mod && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
    wrapSelection(el, '**')
    return true
  }
  if (mod && !e.shiftKey && !e.altKey && (e.key === 'i' || e.key === 'I')) {
    wrapSelection(el, '*')
    return true
  }
  if (mod || e.altKey) return false

  const collapsed = el.selectionStart === el.selectionEnd
  const line = currentLine(el)

  // 行首输入 [] 或 [ ] 再按空格 → 待办项 “- [ ] ”
  if (e.key === ' ' && collapsed && /^\s*\[ ?\]$/.test(line.before)) {
    const indent = line.before.match(/^\s*/)![0]
    replaceRange(el, line.start, el.selectionStart, `${indent}- [ ] `)
    return true
  }

  // 列表里回车：自动续上前缀；空项回车则结束列表
  if (e.key === 'Enter' && !e.shiftKey && collapsed) {
    const m = LIST_PREFIX.exec(line.text)
    if (!m || line.before.length < m[0].length) return false
    if (line.text.slice(m[0].length).trim() === '') {
      replaceRange(el, line.start, line.end, '')
      return true
    }
    const [, indent, prefix, num, delim] = m
    const next = num ? `${Number(num) + 1}${delim} ` : prefix.replace(/\[[xX]\]/, '[ ]')
    replaceRange(el, el.selectionStart, el.selectionStart, `\n${indent}${next}`)
    return true
  }

  // 列表行里 Tab / Shift+Tab：缩进 / 取消缩进
  if (e.key === 'Tab' && collapsed && LIST_PREFIX.test(line.text)) {
    const pos = el.selectionStart
    if (e.shiftKey) {
      const n = line.text.startsWith('  ') ? 2 : line.text.startsWith(' ') ? 1 : 0
      if (n) replaceRange(el, line.start, line.start + n, '', pos - n)
    } else {
      replaceRange(el, line.start, line.start, '  ', pos + 2)
    }
    return true
  }

  return false
}
