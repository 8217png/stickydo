import { describe, expect, it } from 'vitest'
import { dueStatus, formatDue, parseCapture } from './parse'

// 固定“现在”：2026-10-02 周五 10:00
const NOW = new Date(2026, 9, 2, 10, 0)
const p = (s: string) => parseCapture(s, NOW)

describe('便利贴还是待办', () => {
  it('普通文字是便利贴，原样保留，不做任何识别', () => {
    const c = p('买牛奶 明天下午3点 !高 #生活')
    expect(c).toMatchObject({ kind: 'note', title: '买牛奶 明天下午3点 !高 #生活', tags: [], priority: 0 })
    expect(c.due).toBeUndefined()
    expect(c.tokens).toEqual([])
  })

  it('[] / [ ] / - [ ] 开头是待办', () => {
    for (const s of ['[] 买牛奶', '[ ] 买牛奶', '- [ ] 买牛奶', '[]买牛奶']) {
      expect(p(s)).toMatchObject({ kind: 'todo', title: '买牛奶' })
    }
  })
})

describe('设计文档里的例子', () => {
  it('[] 买牛奶 明天下午3点 !高 #生活', () => {
    const c = p('[] 买牛奶 明天下午3点 !高 #生活')
    expect(c).toMatchObject({ kind: 'todo', title: '买牛奶', due: { date: '2026-10-03', time: '15:00' }, priority: 3, tags: ['生活'] })
    // 高亮区间对应原文
    const src = '[] 买牛奶 明天下午3点 !高 #生活'
    expect(c.tokens.map((t) => [t.kind, src.slice(t.start, t.end), t.label])).toEqual([
      ['todo', '[] ', '待办'],
      ['due', '明天下午3点', '明天 15:00'],
      ['priority', '!高', '高'],
      ['tag', '#生活', '#生活'],
    ])
  })
})

describe('时间', () => {
  const due = (s: string) => p(`[] 事情 ${s}`).due
  it.each([
    ['明天', { date: '2026-10-03' }],
    ['后天上午10点半', { date: '2026-10-04', time: '10:30' }],
    ['今晚8点', { date: '2026-10-02', time: '20:00' }],
    ['下周一', { date: '2026-10-05' }],
    ['下周三下午两点', { date: '2026-10-07', time: '14:00' }],
    ['3天后', { date: '2026-10-05' }],
    ['10月5日 14:30', { date: '2026-10-05', time: '14:30' }],
    ['明天15:00', { date: '2026-10-03', time: '15:00' }],
    ['2026-10-20', { date: '2026-10-20' }],
    ['星期天', { date: '2026-10-04' }],
    ['礼拜三', { date: '2026-10-07' }],
  ])('%s', (s, want) => {
    expect(due(s)).toEqual(want)
  })

  it('没说上午下午的 1–7 点按下午', () => {
    expect(due('明天2点')).toEqual({ date: '2026-10-03', time: '14:00' })
    expect(due('明天凌晨2点')).toEqual({ date: '2026-10-03', time: '02:00' })
    expect(due('明天9点')).toEqual({ date: '2026-10-03', time: '09:00' })
  })

  it('本周五 / 这周五 把前缀一起识别；下下周一 再加一周', () => {
    const c = p('[] 交周报 本周五')
    expect(c.due).toEqual({ date: '2026-10-02' })
    expect(c.title).toBe('交周报')
    expect(p('[] 复盘 下下周一').due).toEqual({ date: '2026-10-12' })
    expect(p('[] 复盘 下下周一').title).toBe('复盘')
  })

  it('chrono 不认识的说法：周末、月底、N号、下个月N号', () => {
    expect(due('周末')).toEqual({ date: '2026-10-03' })
    expect(due('月底')).toEqual({ date: '2026-10-31' })
    expect(p('[] 5号交房租').due).toEqual({ date: '2026-10-05' })
    expect(p('[] 5号交房租').title).toBe('交房租')
    expect(due('1号')).toEqual({ date: '2026-11-01' }) // 本月 1 号已过 → 下个月
    expect(due('下个月1号')).toEqual({ date: '2026-11-01' })
    expect(due('下月十五日')).toEqual({ date: '2026-11-15' })
    expect(due('5号下午3点')).toEqual({ date: '2026-10-05', time: '15:00' })
  })

  it('只说几点：1–7 点按下午算，还没到就是今天，过了就是明天', () => {
    // NOW 是 10:00
    expect(due('3点')).toEqual({ date: '2026-10-02', time: '15:00' })
    expect(due('15:30')).toEqual({ date: '2026-10-02', time: '15:30' })
    expect(due('9点')).toEqual({ date: '2026-10-03', time: '09:00' })
    expect(parseCapture('[] a 3点', new Date(2026, 9, 2, 16, 0)).due).toEqual({ date: '2026-10-03', time: '15:00' })
    expect(due('今晚8点半')).toEqual({ date: '2026-10-02', time: '20:30' })
  })

  it('不是时间的不识别', () => {
    for (const s of ['买3个苹果', '读三体', '看第二集', '坐1号线', '5号楼开会', '三月份计划', '第一周总结', '周报', '一天学会', '春节回家']) {
      const c = p(`[] ${s}`)
      expect(c.due, s).toBeUndefined()
      expect(c.title, s).toBe(s)
    }
  })

  it('英文也能识别', () => {
    expect(due('tomorrow 3pm')).toEqual({ date: '2026-10-03', time: '15:00' })
  })

  it('标题里没有空格也能拆出来', () => {
    expect(p('[] 明天下午3点开会')).toMatchObject({ title: '开会', due: { date: '2026-10-03', time: '15:00' } })
  })
})

