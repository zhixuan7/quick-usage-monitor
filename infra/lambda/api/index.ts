/**
 * Quick Usage Monitor API.
 *
 * Routes (all JWT-protected by the HTTP API authorizer):
 *   GET /api/status              -> region pipeline health (from SSM, written by provisioner)
 *   GET /api/overview?hours=168  -> account-wide aggregates: KPIs, time series, breakdowns
 *   GET /api/users?hours=168     -> per-user usage summary across all regions
 *   GET /api/user?arn=..&hours=  -> single-user drill down: per-region, features, recent activity
 *
 * Admin routes (require membership of the "admins" Cognito group):
 *   GET  /api/admin/users                    -> Cognito users + their permissions
 *   POST /api/admin/users {email}            -> invite a user (emailed temp password)
 *   POST /api/admin/users/resend {username}  -> re-send the invitation email
 *   POST /api/admin/users/reset-password {username}
 *   POST /api/admin/users/delete {username}
 *   PUT  /api/admin/permissions {username, permissions}
 *   GET  /api/me/permissions                 -> caller's own permissions (any user)
 *
 * Data routes are gated by per-user permissions (managed by admins): a user
 * without access to a section receives 403, and chat logs are stripped from
 * the user drill-down when the chatLogs permission is off.
 *
 * All data comes from cross-region Logs Insights queries over the Quick vended
 * log groups. Responses are cached in DynamoDB (TTL) so repeated dashboard
 * loads do not re-run Insights queries.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { runQueryAllRegions, num, Row } from './insights';
import { authorize, monitor } from './monitor';
import {
  ADMIN_GROUP, AdminError, FULL_ACCESS, PermissionKey, Permissions,
  deleteUser, getPermissions, inviteUser, listDashboardUsers, resendInvite,
  resetPassword, setPermissions,
} from './admin';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssm = new SSMClient({});

const CACHE_TABLE = process.env.CACHE_TABLE!;
const STATUS_PARAM = process.env.STATUS_PARAM!;
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS ?? 300);

// ---------------------------------------------------------------- utilities

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
  try {
    const hit = await ddb.send(new GetCommand({ TableName: CACHE_TABLE, Key: { pk: key } }));
    if (hit.Item && hit.Item.ttl > Math.floor(Date.now() / 1000)) {
      return JSON.parse(hit.Item.payload) as T;
    }
  } catch (err) {
    console.error(`cache read failed: ${(err as Error).message}`);
  }
  const value = await produce();
  try {
    await ddb.send(
      new PutCommand({
        TableName: CACHE_TABLE,
        Item: {
          pk: key,
          payload: JSON.stringify(value),
          ttl: Math.floor(Date.now() / 1000) + CACHE_TTL_SECONDS,
        },
      }),
    );
  } catch (err) {
    console.error(`cache write failed: ${(err as Error).message}`);
  }
  return value;
}

interface RegionStatusDoc {
  updatedAt: string;
  regions: { region: string; status: string; detail?: string; logTypes: string[] }[];
}

async function regionStatus(): Promise<RegionStatusDoc> {
  const res = await ssm.send(new GetParameterCommand({ Name: STATUS_PARAM }));
  return JSON.parse(res.Parameter?.Value ?? '{"regions":[]}') as RegionStatusDoc;
}

async function activeRegions(): Promise<string[]> {
  const doc = await regionStatus();
  return doc.regions.filter((r) => r.status === 'active').map((r) => r.region);
}

const userName = (arn: string): string => arn.split('/').pop() ?? arn;

/**
 * Real chat telemetry stores action_connectors / cited_resource as nested JSON
 * arrays (camelCase keys), which Logs Insights flattens - the top-level field
 * is not selectable. So those queries fetch @message and we parse the full
 * record here. Key names are handled defensively (camelCase from live data,
 * snake_case from the documented schema).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function messageJson(r: Row): any | null {
  try {
    return JSON.parse(r['@message'] ?? '');
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const connectorId = (c: any): string =>
  c?.actionConnectorId ?? c?.action_connector_id ?? c?.actionConnectorName ?? c?.action_connector_name ?? 'unknown';

const CONNECTOR_FILTER =
  "(ispresent(action_connectors.0.actionConnectorId) or ispresent(action_connectors.0.action_connector_id))";
const CITED_FILTER =
  '(ispresent(cited_resource.0.citedResourceId) or ispresent(cited_resource.0.citedResourceName) or ispresent(cited_resource.0.cited_resource_id))';

interface QueryRange {
  start: number;
  end: number;
  hours: number;
  /** stable cache-key fragment (day-granular for absolute ranges) */
  key: string;
}

