import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'

const meta = {
  title: '基础组件/Button',
  component: Button,
  args: { children: '登录' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {}
export const Secondary: Story = { args: { variant: 'secondary', children: '取消' } }
export const Ghost: Story = { args: { variant: 'ghost', children: '忘记密码？' } }
export const Loading: Story = { args: { loading: true, children: '正在登录' } }
export const Disabled: Story = { args: { disabled: true } }

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <div key={size} className="flex items-center gap-3">
          <Button size={size}>主要</Button>
          <Button size={size} variant="secondary">
            次要
          </Button>
          <Button size={size} variant="ghost">
            文字
          </Button>
          <Button size={size} loading>
            加载中
          </Button>
        </div>
      ))}
    </div>
  ),
}
