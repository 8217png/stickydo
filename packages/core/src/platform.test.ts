import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * @stickydo/core 要同时跑在浏览器和 React Native 里：不能用只有浏览器才有的 API，
 * 也不能依赖 Vite / Tiptap / React DOM。这些由各端注入。
 */
const FORBIDDEN = [
  /\bwindow\./,
  /\bdocument\./,
  /\blocalStorage\b/,
  /\bindexedDB\b/,
  /\bnavigator\./,
  /import\.meta\.env/,
  /from '(react-dom|@tiptap\/[^']+|dexie|vite)'/,
]

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e): string[] => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.ts$/.test(e.name) && !/\.(test|d)\.ts$/.test(e.name) ? [p] : []
  })
}

describe('与平台无关', () => {
  const files = sources(new URL('.', import.meta.url).pathname)

  it('找到了源文件', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(files)('%s 不使用浏览器专有的 API', (file) => {
    // 去掉注释再检查
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    for (const re of FORBIDDEN) expect(code, `${re}`).not.toMatch(re)
  })
})
