import { AnimatePresence, motion } from 'motion/react'

const GROUPS: { title: string; items: [keys: string[], label: string][] }[] = [
  {
    title: '新建',
    items: [
      [['双击空白处'], '在该位置新建便利贴'],
      [['Q'], '快速记录（[] 开头是待办）'],
      [['T'], '快速记录一条待办'],
      [['N'], '新建便利贴'],
      [['Ctrl', 'V'], '粘贴文字生成便利贴'],
    ],
  },
  {
    title: '选中的便利贴',
    items: [
      [['J', 'K'], '切换焦点（也可以用方向键）'],
      [['E'], '编辑（也可以用 Enter、双击，或按住便利贴 2 秒）'],
      [['1', '–', '8'], '换颜色'],
      [['Delete'], '删除'],
      [['Esc'], '退出编辑 / 取消选中'],
    ],
  },
  {
    title: '编辑表格（光标在表格里时，下方也有工具栏）',
    items: [
      [['Tab'], '下一格（在最后一格按，加一行）'],
      [['Ctrl', 'Alt', '↑ / ↓'], '在上方 / 下方插入行'],
      [['Ctrl', 'Shift', 'Backspace'], '删除当前行（空行的第一格开头按 Backspace 也可以）'],
      [['Ctrl', 'Alt', 'Shift', '← / →'], '在左侧 / 右侧插入列'],
      [['Ctrl', 'Alt', 'Shift', 'Backspace'], '删除当前列'],
    ],
  },
  {
    title: '全局',
    items: [
      [['Ctrl', 'K'], '命令面板：搜索所有便利贴、切换看板、执行操作'],
      [['Ctrl', '+ / -'], '白板放大 / 缩小（也可以 Ctrl + 滚轮、双指捏合）'],
      [['Ctrl', '0'], '白板缩放回 100%'],
      [['Shift', '1'], '显示当前白板的全部便利贴'],
      [['['], '收起 / 展开侧边栏'],
      [['V'], '白板 / 列表视图切换'],
      [['Ctrl', 'Z'], '撤销（最近 20 步）'],
      [['Ctrl', 'Shift', 'Z'], '重做'],
      [['?'], '显示 / 隐藏本页'],
    ],
  },
]

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[10000] grid place-items-center bg-black/15 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onPointerDown={onClose}
        >
          <motion.div
            role="dialog"
            aria-label="快捷键"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-chrome-border bg-chrome p-6 shadow-chrome backdrop-blur-xl"
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 4 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-[15px] font-semibold">快捷键</h2>
            <div className="space-y-5">
              {GROUPS.map((g) => (
                <section key={g.title}>
                  <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-faint">{g.title}</h3>
                  <ul className="space-y-1.5">
                    {g.items.map(([keys, label]) => (
                      <li key={label} className="flex items-center justify-between gap-4 text-[13px]">
                        <span className="text-ink-muted">{label}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {keys.map((k) => (k === '–' ? <span key={k} className="text-ink-faint">–</span> : <kbd key={k}>{k}</kbd>))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
