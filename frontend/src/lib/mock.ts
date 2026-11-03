/**
 * Mock data for local UI development (`npm run dev:mock`).
 * Activated when NEXT_PUBLIC_MOCK=1 - no AWS account or deployment needed.
 */
import type { Overview, UserSummary, UserDetail, RegionStatus, StorageData, KbSyncData } from './api';

export const MOCK = process.env.NEXT_PUBLIC_MOCK === '1';

const delay = <T>(v: T): Promise<T> =>
  new Promise((res) => setTimeout(() => res(v), 400));

const USERS = [
  { name: 'alex', msgs: 342, hours: 4.21 },
  { name: 'priya', msgs: 289, hours: 2.87 },
  { name: 'daniel', msgs: 201, hours: 5.6 },
  { name: 'aisha', msgs: 156, hours: 0.93 },
  { name: 'marco', msgs: 98, hours: 1.44 },
  { name: 'wei', msgs: 61, hours: 0.31 },
  { name: 'sofia', msgs: 24, hours: 0 },
];

const arn = (name: string) =>
  `arn:aws:quicksight:us-east-1:111122223333:user/default/${name}`;

function series(hours: number): { time: string; messages: number }[] {
  const points = hours <= 48 ? hours : Math.min(Math.ceil(hours / 24), 90);
  const stepMs = hours <= 48 ? 3600_000 : 86_400_000;
  const out: { time: string; messages: number }[] = [];
  for (let i = points - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * stepMs);
    const label =
      hours <= 48
        ? d.toISOString().slice(5, 16).replace('T', ' ')
        : d.toISOString().slice(0, 10);
    // deterministic pseudo-random wave so charts look natural
    const v = Math.round(20 + 18 * Math.sin(i / 2.5) + ((i * 7919) % 13));
    out.push({ time: label, messages: Math.max(2, v) });
  }
  return out;
}

export function mockOverview(hours: number): Promise<Overview> {
  return delay({
    kpis: {
      activeUsers: USERS.length,
      totalMessages: USERS.reduce((s, u) => s + u.msgs, 0),
      totalConversations: 214,
      totalAgentHours: Number(USERS.reduce((s, u) => s + u.hours, 0).toFixed(2)),
      feedback: { Useful: 87, 'Not Useful': 12 },
    },
    series: series(hours),
    hoursByService: [
      { service: 'RESEARCH', hours: 8.4 },
      { service: 'FLOWS', hours: 4.9 },
      { service: 'AUTOMATIONS', hours: 2.1 },
    ],
    byRegion: [
      { region: 'ap-southeast-2', messages: 743, agentHours: 9.8 },
      { region: 'us-east-1', messages: 318, agentHours: 3.2 },
      { region: 'eu-west-1', messages: 110, agentHours: 2.4 },
    ],
    topUsers: USERS.slice(0, 5).map((u) => ({
      userArn: arn(u.name),
      userName: u.name,
      messages: u.msgs,
      agentHours: u.hours,
    })),
    connectors: [
      { connector: 'quicksight-website', uses: 44, users: 5 },
      { connector: 'jira-cloud', uses: 21, users: 3 },
      { connector: 'salesforce', uses: 9, users: 2 },
    ],
    queriedRegions: ['ap-southeast-2', 'us-east-1', 'eu-west-1'],
  });
}

export function mockUsers(): Promise<UserSummary[]> {
  return delay(
    USERS.map((u, i) => ({
      userArn: arn(u.name),
      userName: u.name,
      messages: u.msgs,
      conversations: Math.ceil(u.msgs / 6),
      agents: (i % 4) + 1,
      flows: i % 3,
      agentHours: u.hours,
      feedbackPositive: Math.ceil(u.msgs / 25),
      feedbackNegative: i % 3,
      regions: i % 2 === 0 ? ['ap-southeast-2', 'us-east-1'] : ['ap-southeast-2'],
    })),
  );
}

