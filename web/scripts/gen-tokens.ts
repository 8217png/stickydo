/**
 * 由 packages/core/src/design/tokens.ts 生成 src/design/tokens.css。
 *   npm run gen:tokens            生成
 *   node scripts/gen-tokens.ts --check   检查是否最新（npm test 会执行）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { darkTheme, durations, easings, fonts, lightTheme, radius, type Theme } from '../../packages/core/src/design/tokens.ts'

const out = fileURLToPath(new URL('../src/design/tokens.css', import.meta.url))
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

function themeVars(t: Theme): string[] {
  return [
    ...Object.entries(t.ui).map(([k, v]) => `--${kebab(k)}: ${v};`),
    ...Object.entries(t.note).map(([k, v]) => `--note-${kebab(k)}: ${v};`),
    ...Object.entries(t.shadow).map(([k, v]) => `--shadow-${kebab(k)}: ${v};`),
  ]
}

const shared = [
  ...Object.entries(radius).map(([k, v]) => `--radius-${k}: ${v}px;`),
  ...Object.entries(fonts).map(([k, v]) => `--font-${k}: ${v};`),
  ...Object.entries(durations).map(([k, v]) => `--dur-${k}: ${v}ms;`),
  ...Object.entries(easings).map(([k, v]) => `--ease-${k}: cubic-bezier(${v.join(', ')});`),
]

const block = (selector: string, lines: string[], indent = '') =>
  [`${indent}${selector} {`, ...lines.map((l) => `${indent}  ${l}`), `${indent}}`].join('\n')

const dark = ['color-scheme: dark;', ...themeVars(darkTheme)]

const css = `/*
 * 设计 token（docs/frontend-design.md §5）
 * 由 scripts/gen-tokens.ts 根据 packages/core/src/design/tokens.ts 生成，不要手改：npm run gen:tokens
 * 主题：<html data-theme="light|dark"> 表示显式选择；没有该属性时跟随系统（prefers-color-scheme）。
 */
${block(':root', [...themeVars(lightTheme), ...shared])}

/* 显式选择暗色 */
${block("[data-theme='dark']", dark)}

/* 跟随系统 */
@media (prefers-color-scheme: dark) {
${block(":root:not([data-theme='light'])", dark, '  ')}
}
`

if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== css) {
    console.error('src/design/tokens.css 不是最新的：请运行 npm run gen:tokens')
    process.exit(1)
  }
} else {
  writeFileSync(out, css)
}