describe('优先级', () => {
  it.each([
    ['!高', 3], ['!中', 2], ['!低', 1], ['!!!', 3], ['!!', 2], ['!high', 3], ['!med', 2], ['!low', 1], ['！高', 3],
  ])('%s', (s, want) => {
    expect(p(`[] 事情 ${s}`).priority).toBe(want)
  })

  it('句末的感叹号不算优先级', () => {
    const c = p('[] 别忘了买牛奶!')
    expect(c.priority).toBe(0)
    expect(c.title).toBe('别忘了买牛奶!')
  })

  it('多个时以最后一个为准', () => {
    expect(p('[] 事情 !低 !高').priority).toBe(3)
  })
})

describe('标签', () => {
  it('多个标签，去重，保留顺序', () => {
    const c = p('[] 读书 #学习 #生活 #学习')
    expect(c.tags).toEqual(['学习', '生活'])
    expect(c.title).toBe('读书')
  })

  it('C# 这种不是标签', () => {
    const c = p('[] 学 C# 编程')
    expect(c.tags).toEqual([])
    expect(c.title).toBe('学 C# 编程')
  })

  it('全角 ＃ 也可以', () => {
    expect(p('[] 跑步 ＃运动').tags).toEqual(['运动'])
  })

  it('标签里的时间词不会被当成时间', () => {
    const c = p('[] 整理 #明天要做')
    expect(c.tags).toEqual(['明天要做'])
    expect(c.due).toBeUndefined()
  })
})

describe('显示', () => {
  it('formatDue', () => {
    expect(formatDue({ date: '2026-10-02', time: '15:00' }, NOW)).toBe('今天 15:00')
    expect(formatDue({ date: '2026-10-03' }, NOW)).toBe('明天')
    expect(formatDue({ date: '2026-10-04' }, NOW)).toBe('后天')
    expect(formatDue({ date: '2026-10-07' }, NOW)).toBe('周三')
    expect(formatDue({ date: '2026-10-20' }, NOW)).toBe('10月20日')
    expect(formatDue({ date: '2027-01-03' }, NOW)).toBe('2027年1月3日')
    expect(formatDue({ date: '2026-10-01' }, NOW)).toBe('昨天')
  })

  it('dueStatus：只有日期的过了当天才算逾期', () => {
    expect(dueStatus({ date: '2026-10-02' }, NOW)).toBe('today')
    expect(dueStatus({ date: '2026-10-02', time: '09:00' }, NOW)).toBe('overdue')
    expect(dueStatus({ date: '2026-10-01' }, NOW)).toBe('overdue')
    expect(dueStatus({ date: '2026-10-03' }, NOW)).toBe('upcoming')
  })
})

describe('存储格式与正文', async () => {
  const { dueFromAttr, dueToAttr } = await import('./parse')
  const { captureToDoc, todoMeta } = await import('./todo')

  it('dueToAttr / dueFromAttr 往返', () => {
    expect(dueToAttr({ date: '2026-10-03', time: '15:00' })).toBe('2026-10-03T15:00')
    expect(dueFromAttr('2026-10-03')).toEqual({ date: '2026-10-03' })
    expect(dueFromAttr('2026-10-03T15:00')).toEqual({ date: '2026-10-03', time: '15:00' })
    expect(dueFromAttr('明天')).toBeUndefined()
    expect(dueFromAttr(null)).toBeUndefined()
  })

  it('待办 → 一条带属性的待办项', () => {
    const d = captureToDoc(p('[] 买牛奶 明天下午3点 !高 #生活'))
    const item = d.content?.[0].content?.[0]
    expect(d.content?.[0].type).toBe('taskList')
    expect(item?.attrs).toEqual({ checked: false, due: '2026-10-03T15:00', priority: 3, tags: ['生活'] })
    expect(item?.content?.[0].content?.[0].text).toBe('买牛奶')
    expect(todoMeta(item?.attrs)).toEqual({ due: { date: '2026-10-03', time: '15:00' }, priority: 3, tags: ['生活'] })
  })

  it('普通文字 → 段落', () => {
    expect(captureToDoc(p('买牛奶')).content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: '买牛奶' }] })
  })

  it('todoMeta 容错', () => {
    expect(todoMeta({ priority: 9, tags: ['a', 3, ''], due: 'x' })).toEqual({ due: undefined, priority: 0, tags: ['a'] })
    expect(todoMeta(undefined)).toEqual({ due: undefined, priority: 0, tags: [] })
  })
})

describe('cleanDoc', async () => {
  const { cleanDoc } = await import('../notes/doc')
  it('去掉待办项的默认属性，保留有值的；没有变化时返回原对象', () => {
    const d = { type: 'doc', content: [{ type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: false, due: null, priority: 0, tags: [] } },
      { type: 'taskItem', attrs: { checked: true, due: '2026-10-03', priority: 2, tags: ['a'] } },
    ] }] }
    const c = cleanDoc(d)
    expect(c.content?.[0].content?.map((i) => i.attrs)).toEqual([
      { checked: false },
      { checked: true, due: '2026-10-03', priority: 2, tags: ['a'] },
    ])
    expect(cleanDoc(c)).toBe(c)
  })
})
