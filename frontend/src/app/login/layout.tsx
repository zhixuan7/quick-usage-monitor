import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Quick Usage Monitor to view Amazon Quick usage analytics.',
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
