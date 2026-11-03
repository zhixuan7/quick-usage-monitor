import {
  IdentitystoreClient,
  ListUsersCommand,
  ListGroupsCommand,
  ListGroupMembershipsCommand,
} from "@aws-sdk/client-identitystore";
import {
  QuickSightClient,
  ListAgentsCommand,
  DescribeAgentCommand,
  DescribeAgentPermissionsCommand,
  ListActionConnectorsCommand,
  DescribeActionConnectorCommand,
  DescribeActionConnectorPermissionsCommand,
  ListNamespacesCommand,
  ListUsersCommand as ListQuickUsers,
} from "@aws-sdk/client-quicksight";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  fingerprint,
  changedFields,
  matchIdentity,
  safeConnector,
} from "./model";
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TableName = process.env.INVENTORY_TABLE!;
const store = new IdentitystoreClient({ region: process.env.IDENTITY_REGION });
const IdentityStoreId = process.env.IDENTITY_STORE_ID!;
const AwsAccountId = process.env.ACCOUNT_ID!;
async function all(
  client: any,
  Command: any,
  args: any,
  key: string,
): Promise<any[]> {
  const rows: any[] = [];
  let NextToken;
  do {
    const res: any = await client.send(new Command({ ...args, NextToken }));
    rows.push(...(res[key] ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return rows;
}
async function previous(pk: string) {
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
    rows.push(...(r.Items ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}
async function save(pk: string, items: any[], now: string) {
  const old = new Map((await previous(pk)).map((x) => [x.sk, x]));
  for (const data of items) {
    const sk = String(data.id);
    const hash = fingerprint(data);
    const prior = old.get(sk);
    if (prior?.hash !== hash) {
      // Snapshot observations are explicitly distinct from exact service audit events.
      await db.send(
        new PutCommand({
          TableName,
          Item: {
            pk: "history",
            sk: `${now}#${pk}#${sk}`,
            data: {
              id: sk,
              resourceType: pk,
              resourceName: data.name ?? sk,
              event: prior ? "SnapshotChanged" : "BaselineObserved",
              observedAt: now,
              changedFields: changedFields(prior?.data, data),
              before: prior?.data,
              after: data,
            },
            ttl: Math.floor(Date.now() / 1000) + 365 * 86400,
          },
        }),
      );
    }
    await db.send(
      new PutCommand({
        TableName,
        Item: { pk, sk, data, hash, observedAt: now },
      }),
    );
    old.delete(sk);
  }
  // Only called after a complete successful source enumeration, never after a failed scan.
  for (const [sk, item] of old)
    if (!item.data.deletedAt) {
      const data = { ...item.data, deletedAt: now };
      await db.send(
        new PutCommand({
          TableName,
          Item: { ...item, data, hash: fingerprint(data), observedAt: now },
        }),
      );
      await db.send(
        new PutCommand({
          TableName,
          Item: {
            pk: "history",
            sk: `${now}#${pk}#${sk}`,
            data: {
              id: sk,
              resourceType: pk,
              resourceName: data.name ?? sk,
              event: "MissingFromSuccessfulInventory",
              observedAt: now,
              before: item.data,
            },
            ttl: Math.floor(Date.now() / 1000) + 365 * 86400,
          },
        }),
      );
    }
}
export async function handler() {
  const now = new Date().toISOString();
  const sources: any[] = [];
  let users: any[] = [];
  async function collect(name: string, work: () => Promise<void>) {
    try {
      await work();
      sources.push({ name, status: "ok", checkedAt: now });
    } catch (e) {
      sources.push({
        name,
        status: "error",
        checkedAt: now,
        error: (e as Error).message,
      });
    }
  }
  await collect("identity-center", async () => {
    const raw = await all(
      store,
      ListUsersCommand,
      { IdentityStoreId },
      "Users",
    );
    users = raw.map((u) => ({
      id: u.UserId,
      name: u.DisplayName ?? u.UserName,
      email:
        (u.Emails ?? []).find((e: any) => e.Primary)?.Value ??
        u.Emails?.[0]?.Value ??
        "",
      username: u.UserName,
    }));
    const groups = await all(
      store,
      ListGroupsCommand,
      { IdentityStoreId },
      "Groups",
    );
    const rows = [];
    for (const g of groups) {
      const members = await all(
        store,
        ListGroupMembershipsCommand,
        { IdentityStoreId, GroupId: g.GroupId },
        "GroupMemberships",
      );
      rows.push({
        id: g.GroupId,
        name: g.DisplayName,
        memberIds: members.map((m) => m.MemberId?.UserId).filter(Boolean),
      });
    }
    await save("user", users, now);
    await save("group", rows, now);
  });
  for (const region of JSON.parse(process.env.QUICK_REGIONS!)) {
    const q = new QuickSightClient({ region });
    await collect(`quick-users:${region}`, async () => {
      const namespaces = await all(
        q,
        ListNamespacesCommand,
        { AwsAccountId },
        "Namespaces",
      );
      const rows = [];
      for (const ns of namespaces)
        for (const u of await all(
          q,
          ListQuickUsers,
          { AwsAccountId, Namespace: ns.Name },
          "UserList",
        ))
          rows.push({
            id: u.Arn,
            arn: u.Arn,
            name: u.UserName,
            email: u.Email,
            role: u.Role,
            active: u.Active,
            region,
            ...matchIdentity(u, users),
          });
      await save(`quick-user:${region}`, rows, now);
    });
    await collect(`agents:${region}`, async () => {
      const agents = await all(
        q,
        ListAgentsCommand,
        { AwsAccountId },
        "AgentSummaries",
      );
      const rows = [];
      for (const a of agents) {
        const res: any = await q.send(
          new DescribeAgentCommand({ AwsAccountId, AgentId: a.AgentId! }),
        );
        const agent = res.Agent!;
        const p = await q.send(
          new DescribeAgentPermissionsCommand({
            AwsAccountId,
            AgentId: a.AgentId!,
          }),
        );
        rows.push({
          id: a.AgentId,
          name: agent.Name,
          arn: agent.Arn,
          region,
          creator: agent.Creator,
          status: agent.AgentStatus,
          lifecycle: agent.AgentLifecycle,
          createdAt: agent.CreatedAt?.toISOString(),
          updatedAt: agent.UpdatedAt?.toISOString(),
          connectors: agent.ActionConnectors ?? [],
          spaces: agent.Spaces ?? [],
          permissions: p.Permissions ?? [],
        });
      }
      await save(`agent:${region}`, rows, now);
    });
    await collect(`connectors:${region}`, async () => {
      const connectors = await all(
        q,
        ListActionConnectorsCommand,
        { AwsAccountId },
        "ActionConnectorSummaries",
      );
      const rows = [];
      for (const c of connectors) {
        const r: any = await q.send(
          new DescribeActionConnectorCommand({
            AwsAccountId,
            ActionConnectorId: c.ActionConnectorId!,
          }),
        );
        const p = await q.send(
          new DescribeActionConnectorPermissionsCommand({
            AwsAccountId,
            ActionConnectorId: c.ActionConnectorId!,
          }),
        );
        rows.push({
          ...safeConnector(r.ActionConnector, region),
          permissions: p.Permissions ?? [],
        });
      }
      await save(`connector:${region}`, rows, now);
    });
  }
  const status = {
    updatedAt: now,
    sources,
    status: sources.some((s) => s.status === "error") ? "partial" : "ok",
  };
  await db.send(
    new PutCommand({
      TableName,
      Item: { pk: "system", sk: "sync", data: status },
    }),
  );
  console.log(JSON.stringify(status));
  return status;
}
