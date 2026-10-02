import { describe, expect, it } from 'vitest'
import { normalizeServer } from './client'

describe('normalizeServer（插件的服务器地址）', () => {
  it('补上 https、去掉路径和末尾斜杠', () => {
    expect(normalizeServer('notes.example.com')).toBe('https://notes.example.com')
    expect(normalizeServer('  https://notes.example.com/api/v1/ ')).toBe('https://notes.example.com')
    expect(normalizeServer('http://localhost:8080/some/path/')).toBe('http://localhost:8080')
    expect(normalizeServer('HTTPS://Notes.Example.com')).toBe('https://notes.example.com')
  })

  it('不像网址的返回 null', () => {
    for (const s of ['', '   ', 'ftp://example.com', 'javascript:alert(1)', 'http://']) expect(normalizeServer(s), s).toBeNull()
  })
})
