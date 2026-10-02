import { describe, expect, it } from 'vitest'
import { docText, docTitle, hasMarkdownTable, markdownTableRow, type NoteDoc } from './doc'

const cell = (type: 'tableHeader' | 'tableCell', text: string) => ({
  type,
  content: [text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }],
})

describe('markdownTableRow', () => {
  it('拆出表头的格子', () => {
    expect(markdownTableRow('| 姓名 | 电话 |')).toEqual(['姓名', '电话'])
    expect(markdownTableRow('  |a|b|c|  ')).toEqual(['a', 'b', 'c'])
    expect(markdownTableRow('| 单列 |')).toEqual(['单列'])
  })
  it('允许空格子和转义的 |', () => {
    expect(markdownTableRow('| a |  | c |')).toEqual(['a', '', 'c'])
    expect(markdownTableRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
  })
  it('不是表格行时返回 null', () => {
    expect(markdownTableRow('普通文字')).toBeNull()
    expect(markdownTableRow('| 只有开头')).toBeNull()
    expect(markdownTableRow('a | b')).toBeNull()
    expect(markdownTableRow('||')).toBeNull()
    expect(markdownTableRow('|  |  |')).toBeNull()
    expect(markdownTableRow('| a \\|')).toBeNull()
  })
  it('分隔行不算表头', () => {
    expect(markdownTableRow('|---|---|')).toBeNull()
    expect(markdownTableRow('| :-- | :-: | --: |')).toBeNull()
  })
})

describe('hasMarkdownTable', () => {
  it('表头后面紧跟分隔行', () => {
    expect(hasMarkdownTable('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true)
    expect(hasMarkdownTable('标题\n\na | b\n--- | ---\n1 | 2')).toBe(true)
    expect(hasMarkdownTable('| a | b |\r\n| :-- | --: |')).toBe(true)
  })
  it('普通文字、只有竖线、列数对不上都不算', () => {
    expect(hasMarkdownTable('买牛奶\n明天')).toBe(false)
    expect(hasMarkdownTable('| a | b |\n| 1 | 2 |')).toBe(false)
    expect(hasMarkdownTable('| a | b |\n|---|')).toBe(false)
    expect(hasMarkdownTable('a | b\n---')).toBe(false)
  })
})

describe('docText 里的表格', () => {
  const doc: NoteDoc = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableHeader', '姓名'), cell('tableHeader', '电话')] },
          { type: 'tableRow', content: [cell('tableCell', '张三'), cell('tableCell', '123')] },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: '备注' }] },
    ],
  }
  it('一行一行，格子之间用制表符', () => {
    expect(docText(doc)).toBe('姓名\t电话\n张三\t123\n备注')
  })
  it('第一块是表格时，表头作为标题', () => {
    expect(docTitle(doc)).toBe('姓名 · 电话')
  })
})