export function mockUser(userArn: string, hours: number): Promise<UserDetail> {
  const name = userArn.split('/').pop() ?? 'user';
  const base = USERS.find((u) => u.name === name) ?? USERS[0];
  const ts = (minsAgo: number) =>
    new Date(Date.now() - minsAgo * 60_000).toISOString().replace('T', ' ').slice(0, 19);
  return delay({
    userArn,
    userName: name,
    totals: {
      messages: base.msgs,
      conversations: Math.ceil(base.msgs / 6),
      agents: 3,
      flows: 2,
      agentHours: base.hours,
    },
    byRegion: [
      { region: 'ap-southeast-2', messages: Math.round(base.msgs * 0.7), agentHours: Number((base.hours * 0.8).toFixed(2)) },
      { region: 'us-east-1', messages: Math.round(base.msgs * 0.3), agentHours: Number((base.hours * 0.2).toFixed(2)) },
    ],
    series: series(hours),
    agentHours: [
      { region: 'ap-southeast-2', service: 'RESEARCH', group: 'Included', hours: Number((base.hours * 0.6).toFixed(2)) },
      { region: 'ap-southeast-2', service: 'FLOWS', group: 'Included', hours: Number((base.hours * 0.3).toFixed(2)) },
      { region: 'us-east-1', service: 'RESEARCH', group: 'Extra', hours: Number((base.hours * 0.1).toFixed(2)) },
    ],
    feedback: [
      { region: 'ap-southeast-2', type: 'Useful', reason: '', count: 9 },
      { region: 'ap-southeast-2', type: 'Not Useful', reason: 'Issue with sources', count: 2 },
    ],
    connectors: [
      { connector: 'quicksight-website', uses: 12 },
      { connector: 'jira-cloud', uses: 4 },
    ],
    citedResources: [
      { name: 'Revenue dashboard', type: 'Dashboard', count: 8 },
      { name: 'Sales team space', type: 'Space', count: 5 },
      { name: 'Product docs KB', type: 'KB', count: 3 },
    ],
    storage: [
      {
        sourceName: 'GoogleDrive - knowledgebase', sourceType: 'KB', region: 'us-east-1',
        sizeBytes: 5_021_849, docCount: 8, lastEvent: '2026-07-18 08:59:38',
      },
      {
        sourceName: 'My Space', sourceType: 'SPACE', region: 'us-east-1',
        sizeBytes: 58_662, docCount: 6, lastEvent: '2026-07-18 07:28:05',
      },
    ],
    recentMessages: [
      {
        region: 'ap-southeast-2', timestamp: ts(12),
        message: 'Summarize Q2 revenue by product line and highlight anomalies',
        status: 'success', agentId: 'agt-9021', flowId: '', conversationId: 'c-1201', surface: 'WEB_EXPERIENCE',
        reply: 'Q2 revenue was led by the Platform line at $4.2M (+18% QoQ). One anomaly: Hardware dipped 22% in May, driven by a supply delay in APAC. Full breakdown:\n\n| Line | Q2 | QoQ |\n|---|---|---|\n| Platform | $4.2M | +18% |\n| Services | $2.9M | +6% |\n| Hardware | $1.1M | -22% |',
      },
      {
        region: 'ap-southeast-2', timestamp: ts(58),
        message: 'Run the monthly compliance report flow for the Sydney team',
        status: 'success', agentId: '', flowId: 'flow-3345', conversationId: 'c-1198', surface: 'WEB_EXPERIENCE',
        reply: 'The compliance report flow completed. 3 findings were flagged for review and the report was shared with the Sydney team space.',
      },
      {
        region: 'us-east-1', timestamp: ts(240),
        message: 'What were the top support ticket categories last week?',
        status: 'no_answer_found', agentId: '', flowId: '', conversationId: 'c-1190', surface: 'WEB_EXPERIENCE',
        reply: '',
      },
      {
        region: 'ap-southeast-2', timestamp: ts(300),
        message: 'Compare AWS spend month over month and flag services growing >20%',
        status: 'success', agentId: 'agt-9021', flowId: '', conversationId: 'c-1185', surface: 'WEB_EXPERIENCE',
        reply: 'June spend was $48.3K vs $41.9K in May (+15%). Two services grew >20%: CloudWatch Logs (+34%, driven by new vended log ingestion) and Bedrock (+27%).',
      },
    ],
  });
}

export function mockStatus(): Promise<RegionStatus> {
  const all = ['CHAT_LOGS', 'FEEDBACK_LOGS', 'AGENT_HOURS_LOGS', 'INDEX_USAGE_LOGS', 'KB_FILE_SYNC_LOGS'];
  return delay({
    updatedAt: new Date().toISOString(),
    regions: [
      { region: 'ap-southeast-2', status: 'active', logTypes: all },
      { region: 'us-east-1', status: 'active', logTypes: all },
      { region: 'eu-west-1', status: 'active', logTypes: all },
      { region: 'sa-east-1', status: 'unsupported', detail: 'No Quick vended log types available', logTypes: [] },
    ],
  });
}

