import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { federatedClaims } from "./federation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  IdentitystoreClient,
  ListGroupMembershipsForMemberCommand,
} from "@aws-sdk/client-identitystore";
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { parseEvidence, isServiceEvidence } from "./evidence";
import { runQuery } from "./insights";
import { nameLookup } from "./names";
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TableName = process.env.INVENTORY_TABLE!;
export async function inventory(pk: string) {
  const rows: any[] = [];
  let ExclusiveStartKey;
  do {
    const r: any = await db.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": pk },
        ExclusiveStartKey,
      }),
    );
    rows.push(
      ...(r.Items ?? []).map((x: any) => ({
        ...x.data,
        observedAt: x.observedAt ?? x.data?.observedAt,
      })),
    );
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}
export async function authorize(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
) {
  const claims = federatedClaims(event);
  if (!claims) {
    console.warn("MonitorAuthorizationDenied", {
      reason: "federation-claims-unavailable",
    });
    return false;
  }
  const users = (await inventory("user")).filter(
    (u) =>
      !u.deletedAt &&
      u.email?.toLowerCase() === String(claims.email ?? "").toLowerCase(),
  );
  if (users.length !== 1) {
    console.warn("MonitorAuthorizationDenied", {
      reason: "directory-match-not-unique",
      matchCount: users.length,
    });
    return false;
  }
  const store = new IdentitystoreClient({
    region: process.env.IDENTITY_REGION,
  });
  let NextToken;
  do {
    const r: any = await store.send(
      new ListGroupMembershipsForMemberCommand({
        IdentityStoreId: process.env.IDENTITY_STORE_ID!,
        MemberId: { UserId: users[0].id },
        NextToken,
      }),
    );
    if (
      r.GroupMemberships?.some((m: any) =>
        JSON.parse(process.env.ALLOWED_GROUP_IDS!).includes(m.GroupId),
      )
    )
      return true;
    NextToken = r.NextToken;
  } while (NextToken);
  console.warn("MonitorAuthorizationDenied", {
    reason: "monitoring-group-not-assigned",
  });
  return false;
}
export async function monitor(path: string, start: number, end: number) {
  const regions: string[] = JSON.parse(process.env.QUICK_REGIONS!);
  if (path === "/api/monitor/directory") {
    const [users, groups, quickUsers] = await Promise.all([
      inventory("user"),
      inventory("group"),
      Promise.all(regions.map((r) => inventory(`quick-user:${r}`))).then((x) =>
        x.flat(),
      ),
    ]);
    return {
      users: users
        .filter((x) => !x.deletedAt)
        .map((u) => ({
          ...u,
          groups: groups
            .filter((g) => !g.deletedAt && g.memberIds.includes(u.id))
            .map((g) => ({ id: g.id, name: g.name })),
          quickAccounts: quickUsers.filter(
            (q) => !q.deletedAt && q.identityId === u.id,
          ),
        })),
      groups: groups.filter((x) => !x.deletedAt),
    };
  }
  if (path === "/api/monitor/history") {
    const items = await inventory("history");
    return {
      items: items
        .filter(
          (x) =>
            Date.parse(x.observedAt) >= start &&
            Date.parse(x.observedAt) <= end,
        )
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt)),
      kind: "inventory-observations",
      intervalMinutes: Number(process.env.SYNC_MINUTES ?? 15),
    };
  }
  if (path === "/api/monitor/agents" || path === "/api/monitor/connectors") {
    const type = path.endsWith("agents") ? "agent" : "connector";
    const items = (
      await Promise.all(regions.map((r) => inventory(`${type}:${r}`)))
    ).flat();
    if (type === "connector") return { items };
    const [users, quickUsers] = await Promise.all([
      inventory("user"),
      Promise.all(regions.map((r) => inventory(`quick-user:${r}`))).then(
        (rows) => rows.flat(),
      ),
    ]);
    const names = nameLookup(users, quickUsers, []);
    return {
      items: items.map((agent) => {
        const creator = names.person(agent.creator);
        return {
          ...agent,
          creatorName: creator?.name,
          creatorEmail: creator?.email,
          creatorDisplay: creator?.display || agent.creator || "System",
          permissions: (agent.permissions ?? []).map((permission: any) => ({
            ...permission,
            PrincipalDisplay:
              names.person(permission.Principal)?.display ||
              permission.Principal,
          })),
        };
      }),
    };
  }

  if (path === "/api/monitor/health") {
    const sync = await db.send(
      new GetCommand({ TableName, Key: { pk: "system", sk: "sync" } }),
    );
    const streams = await Promise.all(
      regions.map(async (region) => {
        const cw = new CloudWatchLogsClient({ region });
        const results = [];
        for (const key of [
          "chat",
          "feedback",
          "agent-hours",
          "index-usage",
          "kb-file-sync",
          "agent-metadata",
        ])
          try {
            const r: any = await cw.send(
              new DescribeLogStreamsCommand({
                logGroupName: `/aws/vendedlogs/quick-monitor/${key}`,
                orderBy: "LastEventTime",
                descending: true,
                limit: 5,
              }),
            );
            const samples = await Promise.all(
              (r.logStreams ?? []).map((stream: any) =>
                cw.send(
                  new GetLogEventsCommand({
                    logGroupName: `/aws/vendedlogs/quick-monitor/${key}`,
                    logStreamName: stream.logStreamName,
                    limit: 5,
                    startFromHead: false,
                  }),
                ),
              ),
            );
            const evidence = samples
              .flatMap((sample) => sample.events ?? [])
              .filter((e) => isServiceEvidence(e.message))
              .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
            results.push({
              region,
              source: key,
              lastEventAt: evidence.at(-1)?.timestamp,
              status: evidence.length ? "receiving" : "no-recent-sample",
            });
          } catch (e) {
            results.push({
              region,
              source: key,
              status: "unavailable",
              error: (e as Error).name,
            });
          }
        return results;
      }),
    );
    return {
      sync: sync.Item?.data ?? { status: "not-run" },
      stale:
        !sync.Item?.data?.updatedAt ||
        Date.now() - Date.parse(sync.Item.data.updatedAt) >
          Number(process.env.SYNC_MINUTES ?? 15) * 120000,
      streams: streams.flat(),
      auditLogGroup: process.env.AUDIT_LOG_GROUP,
    };
  }
  if (path === "/api/monitor/agent-events") {
    const parts = await Promise.allSettled(
      regions.map((r) =>
        runQuery(
          r,
          "agent-metadata",
          "fields @timestamp, @message | filter ispresent(event_name) | sort @timestamp desc | limit 1000",
          start,
          end,
        ),
      ),
    );
    return {
      items: parts.flatMap((p, i) =>
        p.status === "fulfilled"
          ? p.value.flatMap((row) => {
              const m = parseEvidence(row["@message"]);
              if (!m?.event_name) return [];
              return [
                {
                  timestamp: row["@timestamp"],
                  region: regions[i],
                  event: m.event_name,
                  actor: m.user_arn,
                  agentId: m.agent_id,
                  agentName: m.agent_name,
                  requestId: m.request_id,
                  granted: m.permissions_granted,
                  revoked: m.permissions_revoked,
                  permissions: m.permissions_state,
                  updateAction: m.update_action,
                },
              ];
            })
          : [],
      ),
      errors: parts.flatMap((p, i) =>
        p.status === "rejected"
          ? [{ region: regions[i], error: String(p.reason) }]
          : [],
      ),
      limit: 1000,
    };
  }
  if (path === "/api/monitor/audit" || path === "/api/monitor/invocations") {
    const query = path.endsWith("invocations")
      ? 'filter eventName = "InvokeAction"'
      : 'filter eventSource in ["quicksight.amazonaws.com", "identitystore.amazonaws.com", "sso-directory.amazonaws.com", "identitystore-scim.amazonaws.com", "sso.amazonaws.com"]';
    const rows = await runQuery(
      process.env.AWS_REGION!,
      "audit",
      `fields @timestamp, @message | ${query} | sort @timestamp desc | limit 1000`,
      start,
      end,
    );
    const items = rows.flatMap((row) => {
      const m = parseEvidence(row["@message"]);
      if (!m?.eventID) return [];
      return [
        {
          id: m.eventID,
          timestamp: m.eventTime ?? row["@timestamp"],
          region: m.awsRegion,
          event: m.eventName,
          source: m.eventSource,
          identityId: m.userIdentity?.onBehalfOf?.userId,
          actor:
            m.requestParameters?.endUserArn ??
            m.userIdentity?.arn ??
            m.userIdentity?.onBehalfOf?.userId ??
            m.userIdentity?.type,
          connectorId: m.requestParameters?.actionConnectorId,
          action: m.requestParameters?.actionId,
          status:
            m.errorCode ?? m.responseElements?.invokeActionStatus ?? "Recorded",
          httpStatus:
            m.responseElements?.invokeActionOutput?.httpInvokeActionOutput
              ?.httpStatusCode,
          error: m.errorCode,
          requestId: m.requestID,
          agentId: m.requestParameters?.agentId,
        },
      ];
    });
    const connectors = (
      await Promise.all(regions.map((r) => inventory(`connector:${r}`)))
    ).flat();
    const names = nameLookup([], [], connectors);
    return {
      items: [
        ...new Map(
          items.map((x) => [
            x.id,
            { ...x, connectorName: names.connector(x.connectorId, x.region) },
          ]),
        ).values(),
      ],
      limit: 1000,
    };
  }
  return undefined;
}
