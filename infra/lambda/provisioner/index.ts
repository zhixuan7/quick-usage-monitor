/**
 * Provisioner - CloudFormation custom resource handler.
 *
 * At deploy time, iterates over every configured AWS Region and provisions the
 * Amazon Quick vended log pipeline in each one:
 *
 *   log group  <-  delivery  <-  delivery destination  <-  delivery source (Quick account)
 *
 * Five log types are wired per region: CHAT_LOGS, FEEDBACK_LOGS, AGENT_HOURS_LOGS,
 * INDEX_USAGE_LOGS, KB_FILE_SYNC_LOGS. Regions where Quick vended logs are not
 * available are skipped gracefully and reported in the status document written
 * to SSM Parameter Store (read by the API to show region health in the UI).
 *
 * On stack deletion the deliveries/sources/destinations are removed but the log
 * groups (and therefore the collected usage data) are intentionally retained.
 */
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  PutRetentionPolicyCommand,
  PutDeliverySourceCommand,
  PutDeliveryDestinationCommand,
  CreateDeliveryCommand,
  DescribeDeliveriesCommand,
  DescribeDeliverySourcesCommand,
  DeleteDeliveryCommand,
  DeleteDeliverySourceCommand,
  DeleteDeliveryDestinationCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';

const PREFIX = 'quick-monitor';
const LOG_GROUP_PREFIX = '/aws/vendedlogs/quick-monitor';

interface LogTypeSpec {
  key: string; // short name used in resource names / log group path
  logType: string; // vended log type
  recordFields?: string[]; // optional explicit fields (chat includes non-default fields)
}

const LOG_TYPES: LogTypeSpec[] = [
  {
    key: 'chat',
    logType: 'CHAT_LOGS',
    recordFields: [
      'resource_arn', 'event_timestamp', 'logType', 'accountId', 'user_arn',
      'user_type', 'namespace', 'status_code', 'conversation_id', 'system_message_id',
      'latency', 'time_to_first_token', 'message_scope', 'user_message_id',
      'user_message', 'agent_id', 'flow_id', 'system_text_message', 'surface_type',
      'web_search', 'user_selected_resources', 'action_connectors', 'cited_resource',
      'file_attachment',
    ],
  },
  { key: 'agent-metadata', logType: 'AGENT_METADATA_LOGS' },
  { key: 'feedback', logType: 'FEEDBACK_LOGS' },
  { key: 'agent-hours', logType: 'AGENT_HOURS_LOGS' },
  { key: 'index-usage', logType: 'INDEX_USAGE_LOGS' },
  { key: 'kb-file-sync', logType: 'KB_FILE_SYNC_LOGS' },
];

interface RegionStatus {
  region: string;
  status: 'active' | 'unsupported' | 'error';
  detail?: string;
  logTypes: string[];
}

function isAlreadyExists(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  return (
    e?.name === 'ResourceAlreadyExistsException' ||
    e?.name === 'ConflictException' ||
    /already exists/i.test(e?.message ?? '')
  );
}

function isUnsupported(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  return (
    e?.name === 'ValidationException' ||
    e?.name === 'ServiceUnavailableException' ||
    // Opt-in regions not enabled for the account reject the credentials.
    e?.name === 'UnrecognizedClientException' ||
    e?.name === 'InvalidClientTokenId' ||
    /not supported|not available|invalid.*log ?type|security token included in the request is invalid/i.test(
      e?.message ?? '',
    )
  );
}