export function mockStorage(): Promise<StorageData> {
  return delay({
    totalIndexBytes: 1_284_336_640,
    byRegion: [
      { region: 'ap-southeast-2', bytes: 934_281_216 },
      { region: 'us-east-1', bytes: 350_055_424 },
    ],
    sources: [
      {
        sourceArn: 'arn:aws:quicksight:ap-southeast-2:111122223333:space/aaa',
        sourceName: 'Sales team space', sourceType: 'SPACE', region: 'ap-southeast-2',
        sizeBytes: 524_288_000, docCount: 1420, lastUpdatedBy: 'priya', lastEvent: '2026-07-17 09:14:22',
      },
      {
        sourceArn: 'arn:aws:quicksight:ap-southeast-2:111122223333:kb/bbb',
        sourceName: 'Product docs KB', sourceType: 'KB', region: 'ap-southeast-2',
        sizeBytes: 409_993_216, docCount: 3861, lastUpdatedBy: 'alex', lastEvent: '2026-07-18 02:31:05',
      },
      {
        sourceArn: 'arn:aws:quicksight:us-east-1:111122223333:kb/ccc',
        sourceName: 'Compliance policies', sourceType: 'KB', region: 'us-east-1',
        sizeBytes: 350_055_424, docCount: 512, lastUpdatedBy: 'daniel', lastEvent: '2026-07-16 18:02:47',
      },
    ],
  });
}

export function mockKbSync(): Promise<KbSyncData> {
  return delay({
    statuses: { ADDED: 312, MODIFIED: 84, UNMODIFIED: 3465, DELETED: 12, SKIPPED: 9, FAILED: 4 },
    failures: [
      {
        region: 'ap-southeast-2', timestamp: '2026-07-18 02:31:05',
        documentTitle: 'Q2 pricing sheet', status: 'FAILED', errorType: 'PARSE_ERROR',
        errorMessage: 'Document could not be parsed: unsupported encoding.',
        errorMitigation: 'Re-save the document in UTF-8 and re-sync.',
        knowledgeBaseId: 'b0bd0a47-8095-439d-9dff-c64bd5fe3fa3',
        sourceUri: 'https://intranet.example.com/pricing-q2.xlsx',
      },
      {
        region: 'ap-southeast-2', timestamp: '2026-07-17 22:10:44',
        documentTitle: 'Blocked page', status: 'SKIPPED', errorType: 'VALIDATION_ERROR',
        errorMessage: "This URL wasn't crawled because crawling isn't allowed by its robots.txt file.",
        errorMitigation: 'Contact the website administrator for assistance.',
        knowledgeBaseId: 'b0bd0a47-8095-439d-9dff-c64bd5fe3fa3',
        sourceUri: 'https://docs.example.com/internal/blocked',
      },
    ],
  });
}

// ------------------------------------------------------------- admin mocks

import type { AdminUser, Permissions } from './api';

const ALL_TRUE: Permissions = {
  dashboard: true, users: true, chatLogs: true, storage: true, kbSync: true, regions: true, reports: true,
};

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

// Mutable so invite/delete/permission changes are visible during mock dev
const ADMIN_USERS: AdminUser[] = [
  {
    username: 'admin', email: 'admin@example.com', status: 'CONFIRMED', enabled: true,
    created: daysAgo(40), isAdmin: true, permissions: { ...ALL_TRUE },
  },
  {
    username: 'priya', email: 'priya@example.com', status: 'CONFIRMED', enabled: true,
    created: daysAgo(21), isAdmin: false, permissions: { ...ALL_TRUE, chatLogs: false },
  },
  {
    username: 'daniel', email: 'daniel@example.com', status: 'FORCE_CHANGE_PASSWORD', enabled: true,
    created: daysAgo(2), isAdmin: false, permissions: { ...ALL_TRUE },
  },
];

export function mockMyPermissions(): Promise<Permissions> {
  return delay({ ...ALL_TRUE });
}

export function mockAdminListUsers(): Promise<AdminUser[]> {
  return delay(ADMIN_USERS.map((u) => ({ ...u, permissions: { ...u.permissions } })));
}

export function mockAdminInvite(email: string): Promise<AdminUser> {
  const user: AdminUser = {
    username: email.split('@')[0].toLowerCase(),
    email,
    status: 'FORCE_CHANGE_PASSWORD',
    enabled: true,
    created: new Date().toISOString(),
    isAdmin: false,
    permissions: { ...ALL_TRUE },
  };
  ADMIN_USERS.push(user);
  return delay(user);
}

export function mockAdminMutation(deleteUsername?: string): Promise<{ ok: boolean }> {
  if (deleteUsername) {
    const i = ADMIN_USERS.findIndex((u) => u.username === deleteUsername);
    if (i >= 0) ADMIN_USERS.splice(i, 1);
  }
  return delay({ ok: true });
}

export function mockAdminSetPermissions(username: string, permissions: Permissions): Promise<Permissions> {
  const user = ADMIN_USERS.find((u) => u.username === username);
  if (user) user.permissions = { ...permissions };
  return delay({ ...permissions });
}
