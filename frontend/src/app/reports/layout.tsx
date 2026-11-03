import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reports',
  description: 'Create and export comprehensive Amazon Quick usage reports as CSV, JSON, Markdown, HTML, or PDF.',
};

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
