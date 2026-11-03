import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'User management',
  description: 'Invite dashboard users, manage per-user permissions, reset passwords, and remove access.',
  robots: { index: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
