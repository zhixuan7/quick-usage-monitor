import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Knowledge sync',
  description: 'Knowledge base document sync health: statuses, failures, and suggested fixes.',
};

export default function KbSyncLayout({ children }: { children: React.ReactNode }) {
  return children;
}
