import type { Preview } from '@storybook/react-vite'
import { useEffect } from 'react'
import '../src/index.css'

const preview: Preview = {
  globalTypes: {
    theme: {
      description: '主题',
      toolbar: {
        title: '主题',
        icon: 'mirror',
        items: [
          { value: 'light', title: '浅色' },
          { value: 'dark', title: '暗色' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
  },
  decorators: [
    (Story, ctx) => {
      const theme = ctx.globals.theme as string
      useEffect(() => {
        document.documentElement.dataset.theme = theme
      }, [theme])
      // 整页故事（例如登录页）自带背景，不再包一层
      if (ctx.parameters.layout === 'fullscreen') {
        return (
          <div style={{ height: '100vh' }}>
            <Story />
          </div>
        )
      }
      return (
        <div className="board-surface" style={{ padding: 32, minWidth: 360, borderRadius: 12 }}>
          <Story />
        </div>
      )
    },
  ],
}

export default preview
