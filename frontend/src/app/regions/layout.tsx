import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Regions',
  description: 'Amazon Quick vended log pipeline status for every monitored region.',
};

export default function RegionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
