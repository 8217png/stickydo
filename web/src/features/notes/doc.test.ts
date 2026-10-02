import { describe, expect, it } from 'vitest'
import { docFromText, docText, docTitle } from './doc'
import { markdownToDoc } from './markdown'

describe('markdownToDoc（旧便利贴迁移）', () => {
  it('第一行单独成段，作为标题', () => {
    const d = markdownToDoc('欢迎来到 Sticky-Do\n双击空白处新建')
    expect(d.content?.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
    expect(docTitle(d)).toBe('欢迎来到 Sticky-Do')
    expect(docText(d)).toBe('欢迎来到 Sticky-Do\n双击空白处新建')
  })

  it('任务列表保留勾选状态', () => {
    const d = markdownToDoc('购物清单\n- [x] 牛奶\n- [ ] 鸡蛋')
    const list = d.content?.[1]
    expect(list?.type).toBe('taskList')
    expect(list?.content?.map((i) => i.attrs?.checked)).toEqual([true, false])
    expect(docText(list)).toBe('牛奶\n鸡蛋')
  })

  it('行首 [] 写法也算待办', () => {
    const d = markdownToDoc('[] 买牛奶')
    expect(d.content?.[0].type).toBe('taskList')
  })

  it('粗体、斜体、删除线、行内代码变成 marks', () => {
    const d = markdownToDoc('**粗** *斜* ~~删~~ `码`')
    const marks = d.content?.[0].content?.flatMap((n) => n.marks?.map((m) => m.type) ?? [])
    expect(marks).toEqual(expect.arrayContaining(['bold', 'italic', 'strike', 'code']))
  })

  it('标题、引用、有序列表', () => {
    const d = markdownToDoc('# 大标题\n> 引用\n\n1. 一\n2. 二')
    expect(d.content?.map((b) => b.type)).toEqual(['heading', 'blockquote', 'orderedList'])
  })

  it('空内容', () => {
    expect(docText(markdownToDoc(''))).toBe('')
  })
})

describe('docFromText', () => {
  it('每行一段，合并连续空行', () => {
    const d = docFromText('a\nb\n\n\n\nc')
    expect(docText(d)).toBe('a\nb\n\nc')
  })
})

describe('trimDoc', () => {
  it('去掉末尾空段落，至少保留一个块', async () => {
    const { trimDoc, emptyDoc } = await import('./doc')
    const d = docFromText('a')
    const padded = { ...d, content: [...(d.content ?? []), { type: 'paragraph' }, { type: 'paragraph' }] }
    expect(trimDoc(padded).content).toHaveLength(1)
    expect(trimDoc(emptyDoc()).content).toHaveLength(1)
  })
})
