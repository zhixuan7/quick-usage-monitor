import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Storage',
  description: 'Index storage consumption for Amazon Quick Spaces and knowledge bases across regions.',
};

export default function StorageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
