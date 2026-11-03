/**
 * Cross-region CloudWatch Logs Insights query engine.
 *
 * Runs a Logs Insights query against a Quick vended log group in a single
 * region, and helpers to fan the same query out across every active region
 * and merge the results.
 */
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  StopQueryCommand,
} from '@aws-sdk/client-cloudwatch-logs';

const LOG_GROUP_PREFIX = '/aws/vendedlogs/quick-monitor';
const clients = new Map<string, CloudWatchLogsClient>();

function client(region: string): CloudWatchLogsClient {
  let c = clients.get(region);
  if (!c) {
    c = new CloudWatchLogsClient({ region });
    clients.set(region, c);
  }
  return c;
}

export type Row = Record<string, string>;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Run a Logs Insights query in one region. Returns [] if the log group does
 * not exist in that region (Quick unsupported there) or the query times out.
 */
export async function runQuery(
  region: string,
  logGroupKey: 'chat' | 'feedback' | 'agent-hours' | 'index-usage' | 'kb-file-sync' | 'agent-metadata' | 'audit',
  query: string,
  startTime: number,
  endTime: number,
  timeoutMs = 20000,
): Promise<Row[]> {
  const logGroupName = logGroupKey === 'audit' ? process.env.AUDIT_LOG_GROUP! : `${LOG_GROUP_PREFIX}/${logGroupKey}`;
  let queryId: string | undefined;
  try {
    const started = await client(region).send(
      new StartQueryCommand({
        logGroupNames: [logGroupName],
        queryString: query,
        startTime: Math.floor(startTime / 1000),
        endTime: Math.floor(endTime / 1000),
      }),
    );
    queryId = started.queryId;
  } catch (err) {
    const e = err as { name?: string };
    if (e.name === 'ResourceNotFoundException') throw new Error(`Log source unavailable: ${region}/${logGroupKey}`);
    throw err;
  }
  if (!queryId) throw new Error('CloudWatch did not return a query ID');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(400);
    const res = await client(region).send(new GetQueryResultsCommand({ queryId }));
    if (res.status === 'Complete') {
      return (res.results ?? []).map((fields) => {
        const row: Row = {};
        for (const f of fields) {
          if (f.field && f.field !== '@ptr') row[f.field] = f.value ?? '';
        }
        return row;
      });
    }
    if (res.status === 'Failed' || res.status === 'Cancelled') throw new Error(`Insights query ${res.status}`);
  }
  await client(region).send(new StopQueryCommand({queryId})).catch(() => undefined);
  throw new Error('Query timed out. Select a shorter date range.');
}

/** Fan the same query out to all regions; tag each row with its region. */
export async function runQueryAllRegions(
  regions: string[],
  logGroupKey: Parameters<typeof runQuery>[1],
  query: string,
  startTime: number,
  endTime: number,
): Promise<Row[]> {
  const perRegion = await Promise.all(
    regions.map(async (region) => {
      try {
        const rows = await runQuery(region, logGroupKey, query, startTime, endTime);
        return rows.map((r) => ({ ...r, __region: region }));
      } catch (err) {
        console.error(`Query failed in ${region}: ${(err as Error).message}`);
        throw err;
      }
    }),
  );
  return perRegion.flat();
}

export const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
