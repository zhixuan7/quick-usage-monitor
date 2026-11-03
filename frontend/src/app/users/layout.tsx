import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Users',
  description: 'Per-user Amazon Quick usage: messages, conversations, agents, flows, and agent hours.',
};

export default function UsersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
