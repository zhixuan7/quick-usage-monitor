/**
 * Report assembly: pulls data from the existing (permission-enforced) API
 * endpoints and shapes it into a ReportDoc for preview and export.
 *
 * Aggregated reports tolerate missing sections: if the caller lacks a
 * permission the API returns 403 for that endpoint and the section is
 * replaced with an explanatory note instead of failing the whole report.
 */
import {
  fetchOverview, fetchUsers, fetchStorage, fetchKbSync, fetchStatus, fetchUser,
} from './api';
import type { TimeRange } from './timerange';
import type { ReportDoc, ReportSection } from './report-format';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function periodLabel(range: TimeRange): string {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const days = Math.max(1, Math.round((range.end - range.start) / 86_400_000));
  return `${day(range.start)} to ${day(range.end)} (${days} day${days === 1 ? '' : 's'})`;
}

const skipped = (title: string, err: unknown): ReportSection => ({
  title,
  note: `Section not included: ${(err as Error).message}`,
});

export async function buildAggregatedReport(range: TimeRange): Promise<ReportDoc> {
  const [overview, users, storage, kbSync, status] = await Promise.allSettled([
    fetchOverview(range),
    fetchUsers(range),
    fetchStorage(range),
    fetchKbSync(range),
    fetchStatus(),
  ]);

  const sections: ReportSection[] = [];

  // Summary + overview-derived sections
  if (overview.status === 'fulfilled') {
    const o = overview.value;
    const positive = Object.entries(o.kpis.feedback)
      .filter(([k]) => /useful|positive|up/i.test(k) && !/not/i.test(k))
      .reduce((s, [, v]) => s + v, 0);
    const totalFeedback = Object.values(o.kpis.feedback).reduce((s, v) => s + v, 0);
    sections.push({
      title: 'Summary',
      kpis: [
        { label: 'Active users', value: o.kpis.activeUsers },
        { label: 'Chat messages', value: o.kpis.totalMessages.toLocaleString() },
        { label: 'Conversations', value: o.kpis.totalConversations.toLocaleString() },
        { label: 'Agent hours', value: o.kpis.totalAgentHours },
        {
          label: 'Positive feedback',
          value: totalFeedback > 0 ? `${Math.round((positive / totalFeedback) * 100)}% of ${totalFeedback}` : 'No ratings',
        },
        { label: 'Regions monitored', value: o.queriedRegions.join(', ') || '—' },
      ],
    });
    sections.push({
      title: 'Top users',
      table: {
        columns: ['User', 'Messages', 'Agent hours'],
        rows: o.topUsers.map((u) => [u.userName, u.messages, u.agentHours]),
      },
    });
    sections.push({
      title: 'Usage by region',
      table: {
        columns: ['Region', 'Messages', 'Agent hours'],
        rows: o.byRegion.map((r) => [r.region, r.messages, r.agentHours]),
      },
    });
    sections.push({
      title: 'Agent hours by service',
      table: {
        columns: ['Service', 'Hours'],
        rows: o.hoursByService.map((h) => [h.service, h.hours]),
      },
    });
    sections.push({
      title: 'Connector usage',
      table: {
        columns: ['Connector', 'Uses', 'Distinct users'],
        rows: o.connectors.map((c) => [c.connector, c.uses, c.users]),
      },
    });
    sections.push({
      title: 'Chat activity over time',
      table: {
        columns: ['Time', 'Messages'],
        rows: o.series.map((p) => [p.time, p.messages]),
      },
    });
  } else {
    sections.push(skipped('Summary', overview.reason));
  }

  if (users.status === 'fulfilled') {
    sections.push({
      title: 'All users detail',
      table: {
        columns: ['User', 'Messages', 'Conversations', 'Agents', 'Flows', 'Agent hours', 'Feedback +', 'Feedback -', 'Regions'],
        rows: users.value.map((u) => [
          u.userName, u.messages, u.conversations, u.agents, u.flows,
          u.agentHours, u.feedbackPositive, u.feedbackNegative, u.regions.join(', '),
        ]),
      },
    });
  } else {
    sections.push(skipped('All users detail', users.reason));
  }

  if (storage.status === 'fulfilled') {
    const st = storage.value;
    sections.push({
      title: 'Storage',
      kpis: [
        { label: 'Total index size', value: formatBytes(st.totalIndexBytes) },
        { label: 'Sources', value: st.sources.length },
      ],
      table: {
        columns: ['Source', 'Type', 'Region', 'Size', 'Documents', 'Last change by'],
        rows: st.sources.map((s) => [
          s.sourceName, s.sourceType, s.region, formatBytes(s.sizeBytes), s.docCount, s.lastUpdatedBy || '—',
        ]),
      },
    });
  } else {
    sections.push(skipped('Storage', storage.reason));
  }

  if (kbSync.status === 'fulfilled') {
    const kb = kbSync.value;
    sections.push({
      title: 'Knowledge base sync',
      kpis: Object.entries(kb.statuses).map(([label, value]) => ({ label, value: value.toLocaleString() })),
      table: {
        columns: ['Time', 'Document', 'Status', 'Error type', 'Error message', 'Region'],
        rows: kb.failures.slice(0, 25).map((f) => [
          f.timestamp, f.documentTitle || f.sourceUri, f.status, f.errorType, f.errorMessage, f.region,
        ]),
      },
      note: kb.failures.length === 0 ? 'No failed or skipped documents in this period.' : undefined,
    });
  } else {
    sections.push(skipped('Knowledge base sync', kbSync.reason));
  }

  if (status.status === 'fulfilled') {
    sections.push({
      title: 'Region pipelines',
      table: {
        columns: ['Region', 'Status', 'Log types', 'Detail'],
        rows: status.value.regions.map((r) => [r.region, r.status, r.logTypes.join(', '), r.detail ?? '—']),
      },
    });
  } else {
    sections.push(skipped('Region pipelines', status.reason));
  }

  return {
    title: 'Quick usage report — account summary',
    subtitle: 'Aggregated Amazon Quick usage across all monitored regions',
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    periodLabel: periodLabel(range),
    sections,
  };
}

