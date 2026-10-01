/** 便利贴的 8 种精选颜色。实际色值在 tokens.css 中按主题分别定义。 */
export const NOTE_COLORS = [
  { key: 'lemon', name: '柠檬黄' },
  { key: 'peach', name: '蜜桃' },
  { key: 'blossom', name: '樱粉' },
  { key: 'lavender', name: '薰衣草' },
  { key: 'sky', name: '天蓝' },
  { key: 'mint', name: '薄荷' },
  { key: 'sand', name: '沙色' },
  { key: 'paper', name: '纸白' },
] as const

export type NoteColor = (typeof NOTE_COLORS)[number]['key']

export const noteColorVar = (c: NoteColor) => `var(--note-${c})`
