import type { Meta, StoryObj } from '@storybook/react-vite'
import { TextField } from './TextField'

const meta = {
  title: '基础组件/TextField',
  component: TextField,
  args: { label: '邮箱', type: 'email', placeholder: 'you@example.com' },
  decorators: [(Story) => <div style={{ width: 300 }}>{Story()}</div>],
} satisfies Meta<typeof TextField>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithHint: Story = { args: { label: '密码', type: 'password', placeholder: '', hint: '至少 8 位' } }
export const WithError: Story = { args: { defaultValue: 'not-an-email', error: '请输入有效的邮箱地址' } }
export const Password: Story = { args: { label: '密码', type: 'password', placeholder: '', defaultValue: 'correct horse' } }
export const Disabled: Story = { args: { disabled: true, defaultValue: 'a@example.com' } }
