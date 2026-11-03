import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'User detail',
  description: 'Single-user Amazon Quick drill-down: activity timeline, regions, agent hours, feedback, and recent conversations.',
};

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return children;
}
