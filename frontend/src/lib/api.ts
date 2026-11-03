/**
 * Typed API client. All calls carry the Cognito ID token; a 401 redirects to
 * the login page.
 */
import { getConfig } from './config';
import { getToken, signOut } from './auth';
import { TimeRange, hoursOf, rangeQuery } from './timerange';
import {
  MOCK, mockOverview, mockUsers, mockUser, mockStatus, mockStorage, mockKbSync,
  mockAdminListUsers, mockAdminInvite, mockAdminMutation, mockAdminSetPermissions,
  mockMyPermissions,
} from './mock';

// -------------------------------------------------------------- permissions

export const PERMISSION_KEYS = ['dashboard', 'users', 'chatLogs', 'storage', 'kbSync', 'regions', 'reports'] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type Permissions = Record<PermissionKey, boolean>;

export const PERMISSION_LABELS: Record<PermissionKey, { label: string; description: string }> = {
  dashboard: { label: 'Dashboard', description: 'Account-wide usage overview and KPIs' },
  users: { label: 'Users', description: 'Per-user usage list and drill-down pages' },
  chatLogs: { label: 'Chat logs', description: 'Raw chat messages and agent replies in user drill-downs' },
  storage: { label: 'Storage', description: 'Spaces and knowledge base storage usage' },
  kbSync: { label: 'Knowledge sync', description: 'KB file sync statuses and failures' },
  regions: { label: 'Regions', description: 'Region pipeline health status' },
  reports: { label: 'Reports', description: 'Create and export usage reports' },
};

export const FULL_ACCESS: Permissions = {
  dashboard: true, users: true, chatLogs: true, storage: true, kbSync: true, regions: true, reports: true,
};

export interface AdminUser {
  username: string;
  email: string;
  status: string;
  enabled: boolean;
  created: string;
  isAdmin: boolean;
  permissions: Permissions;
}

export interface Overview {
  kpis: {
    activeUsers: number;
    totalMessages: number;
    totalConversations: number;
    totalAgentHours: number;
    feedback: Record<string, number>;
  };
  series: { time: string; messages: number }[];
  hoursByService: { service: string; hours: number }[];
  byRegion: { region: string; messages: number; agentHours: number }[];
  topUsers: { userArn: string; userName: string; messages: number; agentHours: number }[];
  connectors: { connector: string; uses: number; users: number }[];
  queriedRegions: string[];
}

export interface StorageData {
  totalIndexBytes: number;
  byRegion: { region: string; bytes: number }[];
  sources: {
    sourceArn: string;
    sourceName: string;
    sourceType: string;
    region: string;
    sizeBytes: number;
    docCount: number;
    lastUpdatedBy: string;
    lastEvent: string;
  }[];
}

export interface KbSyncData {
  statuses: Record<string, number>;
  failures: {
    region: string;
    timestamp: string;
    documentTitle: string;
    status: string;
    errorType: string;
    errorMessage: string;
    errorMitigation: string;
    knowledgeBaseId: string;
    sourceUri: string;
  }[];
}

export interface UserSummary {
  userArn: string;
  userName: string;
  messages: number;
  conversations: number;
  agents: number;
  flows: number;
  agentHours: number;
  feedbackPositive: number;
  feedbackNegative: number;
  regions: string[];
}

export interface UserDetail {
  userArn: string;
  userName: string;
  totals: {
    messages: number;
    conversations: number;
    agents: number;
    flows: number;
    agentHours: number;
  };
  byRegion: { region: string; messages: number; agentHours: number }[];
  series: { time: string; messages: number }[];
  agentHours: { region: string; service: string; group: string; hours: number }[];
  feedback: { region: string; type: string; reason: string; count: number }[];
  connectors: { connector: string; uses: number }[];
  citedResources: { name: string; type: string; count: number }[];
  storage: {
    sourceName: string;
    sourceType: string;
    region: string;
    sizeBytes: number;
    docCount: number;
    lastEvent: string;
  }[];
  recentMessages: {
    region: string;
    timestamp: string;
    message: string;
    status: string;
    agentId: string;
    flowId: string;
    conversationId: string;
    surface: string;
    reply: string;
  }[];
  /** true when the caller's chatLogs permission is off (messages stripped server-side) */
  chatLogsHidden?: boolean;
}

export interface RegionStatus {
  updatedAt: string;
  regions: { region: string; status: string; detail?: string; logTypes: string[] }[];
}

export async function request<T>(method: string, pathAndQuery: string, body?: unknown): Promise<T> {
  const cfg = await getConfig();
  const token = getToken();
  if (!token) {
    window.location.href = '/login/';
    throw new Error('Not authenticated');
  }
  const res = await fetch(`${cfg.apiUrl}${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // Invalid/expired token (the JWT authorizer rejects before our Lambda)
    signOut();
    window.location.href = '/login/';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    let message = res.status === 403 ? 'You do not have access to this section' : `API error ${res.status}`;
    try {
      const parsed = (await res.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* keep default message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

const get = <T>(pathAndQuery: string) => request<T>('GET', pathAndQuery);

export type { TimeRange };

export const fetchOverview = (range: TimeRange) =>
  MOCK ? mockOverview(hoursOf(range)) : get<Overview>(`/api/overview?${rangeQuery(range)}`);
export const fetchUsers = (range: TimeRange) =>
  MOCK ? mockUsers() : get<UserSummary[]>(`/api/users?${rangeQuery(range)}`);
export const fetchUser = (arn: string, range: TimeRange) =>
  MOCK
    ? mockUser(arn, hoursOf(range))
    : get<UserDetail>(`/api/user?arn=${encodeURIComponent(arn)}&${rangeQuery(range)}`);
export const fetchStatus = () => (MOCK ? mockStatus() : get<RegionStatus>('/api/status'));
export const fetchStorage = (range: TimeRange) =>
  MOCK ? mockStorage() : get<StorageData>(`/api/storage?${rangeQuery(range)}`);
export const fetchKbSync = (range: TimeRange) =>
  MOCK ? mockKbSync() : get<KbSyncData>(`/api/kb-sync?${rangeQuery(range)}`);

// Cached per page-load so the nav does not refetch on every client navigation
let myPermissions: Promise<Permissions> | null = null;
export function fetchMyPermissions(): Promise<Permissions> {
  if (MOCK) return mockMyPermissions();
  if (!myPermissions) {
    myPermissions = get<Permissions>('/api/me/permissions').catch((err) => {
      myPermissions = null; // retry on next call; backend still enforces
      throw err;
    });
  }
  return myPermissions;
}

// ------------------------------------------------------------- admin client

export const adminListUsers = () =>
  MOCK ? mockAdminListUsers() : get<AdminUser[]>('/api/admin/users');
export const adminInviteUser = (email: string) =>
  MOCK ? mockAdminInvite(email) : request<AdminUser>('POST', '/api/admin/users', { email });
export const adminResendInvite = (username: string) =>
  MOCK ? mockAdminMutation() : request<{ ok: boolean }>('POST', '/api/admin/users/resend', { username });
export const adminResetPassword = (username: string) =>
  MOCK ? mockAdminMutation() : request<{ ok: boolean }>('POST', '/api/admin/users/reset-password', { username });
export const adminDeleteUser = (username: string) =>
  MOCK ? mockAdminMutation(username) : request<{ ok: boolean }>('POST', '/api/admin/users/delete', { username });
export const adminSetPermissions = (username: string, permissions: Permissions) =>
  MOCK
    ? mockAdminSetPermissions(username, permissions)
    : request<Permissions>('PUT', '/api/admin/permissions', { username, permissions });
