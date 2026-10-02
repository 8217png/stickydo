// 正文的读写工具在 @stickydo/core/notes（与移动端共用）
export * from '@stickydo/core/notes'

/** 按需加载旧版 Markdown 的转换器（依赖 Tiptap，见 markdown.ts） */
export const loadMarkdown = () => import('./markdown').then((m) => m.markdownToDoc)
