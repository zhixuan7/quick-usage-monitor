/**
 * Runtime configuration. The CDK deployment uploads /config.json next to the
 * static site, so the same frontend build works in any account.
 */
export interface AppConfig {
  authDomain?: string;
  ssoConfigured?: boolean;
  accountId?: string;
  apiUrl: string;
  region: string;
  userPoolId: string;
  userPoolClientId: string;
}

let cached: AppConfig | null = null;

export async function getConfig(): Promise<AppConfig> {
  if (cached) return cached;

  // Local development: point the dev server at a deployed backend via
  // frontend/.env.local (NEXT_PUBLIC_* vars are inlined at build/dev time).
  if (process.env.NEXT_PUBLIC_API_URL) {
    cached = {
      apiUrl: process.env.NEXT_PUBLIC_API_URL,
      region: process.env.NEXT_PUBLIC_REGION ?? 'us-east-1',
      userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID ?? '',
      userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID ?? '',
    };
    return cached;
  }

  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Missing config.json - was the site deployed via CDK?');
  cached = (await res.json()) as AppConfig;
  return cached;
}
