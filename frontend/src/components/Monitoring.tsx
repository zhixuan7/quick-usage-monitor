"use client";
import { useEffect, useMemo, useState } from "react";
import Shell from "./Shell";
import {
  PageHeader,
  Panel,
  ErrorBox,
  EmptyState,
  Pager,
  usePager,
} from "./shared";
import { request } from "@/lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

type Row = Record<string, any>;
type Column = [string, string];
const display = (v: any): string =>
  v == null
    ? "—"
    : Array.isArray(v)
      ? v
          .map((x) =>
            typeof x === "object"
              ? (x.name ?? x.Principal ?? JSON.stringify(x))
              : x,
          )
          .join(", ")
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
function Grid({ items, columns }: { items: Row[]; columns: Column[] }) {
  const pager = usePager(items);
  const [selected, setSelected] = useState<Row | null>(null);
  return (
    <>
      {items.length ? (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map(([k, label]) => (
                    <TableHead key={k}>{label}</TableHead>
                  ))}
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.view.map((r, i) => (
                  <TableRow key={r.id ?? `${pager.page}-${i}`}>
                    {columns.map(([k]) => (
                      <TableCell
                        key={k}
                        className="max-w-xs break-words align-top"
                      >
                        {display(r[k])}
                      </TableCell>
                    ))}
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelected(r)}
                      >
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager {...pager} onChange={pager.setPage} />
        </>
      ) : (
        <EmptyState message="No records for the selected filters." />
      )}
      {selected && (
        <section className="mt-4 border-t pt-4">
          <div className="mb-2 flex justify-between">
            <h2 className="font-medium">Record details</h2>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-4 text-xs">
            {JSON.stringify(selected, null, 2)}
          </pre>
        </section>
      )}
    </>
  );
}
const settings: Record<
  string,
  { title: string; description: string; endpoint: string; columns: Column[] }
