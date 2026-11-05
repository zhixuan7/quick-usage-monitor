import type { Metadata, Viewport } from 'next';
import './globals.css';

// Build-time base URL for canonical/OG links (metadata is baked at export
// time, so it cannot come from the runtime config.json). Optionally set
// NEXT_PUBLIC_SITE_URL to your CloudFront DashboardUrl before `npm run deploy`
// for correct absolute URLs in link previews; the dashboard works either way.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dashboard.example.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Quick Usage Monitor',
    template: '%s · Quick Usage Monitor',
  },
  description:
    'Multi-region usage monitoring for Amazon Quick: users and groups, agents and permissions, connector activity, and audit history in one dashboard.',
  applicationName: 'Quick Usage Monitor',
  keywords: [
    'Amazon Quick', 'usage monitoring', 'analytics dashboard', 'agent hours',
    'chat analytics', 'AWS', 'CloudWatch',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Quick Usage Monitor',
    title: 'Quick Usage Monitor',
    description:
      'Multi-region usage monitoring for Amazon Quick: users and groups, agents and permissions, connector activity, and audit history.',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary',
    title: 'Quick Usage Monitor',
    description: 'Multi-region usage monitoring for Amazon Quick.',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#6842FF',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
