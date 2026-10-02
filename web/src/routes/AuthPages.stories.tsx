import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router'
import { LoginPage, RegisterPage } from './AuthPages'

const meta = {
  title: '页面/账号',
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <MemoryRouter>{Story()}</MemoryRouter>],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Login: Story = { render: () => <LoginPage /> }
export const Register: Story = { render: () => <RegisterPage /> }