async function provisionRegion(
  region: string,
  accountId: string,
  retentionDays: number,
): Promise<RegionStatus> {
  const logs = new CloudWatchLogsClient({ region });
  const quickAccountArn = `arn:aws:quicksight:${region}:${accountId}:account/${accountId}`;
  const wired: string[] = [];

  for (const spec of LOG_TYPES) {
    const logGroupName = `${LOG_GROUP_PREFIX}/${spec.key}`;
    let sourceName = `${PREFIX}-${spec.key}-source`;
    const existingSources:any[]=[];let nextToken: string | undefined;
    do {const res=await logs.send(new DescribeDeliverySourcesCommand({nextToken}));existingSources.push(...res.deliverySources??[]);nextToken=res.nextToken;}while(nextToken);
    const existing=existingSources.find(s=>s.logType===spec.logType&&s.resourceArns?.includes(quickAccountArn));
    if(existing) sourceName=existing.name;

    const destName = `${PREFIX}-${spec.key}-dest`;

    try {
      // 1. Delivery source FIRST - this is the support probe. In regions where
      //    Amazon Quick (vs plain QuickSight) is not available this fails with
      //    a validation error, and we skip WITHOUT creating any log groups.
      if(!existing) await logs.send(
        new PutDeliverySourceCommand({
          name: sourceName,
          resourceArn: quickAccountArn,
          logType: spec.logType,
        }),
      );

      // 2. Log group (idempotent) + retention - only for supported log types
      try {
        await logs.send(new CreateLogGroupCommand({ logGroupName }));
      } catch (err) {
        if (!isAlreadyExists(err)) throw err;
      }
      await logs.send(
        new PutRetentionPolicyCommand({ logGroupName, retentionInDays: retentionDays }),
      );

      // 3. Delivery destination (upsert)
      const dest = await logs.send(
        new PutDeliveryDestinationCommand({
          name: destName,
          deliveryDestinationConfiguration: {
            destinationResourceArn: `arn:aws:logs:${region}:${accountId}:log-group:${logGroupName}:*`,
          },
        }),
      );

      // 4. Delivery (join). ConflictException means it already exists.
      try {
        await logs.send(
          new CreateDeliveryCommand({
            deliverySourceName: sourceName,
            deliveryDestinationArn: dest.deliveryDestination!.arn!,
            ...(spec.recordFields ? { recordFields: spec.recordFields } : {}),
          }),
        );
      } catch (err) {
        if (!isAlreadyExists(err)) throw err;
      }

      wired.push(spec.logType);
    } catch (err) {
      const e = err as Error;
      if (isUnsupported(err)) {
        console.log(`[${region}] ${spec.logType} unsupported: ${e.message}`);
        continue; // try remaining log types
      }
      console.error(`[${region}] ${spec.logType} failed: ${e.message}`);
      return { region, status: 'error', detail: e.message, logTypes: wired };
    }
  }

  if (wired.length === 0) {
    return { region, status: 'unsupported', detail: 'No Quick vended log types available', logTypes: [] };
  }
  return { region, status: 'active', logTypes: wired };
}

async function teardownRegion(region: string): Promise<void> {
  const logs = new CloudWatchLogsClient({ region });
  try {
    // Delete deliveries first (they reference sources/destinations)
    const deliveries = await logs.send(new DescribeDeliveriesCommand({}));
    for (const d of deliveries.deliveries ?? []) {
      if (d.deliveryDestinationArn?.includes(`delivery-destination:${PREFIX}-`) && d.id) {
        await logs.send(new DeleteDeliveryCommand({ id: d.id })).catch(() => undefined);
      }
    }
    for (const spec of LOG_TYPES) {
      await logs
        .send(new DeleteDeliverySourceCommand({ name: `${PREFIX}-${spec.key}-source` }))
        .catch(() => undefined);
      await logs
        .send(new DeleteDeliveryDestinationCommand({ name: `${PREFIX}-${spec.key}-dest` }))
        .catch(() => undefined);
      // Log groups are intentionally retained so usage history survives stack deletion.
    }
  } catch (err) {
    console.log(`[${region}] teardown skipped: ${(err as Error).message}`);
  }
}

export async function handler(event: CloudFormationCustomResourceEvent) {
  const props = event.ResourceProperties as unknown as {
    Regions: string[];
    AccountId: string;
    RetentionDays: string;
    StatusParameterName: string;
  };
  const regions: string[] = props.Regions;
  const accountId: string = props.AccountId;
  const retentionDays = Number(props.RetentionDays ?? 90);
  const statusParam: string = props.StatusParameterName;

  if (event.RequestType === 'Delete') {
    await Promise.all(regions.map((r) => teardownRegion(r)));
    return { PhysicalResourceId: 'quick-monitor-provisioner' };
  }

  // On Update, tear down pipelines in regions removed from the config.
  // Log groups (and their data) are intentionally retained.
  if (event.RequestType === 'Update') {
    const oldRegions: string[] =
      (event.OldResourceProperties as { Regions?: string[] } | undefined)?.Regions ?? [];
    const removed = oldRegions.filter((r) => !regions.includes(r));
    if (removed.length > 0) {
      console.log(`Tearing down removed regions: ${removed.join(', ')}`);
      await Promise.all(removed.map((r) => teardownRegion(r)));
    }
  }

  // Create / Update: provision every region in parallel
  const results = await Promise.all(
    regions.map((r) => provisionRegion(r, accountId, retentionDays)),
  );

  const ssm = new SSMClient({});
  await ssm.send(
    new PutParameterCommand({
      Name: statusParam,
      Type: 'String',
      Overwrite: true,
      Value: JSON.stringify({ updatedAt: new Date().toISOString(), regions: results }),
    }),
  );

  const active = results.filter((r) => r.status === 'active').map((r) => r.region);
  const failed = results.filter((r) => r.status === 'error');
  console.log(`Active regions: ${active.join(', ') || 'none'}`);
  if (failed.length > 0) {
    console.error(`Failed regions: ${JSON.stringify(failed)}`);
  }

  return {
    PhysicalResourceId: 'quick-monitor-provisioner',
    Data: { ActiveRegions: active.join(','), ActiveCount: String(active.length) },
  };
}
