/** 便利贴颜色：定义在 @stickydo/core/design，实际色值在 tokens.css 中按主题分别定义 */
import type { NoteColor } from '@stickydo/core/design'

export { NOTE_COLORS, type NoteColor } from '@stickydo/core/design'

export const noteColorVar = (c: NoteColor) => `var(--note-${c})`