const MAX_WINDOW_MS = 92 * 24 * 3600 * 1000;

/**
 * Absolute ranges (start/end epoch ms) take precedence; the legacy hours
 * parameter remains supported. Ranges are clamped to "now" and to a 92-day
 * window; absolute ranges cache by calendar day so repeated loads hit.
 */
function parseRange(event: APIGatewayProxyEventV2): QueryRange {
  const qs = event.queryStringParameters;
  const s = num(qs?.start);
  const e = num(qs?.end);
  const now = Date.now();
  if (s > 0 && e > s) {
    const end = Math.min(e, now);
    const start = Math.max(s, end - MAX_WINDOW_MS);
    const hours = Math.max(1, Math.round((end - start) / 3600 / 1000));
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    return { start, end, hours, key: `d:${day(start)}:${day(end)}` };
  }
  const hours = Math.min(Math.max(num(qs?.hours) || 168, 1), 24 * 90);
  return { start: now - hours * 3600 * 1000, end: now, hours, key: `h:${hours}` };
}

// ------------------------------------------------------------------- routes

async function getOverview(range: { start: number; end: number; hours: number }) {
  const regions = await activeRegions();
  const bin = range.hours <= 48 ? '1h' : '1d';

  const [chatByUser, chatSeries, hours, feedback, chatByRegion, connectorRows] = await Promise.all([
    runQueryAllRegions(
      regions, 'chat',
      'filter ispresent(user_arn) | stats count(*) as messages, count_distinct(conversation_id) as conversations, count_distinct(agent_id) as agents, count_distinct(flow_id) as flows by user_arn',
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'chat',
      `filter ispresent(user_arn) | stats count(*) as messages by bin(${bin})`,
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'agent-hours',
      'filter ispresent(usage_hours) | stats sum(usage_hours) as hours by user_arn, reporting_service, usage_group',
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'feedback',
      'filter ispresent(feedback_type) | stats count(*) as cnt by feedback_type',
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'chat',
      'filter ispresent(user_arn) | stats count(*) as messages',
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'chat',
      `filter ${CONNECTOR_FILTER} | fields @message | limit 500`,
      range.start, range.end,
    ),
  ]);

  // Connector usage: parse the full record, since the array is nested JSON
  const connectorMap = new Map<string, { connector: string; uses: number; users: Set<string> }>();
  for (const r of connectorRows) {
    const msg = messageJson(r);
    if (!msg) continue;
    for (const c of msg.action_connectors ?? []) {
      const id = connectorId(c);
      const row = connectorMap.get(id) ?? { connector: id, uses: 0, users: new Set<string>() };
      row.uses += 1;
      if (msg.user_arn) row.users.add(msg.user_arn);
      connectorMap.set(id, row);
    }
  }

  // KPI totals
  const users = new Set<string>();
  let totalMessages = 0;
  let totalConversations = 0;
  for (const r of chatByUser) {
    if (r.user_arn) users.add(r.user_arn);
    totalMessages += num(r.messages);
    totalConversations += num(r.conversations);
  }
  let totalAgentHours = 0;
  const hoursByService: Record<string, number> = {};
  for (const r of hours) {
    if (r.user_arn) users.add(r.user_arn);
    totalAgentHours += num(r.hours);
    const svc = r.reporting_service || 'OTHER';
    hoursByService[svc] = (hoursByService[svc] ?? 0) + num(r.hours);
  }
  const feedbackTotals: Record<string, number> = {};
  for (const r of feedback) {
    feedbackTotals[r.feedback_type || 'Unknown'] = (feedbackTotals[r.feedback_type || 'Unknown'] ?? 0) + num(r.cnt);
  }

  // Time series (merge regions per bucket)
  const seriesMap = new Map<string, number>();
  for (const r of chatSeries) {
    const t = r[`bin(${bin})`] ?? Object.values(r).find((v) => /^\d{4}-/.test(v)) ?? '';
    if (!t) continue;
    seriesMap.set(t, (seriesMap.get(t) ?? 0) + num(r.messages));
  }
  const series = [...seriesMap.entries()]
    .map(([time, messages]) => ({ time, messages }))
    .sort((a, b) => a.time.localeCompare(b.time));

  // Region breakdown
  const byRegion = chatByRegion
    .map((r) => ({ region: r.__region, messages: num(r.messages) }))
    .filter((r) => r.messages > 0);
  // include agent hours per region
  const hoursRegion = new Map<string, number>();
  for (const r of hours) {
    hoursRegion.set(r.__region, (hoursRegion.get(r.__region) ?? 0) + num(r.hours));
  }
  const regionRows = new Map<string, { region: string; messages: number; agentHours: number }>();
  for (const r of byRegion) regionRows.set(r.region, { region: r.region, messages: r.messages, agentHours: 0 });
  for (const [region, h] of hoursRegion) {
    const row = regionRows.get(region) ?? { region, messages: 0, agentHours: 0 };
    row.agentHours = h;
    regionRows.set(region, row);
  }

  // Top users (merge chat + hours)
  const perUser = new Map<string, { userArn: string; messages: number; agentHours: number }>();
  for (const r of chatByUser) {
    if (!r.user_arn) continue;
    const u = perUser.get(r.user_arn) ?? { userArn: r.user_arn, messages: 0, agentHours: 0 };
    u.messages += num(r.messages);
    perUser.set(r.user_arn, u);
  }
  for (const r of hours) {
    if (!r.user_arn) continue;
    const u = perUser.get(r.user_arn) ?? { userArn: r.user_arn, messages: 0, agentHours: 0 };
    u.agentHours += num(r.hours);
    perUser.set(r.user_arn, u);
  }
  const topUsers = [...perUser.values()]
    .map((u) => ({ ...u, userName: userName(u.userArn), agentHours: Number(u.agentHours.toFixed(3)) }))
    .sort((a, b) => b.messages + b.agentHours * 10 - (a.messages + a.agentHours * 10))
    .slice(0, 10);

  return {
    kpis: {
      activeUsers: users.size,
      totalMessages,
      totalConversations,
      totalAgentHours: Number(totalAgentHours.toFixed(3)),
      feedback: feedbackTotals,
    },
    series,
    hoursByService: Object.entries(hoursByService).map(([service, h]) => ({
      service,
      hours: Number(h.toFixed(3)),
    })),
    byRegion: [...regionRows.values()].map((r) => ({
      ...r,
      agentHours: Number(r.agentHours.toFixed(3)),
    })),
    topUsers,
    connectors: [...connectorMap.values()]
      .map((c) => ({ connector: c.connector, uses: c.uses, users: c.users.size }))
      .sort((a, b) => b.uses - a.uses),
    queriedRegions: regions,
  };
}

