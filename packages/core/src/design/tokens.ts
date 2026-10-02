/**
 * 设计 token（docs/frontend-design.md §5）：Web 与移动端共用的唯一来源。
 * Web 由 web/scripts/gen-tokens.ts 生成 CSS 变量（web/src/design/tokens.css），
 * 移动端直接使用这里的常量。
 *
 * 这个文件不能有 import：生成脚本用 Node 直接运行它。
 */

/** 便利贴的 8 种精选颜色 */
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

export interface Theme {
  /** 界面、表单与按钮 */
  ui: {
    boardBg: string
    boardDot: string
    ink: string
    inkMuted: string
    inkFaint: string
    chromeBg: string
    chromeBorder: string
    chromeHover: string
    focusRing: string
    overdue: string
    ok: string
    accent: string
    accentInk: string
    accentHover: string
    danger: string
    dangerSoft: string
    fieldBg: string
    fieldBorder: string
    fieldBorderHover: string
    surface: string
  }
  /** 便利贴：8 种底色、文字、纸张噪点 */
  note: Record<NoteColor, string> & {
    ink: string
    inkMuted: string
    noiseOpacity: number
    noiseBlend: 'multiply' | 'soft-light'
  }
  /** 阴影（CSS box-shadow 写法；移动端需要自行换算） */
  shadow: {
    note: string
    noteLift: string
    chrome: string
  }
}

export const lightTheme: Theme = {
  ui: {
    boardBg: '#ece9e3',
    boardDot: 'rgb(60 50 30 / 0.07)',
    ink: '#2b2a26',
    inkMuted: '#7a766d',
    inkFaint: '#a8a398',
    chromeBg: 'rgb(255 255 255 / 0.72)',
    chromeBorder: 'rgb(60 50 30 / 0.1)',
    chromeHover: 'rgb(60 50 30 / 0.06)',
    focusRing: '#6b8afd',
    overdue: '#e0893a',
    ok: '#4f9a6c',
    accent: '#2b2a26',
    accentInk: '#fbfaf6',
    accentHover: '#44423c',
    danger: '#b4432f',
    dangerSoft: 'rgb(180 67 47 / 0.09)',
    fieldBg: 'rgb(255 255 255 / 0.85)',
    fieldBorder: 'rgb(60 50 30 / 0.16)',
    fieldBorderHover: 'rgb(60 50 30 / 0.3)',
    surface: '#fbfaf6',
  },
  note: {
    lemon: '#fff4b8',
    peach: '#ffd9c7',
    blossom: '#ffd6e7',
    lavender: '#e5dbff',
    sky: '#cde8ff',
    mint: '#cff5e1',
    sand: '#f0e6d6',
    paper: '#fafaf7',
    ink: '#2b2a26',
    inkMuted: 'rgb(43 42 38 / 0.55)',
    noiseOpacity: 0.35,
    noiseBlend: 'multiply',
  },
  shadow: {
    note: '0 1px 1px rgb(60 50 30 / 0.06), 0 2px 4px rgb(60 50 30 / 0.07), 0 8px 16px -6px rgb(60 50 30 / 0.14)',
    noteLift:
      '0 2px 3px rgb(60 50 30 / 0.06), 0 14px 28px -8px rgb(60 50 30 / 0.26), 0 30px 60px -16px rgb(60 50 30 / 0.24)',
    chrome: '0 1px 2px rgb(60 50 30 / 0.06), 0 8px 24px -8px rgb(60 50 30 / 0.18)',
  },
}

/** 暗色：降低饱和度的深色调，单独设计，不是反色 */
export const darkTheme: Theme = {
  ui: {
    boardBg: '#1c1b19',
    boardDot: 'rgb(255 248 230 / 0.06)',
    ink: '#ece7dc',
    inkMuted: '#9b958a',
    inkFaint: '#6d685f',
    chromeBg: 'rgb(40 38 35 / 0.75)',
    chromeBorder: 'rgb(255 248 230 / 0.08)',
    chromeHover: 'rgb(255 248 230 / 0.07)',
    focusRing: '#8aa2ff',
    overdue: '#e6a066',
    ok: '#7cc49a',
    accent: '#ece7dc',
    accentInk: '#1c1b19',
    accentHover: '#ffffff',
    danger: '#ee8a76',
    dangerSoft: 'rgb(238 138 118 / 0.12)',
    fieldBg: 'rgb(255 248 230 / 0.05)',
    fieldBorder: 'rgb(255 248 230 / 0.14)',
    fieldBorderHover: 'rgb(255 248 230 / 0.28)',
    surface: '#262522',
  },
  note: {
    lemon: '#4a4329',
    peach: '#4d372b',
    blossom: '#4a3039',
    lavender: '#3a3450',
    sky: '#2a3d4f',
    mint: '#284339',
    sand: '#443b30',
    paper: '#3a3936',
    ink: '#efe9dc',
    inkMuted: 'rgb(239 233 220 / 0.55)',
    noiseOpacity: 0.18,
    noiseBlend: 'soft-light',
  },
  shadow: {
    note: '0 1px 1px rgb(0 0 0 / 0.3), 0 2px 4px rgb(0 0 0 / 0.25), 0 8px 16px -6px rgb(0 0 0 / 0.45)',
    noteLift: '0 2px 3px rgb(0 0 0 / 0.3), 0 14px 28px -8px rgb(0 0 0 / 0.55), 0 30px 60px -16px rgb(0 0 0 / 0.5)',
    chrome: '0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px -8px rgb(0 0 0 / 0.5)',
  },
}

/** 与主题无关的 token */
export const radius = { note: 3, ui: 10 } as const

export const fonts = {
  ui: "'Inter', system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Source Han Sans SC', 'Microsoft YaHei', sans-serif",
} as const

/** 动效时长（毫秒） */
export const durations = { fast: 120, base: 200, slow: 320 } as const

/** 缓动曲线：cubic-bezier 的四个参数 */
export const easings = { out: [0.22, 1, 0.36, 1] } as const
