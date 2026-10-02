import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  // 组件文档用 react-docgen（Babel），不依赖 TypeScript 编译器 API（项目用的是 TypeScript 7）
  typescript: { reactDocgen: 'react-docgen' },
}

export default config