async function getStorage(range: { start: number; end: number }) {
  const regions = await activeRegions();
  const rows = await runQueryAllRegions(
    regions, 'index-usage',
    'filter ispresent(consumed_index_size) | sort @timestamp desc | fields @timestamp, source_arn, source_name, source_type, consumed_source_size, consumed_source_doc_count, consumed_index_size, user_arn | limit 1000',
    range.start, range.end,
  );

  // Events are published per source on change; the current state is the most
  // recent event per source_arn (rows are timestamp-desc within each region).
  const sources = new Map<string, {
    sourceArn: string; sourceName: string; sourceType: string; region: string;
    sizeBytes: number; docCount: number; lastUpdatedBy: string; lastEvent: string;
  }>();
  const indexSizeByRegion = new Map<string, number>();
  for (const r of rows) {
    const key = r.source_arn || `${r.__region}:${r.source_name}`;
    if (!sources.has(key)) {
      sources.set(key, {
        sourceArn: r.source_arn ?? '',
        sourceName: r.source_name ?? '(unnamed)',
        sourceType: r.source_type ?? 'UNKNOWN',
        region: r.__region,
        sizeBytes: num(r.consumed_source_size),
        docCount: num(r.consumed_source_doc_count),
        lastUpdatedBy: r.user_arn ? userName(r.user_arn) : '',
        lastEvent: r['@timestamp'] ?? '',
      });
    }
    if (!indexSizeByRegion.has(r.__region)) {
      indexSizeByRegion.set(r.__region, num(r.consumed_index_size));
    }
  }

  return {
    totalIndexBytes: [...indexSizeByRegion.values()].reduce((s, v) => s + v, 0),
    byRegion: [...indexSizeByRegion.entries()].map(([region, bytes]) => ({ region, bytes })),
    sources: [...sources.values()].sort((a, b) => b.sizeBytes - a.sizeBytes),
  };
}