export async function buildUserReport(arn: string, range: TimeRange): Promise<ReportDoc> {
  const u = await fetchUser(arn, range);

  const sections: ReportSection[] = [
    {
      title: 'Summary',
      kpis: [
        { label: 'Messages', value: u.totals.messages.toLocaleString() },
        { label: 'Conversations', value: u.totals.conversations },
        { label: 'Agents used', value: u.totals.agents },
        { label: 'Flows used', value: u.totals.flows },
        { label: 'Agent hours', value: u.totals.agentHours },
      ],
    },
    {
      title: 'Usage by region',
      table: {
        columns: ['Region', 'Messages', 'Agent hours'],
        rows: u.byRegion.map((r) => [r.region, r.messages, r.agentHours]),
      },
    },
    {
      title: 'Agent hours detail',
      table: {
        columns: ['Service', 'Billing group', 'Region', 'Hours'],
        rows: u.agentHours.map((h) => [h.service, h.group, h.region, h.hours]),
      },
    },
    {
      title: 'Feedback given',
      table: {
        columns: ['Type', 'Reason', 'Region', 'Count'],
        rows: u.feedback.map((f) => [f.type, f.reason || '—', f.region, f.count]),
      },
    },
    {
      title: 'Connectors used',
      table: {
        columns: ['Connector', 'Uses'],
        rows: u.connectors.map((c) => [c.connector, c.uses]),
      },
    },
    {
      title: 'Spaces and resources referenced',
      table: {
        columns: ['Resource', 'Type', 'Citations'],
        rows: u.citedResources.map((c) => [c.name, c.type || '—', c.count]),
      },
    },
    {
      title: 'Spaces and knowledge bases owned or updated',
      table: {
        columns: ['Name', 'Type', 'Region', 'Size', 'Documents', 'Last change'],
        rows: u.storage.map((s) => [
          s.sourceName, s.sourceType, s.region, formatBytes(s.sizeBytes), s.docCount, s.lastEvent,
        ]),
      },
    },
    {
      title: 'Chat activity over time',
      table: {
        columns: ['Time', 'Messages'],
        rows: u.series.map((p) => [p.time, p.messages]),
      },
    },
    u.chatLogsHidden
      ? {
          title: 'Recent conversations',
          note: 'Chat logs are hidden for your account and were not included in this report.',
        }
      : {
          title: 'Recent conversations',
          table: {
            columns: ['Time', 'Region', 'Status', 'Surface', 'Message', 'Agent reply'],
            rows: u.recentMessages.map((m) => [
              m.timestamp, m.region, m.status, m.surface, m.message, m.reply,
            ]),
          },
        },
  ];

  return {
    title: `Quick usage report — ${u.userName}`,
    subtitle: u.userArn,
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    periodLabel: periodLabel(range),
    sections,
  };
}

// -------------------------------------------------------------- downloads

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Open the HTML report in a new tab and trigger the print dialog (PDF). */
export function printHtml(html: string): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  // Give the new document a moment to layout before printing
  setTimeout(() => w.print(), 350);
}