> = {
  directory: {
    title: "Users & Identity Center groups",
    description:
      "Directory membership and matched Quick accounts. Users in multiple groups appear once in the directory total.",
    endpoint: "directory",
    columns: [
      ["name", "User"],
      ["email", "Email"],
      ["groups", "Groups"],
      ["quickRoles", "Quick roles"],
      ["lastActivity", "Latest chat activity"],
      ["messages", "Messages in period"],
    ],
  },
  agents: {
    title: "Agents & permissions",
    description:
      "Agent inventory, creator details, permissions and lifecycle history in one place.",
    endpoint: "agents",
    columns: [
      ["name", "Agent"],
      ["status", "Status"],
      ["creatorDisplay", "Creator"],
      ["updatedAt", "Last service update"],
      ["region", "Region"],
    ],
  },
  connectors: {
    title: "Connector configuration",
    description:
      "Authentication type, enabled actions and configuration history. Secrets are excluded.",
    endpoint: "connectors",
    columns: [
      ["name", "Connector"],
      ["type", "Type"],
      ["status", "Status"],
      ["authenticationType", "Authentication"],
      ["enabledActions", "Enabled actions"],
    ],
  },
  invocations: {
    title: "Connector invocations",
    description:
      "Actual InvokeAction audit events. Connector availability in a conversation is not counted as an invocation.",
    endpoint: "invocations",
    columns: [
      ["timestamp", "Time"],
      ["actor", "Actor"],
      ["connectorName", "Connector"],
      ["action", "Action"],
      ["status", "Outcome"],
      ["httpStatus", "HTTP status"],
    ],
  },
  relationships: {
    title: "Agent–connector relationships",
    description:
      "Explicit configuration from DescribeAgent. An attachment does not establish that a connector was invoked.",
    endpoint: "agents",
    columns: [
      ["agentName", "Agent"],
      ["connectorName", "Configured connector"],
      ["region", "Region"],
      ["observedAt", "Last observed"],
    ],
  },
  audit: {
    title: "Audit timeline",
    description:
      "Recorded management and invocation events. Up to the latest 1,000 events per selected period; narrow the period for busy accounts.",
    endpoint: "audit",
    columns: [
      ["timestamp", "Time"],
      ["event", "Event"],
      ["actor", "Actor"],
      ["region", "Region"],
      ["status", "Outcome"],
    ],
  },
};
export default function Monitoring({ category }: { category: string }) {
  const cfg = settings[category];
  const [data, setData] = useState<Row | null>(null);
  const [events, setEvents] = useState<Row[]>([]);
  const [history, setHistory] = useState<Row[]>([]);
  const [historyInterval, setHistoryInterval] = useState(15);
  const [connectors, setConnectors] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [hours, setHours] = useState("168");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [agentTab, setAgentTab] = useState<"inventory" | "permissions">(
    "inventory",
  );
  const permissionsTab = category === "agents" && agentTab === "permissions";
  useEffect(() => {
    if (
      category === "agents" &&
      new URLSearchParams(window.location.search).get("tab") === "permissions"
    )
      setAgentTab("permissions");
  }, [category]);
  function selectAgentTab(tab: "inventory" | "permissions") {
    setAgentTab(tab);
    const url = new URL(window.location.href);
    if (tab === "permissions") url.searchParams.set("tab", tab);
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    setEvents([]);
    setHistory([]);
    async function load() {
      const value = await request<Row>(
        "GET",
        `/api/monitor/${cfg.endpoint}?hours=${hours}`,
      );
      if (category === "directory") {
        const usage = await request<Row[]>("GET", `/api/users?hours=${hours}`);
        value.users = value.users.map((u: Row) => {
          const arns = new Set(u.quickAccounts.map((q: Row) => q.arn));
          const rows = usage.filter((r) => arns.has(r.userArn));
          return {
            ...u,
            quickRoles: [
              ...new Set(u.quickAccounts.map((q: Row) => q.role)),
            ].join(", "),
            messages: rows.reduce((n, r) => n + r.messages, 0),
            lastActivity: rows.length
              ? "Active in selected period"
              : "No recorded chats",
          };
        });
      }
      if (active) setData(value);
      if (category === "agents") {
        const e = await request<Row>(
          "GET",
          `/api/monitor/agent-events?hours=${hours}`,
        );
        if (active) {
          setEvents(e.items ?? []);
          if (e.errors?.length)
            setError(
              `Some agent event sources are unavailable: ${e.errors.map((x: Row) => x.region + ": " + x.error).join("; ")}`,
            );
        }
      }
      if (["agents", "connectors", "relationships"].includes(category)) {
        const h = await request<Row>(
          "GET",
          `/api/monitor/history?hours=${hours}`,
        );
        if (active) {
          setHistoryInterval(h.intervalMinutes ?? 15);
          setHistory(
            h.items.filter((x: Row) =>
              category === "connectors"
                ? x.resourceType.startsWith("connector:")
                : x.resourceType.startsWith("agent:"),
            ),
          );
        }
      }
      if (category === "relationships") {
        const c = await request<Row>("GET", "/api/monitor/connectors");
        if (active) setConnectors(c.items ?? []);
      }
    }
    load()
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [category, cfg.endpoint, hours, refresh]);
  const allRows: Row[] = useMemo(() => {
    if (!data) return [];
    if (category === "directory")
      return (data.users ?? []).filter(
        (u: Row) => !group || u.groups.some((g: Row) => g.id === group),
      );
    if (permissionsTab)
      return (data.items ?? [])
        .filter((a: Row) => !a.deletedAt)
        .flatMap((a: Row) =>
          a.permissions.map((p: Row) => ({
            agentName: a.name,
            principal: p.PrincipalDisplay ?? p.Principal,
            principalId: p.Principal,
            actions: p.Actions,
            region: a.region,
            observedAt: a.observedAt,
          })),
        );
    if (category === "relationships")
      return (data.items ?? [])
        .filter((a: Row) => !a.deletedAt)
        .flatMap((a: Row) =>
          a.connectors.map((c: string) => ({
            agentName: a.name,
            connectorName:
              connectors.find(
                (x) => x.region === a.region && (x.id === c || x.arn === c),
              )?.name ?? c,
            region: a.region,
            observedAt: a.observedAt,
          })),
        );
    return data.items ?? [];
  }, [data, category, group, connectors, permissionsTab]);
  const filtered = allRows.filter((r) =>
    JSON.stringify(r).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Shell>
      <PageHeader
        title={cfg.title}
        subtitle={cfg.description}
        right={
          <Button
            variant="outline"
            onClick={() => setRefresh((n) => n + 1)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
        }
      />
      {category === "agents" && (
        <div className="mb-5 flex gap-2" role="group" aria-label="Agent views">
          <Button
            variant={agentTab === "inventory" ? "default" : "outline"}
            aria-pressed={agentTab === "inventory"}
            onClick={() => selectAgentTab("inventory")}
          >
            Agent inventory
          </Button>
          <Button
            variant={permissionsTab ? "default" : "outline"}
            aria-pressed={permissionsTab}
            onClick={() => selectAgentTab("permissions")}
          >
            Permissions
          </Button>
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-3">
        <Input
          aria-label="Search records"
          placeholder="Search records"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <select
          aria-label="Time period"
          className="rounded-md border bg-white px-3 text-sm"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        >
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="2160">Last 90 days</option>
        </select>
        {category === "directory" && (
          <select
            aria-label="Identity Center group"
            className="max-w-full rounded-md border bg-white p-2 text-sm"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="">All groups</option>
            {data?.groups?.map((g: Row) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.memberIds.length})
              </option>
            ))}
          </select>
        )}
      </div>
      {error && (
        <div className="mb-4">
          <ErrorBox message={error} />
        </div>
      )}
      {loading && !data && (
        <p role="status" className="py-10 text-muted-foreground">
          Loading monitoring records…
        </p>
      )}
      {data && (
        <>
          {category === "relationships" && (
            <p className="mb-4 text-sm text-muted-foreground">
              Agents without explicit connector attachments are not shown here.
              Quick may make permitted connectors available dynamically; this
              page does not represent effective user access.
            </p>
          )}
          <div className="mt-4">
            <Panel title={`${filtered.length} records`}>
              <Grid
                key={permissionsTab ? "permissions" : "inventory"}
                items={filtered}
                columns={
                  permissionsTab
                    ? [
                        ["agentName", "Agent"],
                        ["principal", "User / group"],
                        ["actions", "Allowed actions"],
                        ["region", "Region"],
                      ]
                    : cfg.columns
                }
              />
            </Panel>
          </div>
          {category === "agents" && (
            <div className="mt-6">
              <Panel
                title={
                  permissionsTab ? "Permission changes" : "Agent audit events"
                }
              >
                <Grid
                  items={events.filter(
                    (r) =>
                      (!permissionsTab || /Permission/.test(r.event)) &&
                      JSON.stringify(r)
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )}
                  columns={[
                    ["timestamp", "Time"],
                    ["event", "Operation"],
                    ["actor", "Actor"],
                    ["agentName", "Agent"],
                    ["granted", "Granted"],
                    ["revoked", "Revoked"],
                  ]}
                />
              </Panel>
            </div>
          )}
          {["agents", "connectors", "relationships"].includes(category) && (
            <div className="mt-6">
              <Panel title="Configuration history">
                <p className="mb-3 text-sm text-muted-foreground">
                  Saved configuration checks run every {historyInterval}{" "}
                  minutes. The initial record is the starting configuration;
                  later records show differences found by a check. These times
                  show when a change was noticed. Use audit events for recorded
                  action times and actors.
                </p>
                <Grid
                  items={history
                    .filter((r) =>
                      JSON.stringify(r)
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((r) => ({
                      ...r,
                      changeType:
                        (
                          {
                            BaselineObserved: "Initial configuration",
                            SnapshotChanged: "Configuration changed",
                            MissingFromSuccessfulInventory:
                              "Missing from inventory",
                          } as Record<string, string>
                        )[r.event] ?? r.event,
                    }))}
                  columns={[
                    ["observedAt", "Observed at"],
                    ["changeType", "Change"],
                    ["resourceName", "Resource"],
                    ["changedFields", "Changed fields"],
                  ]}
                />
              </Panel>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