async function getKbSync(range: { start: number; end: number }) {
  const regions = await activeRegions();
  const [statusCounts, failures] = await Promise.all([
    runQueryAllRegions(
      regions, 'kb-file-sync',
      'filter ispresent(document_status) | stats count(*) as cnt by document_status',
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'kb-file-sync',
      "filter document_status = 'FAILED' or document_status = 'SKIPPED' | sort @timestamp desc | limit 50 | fields @timestamp, document_title, document_status, error_type, error_message, error_mitigation, knowledge_base_id, source_uri",
      range.start, range.end,
    ),
  ]);

  const statuses: Record<string, number> = {};
  for (const r of statusCounts) {
    const s = r.document_status || 'UNKNOWN';
    statuses[s] = (statuses[s] ?? 0) + num(r.cnt);
  }

  return {
    statuses,
    failures: failures
      .map((r) => ({
        region: r.__region,
        timestamp: r['@timestamp'] ?? '',
        documentTitle: r.document_title ?? '',
        status: r.document_status ?? '',
        errorType: r.error_type ?? '',
        errorMessage: r.error_message ?? '',
        errorMitigation: r.error_mitigation ?? '',
        knowledgeBaseId: r.knowledge_base_id ?? '',
        sourceUri: r.source_uri ?? '',
      }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
  };
}

async function getUsers(range: { start: number; end: number }) {
  const regions = await activeRegions();
  const [chat, agentRows, flowRows, hours, feedback] = await Promise.all([
    runQueryAllRegions(
      regions, 'chat',
      'filter ispresent(user_arn) | stats count(*) as messages, count_distinct(conversation_id) as conversations by user_arn',
      range.start, range.end,
    ),
    // agent_id/flow_id carry placeholder values ("SYSTEM", "-") on plain chats
    runQueryAllRegions(
      regions, 'chat',
      'filter ispresent(user_arn) and agent_id not in ["SYSTEM", "-", ""] | stats count_distinct(agent_id) as agents by user_arn',
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'chat',
      'filter ispresent(user_arn) and flow_id not in ["SYSTEM", "-", ""] | stats count_distinct(flow_id) as flows by user_arn',
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'agent-hours',
      'filter ispresent(usage_hours) | stats sum(usage_hours) as hours by user_arn',
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'feedback',
      'filter ispresent(feedback_type) | stats count(*) as cnt by user_arn, feedback_type',
      range.start, range.end,
    ),
  ]);

  interface UserRow {
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
  const users = new Map<string, UserRow>();
  const ensure = (arn: string): UserRow => {
    let u = users.get(arn);
    if (!u) {
      u = {
        userArn: arn, userName: userName(arn), messages: 0, conversations: 0,
        agents: 0, flows: 0, agentHours: 0, feedbackPositive: 0, feedbackNegative: 0, regions: [],
      };
      users.set(arn, u);
    }
    return u;
  };
  for (const r of chat) {
    if (!r.user_arn) continue;
    const u = ensure(r.user_arn);
    u.messages += num(r.messages);
    u.conversations += num(r.conversations);
    if (!u.regions.includes(r.__region)) u.regions.push(r.__region);
  }
  for (const r of agentRows) {
    if (r.user_arn) ensure(r.user_arn).agents += num(r.agents);
  }
  for (const r of flowRows) {
    if (r.user_arn) ensure(r.user_arn).flows += num(r.flows);
  }
  for (const r of hours) {
    if (!r.user_arn) continue;
    const u = ensure(r.user_arn);
    u.agentHours += num(r.hours);
    if (!u.regions.includes(r.__region)) u.regions.push(r.__region);
  }
  for (const r of feedback) {
    if (!r.user_arn) continue;
    const u = ensure(r.user_arn);
    if (/useful|positive|up/i.test(r.feedback_type ?? '') && !/not/i.test(r.feedback_type ?? '')) {
      u.feedbackPositive += num(r.cnt);
    } else {
      u.feedbackNegative += num(r.cnt);
    }
  }
  return [...users.values()]
    .map((u) => ({ ...u, agentHours: Number(u.agentHours.toFixed(3)) }))
    .sort((a, b) => b.messages - a.messages);
}

async function getUser(arn: string, range: { start: number; end: number; hours: number }) {
  const regions = await activeRegions();
  const safeArn = arn.replace(/'/g, '');
  const bin = range.hours <= 48 ? '1h' : '1d';

  const [chatAgg, agentAgg, flowAgg, series, recent, hours, feedback, connectorRows, citedRows, storageRows] = await Promise.all([
    runQueryAllRegions(
      regions, 'chat',
      `filter user_arn = '${safeArn}' | stats count(*) as messages, count_distinct(conversation_id) as conversations`,
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'chat',
      `filter user_arn = '${safeArn}' and agent_id not in ["SYSTEM", "-", ""] | stats count_distinct(agent_id) as agents`,
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'chat',
      `filter user_arn = '${safeArn}' and flow_id not in ["SYSTEM", "-", ""] | stats count_distinct(flow_id) as flows`,
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'chat',
      `filter user_arn = '${safeArn}' | stats count(*) as messages by bin(${bin})`,
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'chat',
      `filter user_arn = '${safeArn}' | sort @timestamp desc | limit 100 | fields @timestamp, user_message, system_text_message, status_code, agent_id, flow_id, conversation_id, surface_type`,
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'agent-hours',
      `filter user_arn = '${safeArn}' | stats sum(usage_hours) as hours by reporting_service, usage_group`,
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'feedback',
      `filter user_arn = '${safeArn}' | stats count(*) as cnt by feedback_type, feedback_reason`,
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'chat',
      `filter user_arn = '${safeArn}' and ${CONNECTOR_FILTER} | fields @message | limit 200`,
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'chat',
      `filter user_arn = '${safeArn}' and ${CITED_FILTER} | fields @message | limit 200`,
      range.start, range.end,
    ),
    runQueryAllRegions(
      regions, 'index-usage',
      `filter user_arn = '${safeArn}' and ispresent(consumed_index_size) | sort @timestamp desc | fields @timestamp, source_arn, source_name, source_type, consumed_source_size, consumed_source_doc_count | limit 200`,
      range.start, range.end,
    ),
  ]);

  // Spaces / KBs this user created or updated (latest state per source)
  const storageMap = new Map<string, {
    sourceName: string; sourceType: string; region: string;
    sizeBytes: number; docCount: number; lastEvent: string;
  }>();
  for (const r of storageRows) {
    const key = r.source_arn || `${r.__region}:${r.source_name}`;
    if (!storageMap.has(key)) {
      storageMap.set(key, {
        sourceName: r.source_name ?? '(unnamed)',
        sourceType: r.source_type ?? 'UNKNOWN',
        region: r.__region,
        sizeBytes: num(r.consumed_source_size),
        docCount: num(r.consumed_source_doc_count),
        lastEvent: r['@timestamp'] ?? '',
      });
    }
  }

  // Connector usage for this user (nested JSON - parse the full record)
  const connectorCounts = new Map<string, number>();
  for (const r of connectorRows) {
    const msg = messageJson(r);
    for (const c of msg?.action_connectors ?? []) {
      const id = connectorId(c);
      connectorCounts.set(id, (connectorCounts.get(id) ?? 0) + 1);
    }
  }

  // Spaces / dashboards / resources cited in this user's chats
  const citedCounts = new Map<string, { name: string; type: string; count: number }>();
  for (const r of citedRows) {
    const msg = messageJson(r);
    for (const c of msg?.cited_resource ?? []) {
      const name =
        c?.citedResourceName ?? c?.cited_resource_name ?? c?.citedResourceId ?? c?.cited_resource_id ?? 'unknown';
      const type = c?.citedResourceType ?? c?.cited_resource_type ?? '';
      const key = `${type}:${name}`;
      const row = citedCounts.get(key) ?? { name, type, count: 0 };
      row.count += 1;
      citedCounts.set(key, row);
    }
  }

  // Per-region rollup
  const byRegion = new Map<string, { region: string; messages: number; agentHours: number }>();
  for (const r of chatAgg) {
    const messages = num(r.messages);
    if (messages === 0) continue;
    const row = byRegion.get(r.__region) ?? { region: r.__region, messages: 0, agentHours: 0 };
    row.messages += messages;
    byRegion.set(r.__region, row);
  }
  for (const r of hours) {
    const h = num(r.hours);
    if (h === 0) continue;
    const row = byRegion.get(r.__region) ?? { region: r.__region, messages: 0, agentHours: 0 };
    row.agentHours += h;
    byRegion.set(r.__region, row);
  }

  const totals = { messages: 0, conversations: 0, agents: 0, flows: 0, agentHours: 0 };
  for (const r of chatAgg) {
    totals.messages += num(r.messages);
    totals.conversations += num(r.conversations);
  }
  for (const r of agentAgg) totals.agents += num(r.agents);
  for (const r of flowAgg) totals.flows += num(r.flows);
  for (const r of hours) totals.agentHours += num(r.hours);

  const seriesMap = new Map<string, number>();
  for (const r of series) {
    const t = r[`bin(${bin})`] ?? Object.values(r).find((v) => /^\d{4}-/.test(v)) ?? '';
    if (!t) continue;
    seriesMap.set(t, (seriesMap.get(t) ?? 0) + num(r.messages));
  }

  return {
    userArn: arn,
    userName: userName(arn),
    totals: { ...totals, agentHours: Number(totals.agentHours.toFixed(3)) },
    byRegion: [...byRegion.values()].map((r) => ({ ...r, agentHours: Number(r.agentHours.toFixed(3)) })),
    series: [...seriesMap.entries()]
      .map(([time, messages]) => ({ time, messages }))
      .sort((a, b) => a.time.localeCompare(b.time)),
    agentHours: hours.map((r) => ({
      region: r.__region,
      service: r.reporting_service,
      group: r.usage_group,
      hours: num(r.hours),
    })),
    feedback: feedback.map((r) => ({
      region: r.__region,
      type: r.feedback_type,
      reason: r.feedback_reason,
      count: num(r.cnt),
    })),
    connectors: [...connectorCounts.entries()]
      .map(([connector, uses]) => ({ connector, uses }))
      .sort((a, b) => b.uses - a.uses),
    citedResources: [...citedCounts.values()].sort((a, b) => b.count - a.count),
    storage: [...storageMap.values()].sort((a, b) => b.sizeBytes - a.sizeBytes),
    recentMessages: recent
      .map((r) => ({
        region: r.__region,
        timestamp: r['@timestamp'],
        message: r.user_message,
        status: r.status_code,
        // suppress placeholder values so the UI only badges real agent/flow runs
        agentId: ['SYSTEM', '-'].includes(r.agent_id ?? '') ? '' : r.agent_id,
        flowId: ['SYSTEM', '-'].includes(r.flow_id ?? '') ? '' : r.flow_id,
        conversationId: r.conversation_id,
        surface: r.surface_type,
        reply: r.system_text_message ?? '',
      }))
      .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
      .slice(0, 100),
  };
}

// ---------------------------------------------------------- caller identity

interface Caller {
  username: string;
  isAdmin: boolean;
}

function getCaller(event: APIGatewayProxyEventV2WithJWTAuthorizer): Caller {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const username = String(claims['cognito:username'] ?? '');
  const raw = claims['cognito:groups'];
  let groups: string[] = [];
  if (Array.isArray(raw)) {
    groups = raw.map(String);
  } else if (typeof raw === 'string') {
    // The JWT authorizer stringifies the array as "[admins other]"
    groups = raw.replace(/^\[|\]$/g, '').split(/[,\s]+/).filter(Boolean);
  }
  return { username, isAdmin: groups.includes(ADMIN_GROUP) };
}

async function callerPermissions(caller: Caller): Promise<Permissions> {
  return caller.isAdmin ? { ...FULL_ACCESS } : getPermissions(caller.username);
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ------------------------------------------------------------- admin routes

async function handleAdmin(
  path: string,
  method: string,
  event: APIGatewayProxyEventV2,
  caller: Caller,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event);
  const username = typeof body.username === 'string' ? body.username : '';

  if (path === '/api/admin/users' && method === 'GET') {
    return json(200, await listDashboardUsers());
  }
  if (path === '/api/admin/users' && method === 'POST') {
    return json(200, await inviteUser(String(body.email ?? '')));
  }
  if (path === '/api/admin/users/resend' && method === 'POST') {
    if (!username) return json(400, { error: 'Missing username' });
    await resendInvite(username);
    return json(200, { ok: true });
  }
  if (path === '/api/admin/users/reset-password' && method === 'POST') {
    if (!username) return json(400, { error: 'Missing username' });
    await resetPassword(username);
    return json(200, { ok: true });
  }
  if (path === '/api/admin/users/delete' && method === 'POST') {
    if (!username) return json(400, { error: 'Missing username' });
    await deleteUser(username, caller.username);
    return json(200, { ok: true });
  }
  if (path === '/api/admin/permissions' && method === 'PUT') {
    if (!username) return json(400, { error: 'Missing username' });
    return json(200, await setPermissions(username, body.permissions));
  }
  return json(404, { error: 'Not found' });
}

// ------------------------------------------------------------------ handler

/** Permission each data route requires (absent = any authenticated user). */
const ROUTE_PERMISSION: Record<string, PermissionKey> = {
  '/api/overview': 'dashboard',
  '/api/users': 'users',
  '/api/user': 'users',
  '/api/storage': 'storage',
  '/api/kb-sync': 'kbSync',
  '/api/status': 'regions',
};

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath.replace(/\/$/, '');
  const method = event.requestContext.http.method;
  const range = parseRange(event);
  const caller = getCaller(event);

  try {
    if (!await authorize(event.requestContext.authorizer?.jwt?.claims ?? {})) return json(403, { error: 'Membership of an authorized Identity Center monitoring group is required' });
    if (method !== 'GET') return json(405, { error: 'This monitoring dashboard is read-only' });
    if (path.startsWith('/api/monitor/')) {
      const result = await monitor(path, range.start, range.end);
      return result === undefined ? json(404, { error: 'Not found' }) : json(200, result);
    }
    if (path.startsWith('/api/admin')) {
      return json(403, { error: 'Manage access in IAM Identity Center' });
      if (!caller.isAdmin) return json(403, { error: 'Admin access required' });
      return await handleAdmin(path, method, event, caller);
    }
    if (path === '/api/me/permissions') {
      return json(200, FULL_ACCESS);
    }

    const needed = ROUTE_PERMISSION[path];
    const perms = needed ? await callerPermissions(caller) : null;
    if (needed && perms && !perms[needed]) {
      return json(403, { error: 'You do not have access to this section' });
    }

    if (path === '/api/status') {
      return json(200, await regionStatus());
    }
    if (path === '/api/overview') {
      const data = await cached(`overview:${range.key}`, () => getOverview(range));
      return json(200, data);
    }
    if (path === '/api/users') {
      const data = await cached(`users:${range.key}`, () => getUsers(range));
      return json(200, data);
    }
    if (path === '/api/user') {
      const arn = event.queryStringParameters?.arn;
      if (!arn) return json(400, { error: 'Missing arn query parameter' });
      const data = await cached(`user:${arn}:${range.key}`, () => getUser(arn, range));
      // Chat content is permission-gated separately from usage metrics
      if (perms && !perms.chatLogs) {
        return json(200, { ...data, recentMessages: [], chatLogsHidden: true });
      }
      return json(200, data);
    }
    if (path === '/api/storage') {
      const data = await cached(`storage:${range.key}`, () => getStorage(range));
      return json(200, data);
    }
    if (path === '/api/kb-sync') {
      const data = await cached(`kb-sync:${range.key}`, () => getKbSync(range));
      return json(200, data);
    }
    return json(404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof AdminError) {
      return json(err.statusCode, { error: err.message });
    }
    console.error(err);
    return json(500, { error: 'Internal error', detail: (err as Error).message });
  }
}
