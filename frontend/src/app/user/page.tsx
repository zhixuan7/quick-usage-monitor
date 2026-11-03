'use client';

/** Single user drill-down: totals, per-region split, timeline, storage, recent activity. */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar,
} from 'recharts';
import { ArrowLeft, EyeOff, Bot, Workflow } from 'lucide-react';
import Shell from '@/components/Shell';
import Markdown from '@/components/Markdown';
import DateRangePicker from '@/components/DateRangePicker';
import { DayRange, lastNDays, toTimeRange } from '@/lib/timerange';
import {
  PageHeader, KpiCard, Panel, ErrorBox, EmptyState,
  RegionBadge, StatusBadge, usePager, Pager, formatBytes,
  KpiSkeleton, ChartSkeleton, TableRowsSkeleton, PanelSkeleton,
} from '@/components/shared';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { fetchUser, UserDetail } from '@/lib/api';

function UserSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <KpiSkeleton count={5} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Activity over time" className="xl:col-span-2">
          <ChartSkeleton height={240} />
        </Panel>
        <Panel title="Usage by region">
          <ChartSkeleton height={240} />
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <PanelSkeleton lines={5} />
        <PanelSkeleton lines={5} />
      </div>
      <PanelSkeleton lines={6} />
    </div>
  );
}

function UserDetailInner() {
  const params = useSearchParams();
  const arn = params.get('arn') ?? '';
  const [range, setRange] = useState<DayRange>(() => lastNDays(7));
  const [data, setData] = useState<UserDetail | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (r: DayRange) => {
    if (!arn) return;
    setData(null);
    setError('');
    try {
      setData(await fetchUser(arn, toTimeRange(r)));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [arn]);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  const recentPager = usePager(data?.recentMessages ?? []);
  const hoursPager = usePager(data?.agentHours ?? []);
  const feedbackPager = usePager(data?.feedback ?? []);
  const connectorsPager = usePager(data?.connectors ?? []);
  const citedPager = usePager(data?.citedResources ?? []);
  const storagePager = usePager(data?.storage ?? []);

  if (!arn) return <ErrorBox message="No user specified." />;

  return (
    <>
      <div className="mb-4">
        <Link
          href="/users/"
          className="inline-flex items-center gap-1 text-sm font-medium text-quick-600 hover:text-quick-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All users
        </Link>
      </div>
      <PageHeader
        title={data?.userName ?? arn.split('/').pop() ?? 'User'}
        subtitle={arn}
        right={<DateRangePicker value={range} onChange={setRange} />}
      />

      {error && <ErrorBox message={error} />}
      {!data && !error && <UserSkeleton />}

      {data && (
        <div className="space-y-5 animate-fade-in-up">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
            <KpiCard label="Messages" value={data.totals.messages.toLocaleString()} />
            <KpiCard label="Conversations" value={data.totals.conversations} />
            <KpiCard label="Agents used" value={data.totals.agents} />
            <KpiCard label="Flows used" value={data.totals.flows} />
            <KpiCard label="Agent hours" value={data.totals.agentHours} />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Panel title="Activity over time" className="xl:col-span-2">
              {data.series.length === 0 ? (
                <EmptyState message="No chat activity in this period." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={data.series}>
                    <defs>
                      <linearGradient id="ugrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6842FF" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#6842FF" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E9E9EC" />
                    <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#69707D' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#69707D' }} width={36} />
                    <Tooltip />
                    <Area type="monotone" dataKey="messages" stroke="#6842FF" strokeWidth={2} fill="url(#ugrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Panel>

            <Panel title="Usage by region">
              {data.byRegion.length === 0 ? (
                <EmptyState message="No regional activity." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.byRegion} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E9E9EC" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#69707D' }} />
                    <YAxis type="category" dataKey="region" width={110} tick={{ fontSize: 11, fill: '#69707D' }} />
                    <Tooltip />
                    <Bar dataKey="messages" fill="#6842FF" radius={[0, 4, 4, 0]} name="Messages" />
                    <Bar dataKey="agentHours" fill="#D600BA" radius={[0, 4, 4, 0]} name="Agent hours" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="Agent hours detail">
              {data.agentHours.length === 0 ? (
                <EmptyState message="No agent hours recorded." />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Service</TableHead>
                        <TableHead>Region</TableHead>
                        <TableHead>Billing group</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hoursPager.view.map((h, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{h.service}</TableCell>
                          <TableCell><RegionBadge region={h.region} /></TableCell>
                          <TableCell>{h.group}</TableCell>
                          <TableCell className="text-right">{h.hours}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pager {...hoursPager} onChange={hoursPager.setPage} />
                </>
              )}
            </Panel>

            <Panel title="Feedback given">
              {data.feedback.length === 0 ? (
                <EmptyState message="No feedback recorded." />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Region</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {feedbackPager.view.map((f, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{f.type}</TableCell>
                          <TableCell>{f.reason || '—'}</TableCell>
                          <TableCell><RegionBadge region={f.region} /></TableCell>
                          <TableCell className="text-right">{f.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pager {...feedbackPager} onChange={feedbackPager.setPage} />
                </>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="Connectors available in conversations">
              {data.connectors.length === 0 ? (
                <EmptyState message="No connectors listed." />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Connector</TableHead>
                        <TableHead className="text-right">Conversations</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {connectorsPager.view.map((c) => (
                        <TableRow key={c.connector}>
                          <TableCell className="font-medium">{c.connector}</TableCell>
                          <TableCell className="text-right">{c.uses}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pager {...connectorsPager} onChange={connectorsPager.setPage} />
                </>
              )}
            </Panel>

            <Panel title="Spaces and resources referenced">
              {data.citedResources.length === 0 ? (
                <EmptyState message="No Spaces, dashboards, or KBs cited in this user's chats." />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Resource</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Citations</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {citedPager.view.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="max-w-md truncate font-medium" title={c.name}>{c.name}</TableCell>
                          <TableCell>
                            {c.type && <Badge variant="secondary" className="font-medium text-ink-700">{c.type}</Badge>}
                          </TableCell>
                          <TableCell className="text-right">{c.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pager {...citedPager} onChange={citedPager.setPage} />
                </>
              )}
            </Panel>
          </div>

          <Panel title="Spaces and knowledge bases owned or updated">
            {data.storage.length === 0 ? (
              <EmptyState message="No Spaces or knowledge bases created or updated by this user in this period." />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead className="text-right">Documents</TableHead>
                      <TableHead>Last change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {storagePager.view.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{s.sourceName}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-medium text-ink-700">{s.sourceType}</Badge>
                        </TableCell>
                        <TableCell><RegionBadge region={s.region} /></TableCell>
                        <TableCell className="text-right">{formatBytes(s.sizeBytes)}</TableCell>
                        <TableCell className="text-right">{s.docCount.toLocaleString()}</TableCell>
                        <TableCell className="text-muted-foreground">{s.lastEvent}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pager {...storagePager} onChange={storagePager.setPage} />
              </>
            )}
          </Panel>

          <Panel title="Recent conversations">
            {data.chatLogsHidden ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
                <EyeOff className="h-8 w-8 text-ink-300" />
                Chat logs are hidden for your account. Ask an administrator for access.
              </div>
            ) : data.recentMessages.length === 0 ? (
              <EmptyState message="No recent messages." />
            ) : (
              <>
                <div className="space-y-3">
                  {recentPager.view.map((m, i) => (
                    <div key={i} className="rounded-lg border bg-ink-50 px-4 py-3 transition-colors duration-150 hover:border-ink-300">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{m.timestamp}</span>
                        <RegionBadge region={m.region} />
                        {m.status && <StatusBadge status={m.status} />}
                        {m.agentId && (
                          <Badge variant="secondary" className="gap-1 bg-quick-100 font-medium text-quick-800 hover:bg-quick-100">
                            <Bot className="h-3 w-3" /> agent
                          </Badge>
                        )}
                        {m.flowId && (
                          <Badge variant="secondary" className="gap-1 bg-quick-100 font-medium text-quick-800 hover:bg-quick-100">
                            <Workflow className="h-3 w-3" /> flow
                          </Badge>
                        )}
                        {m.surface && <span>{m.surface}</span>}
                      </div>
                      {m.message ? (
                        <Markdown className="font-medium text-ink-900">{m.message}</Markdown>
                      ) : (
                        <p className="text-sm font-medium text-ink-900">(no message text)</p>
                      )}
                      {m.reply && (
                        <details className="mt-2 group">
                          <summary className="cursor-pointer text-xs font-medium text-quick-700 hover:text-quick-800">
                            Agent reply
                          </summary>
                          <div className="mt-2 rounded-md border bg-white px-3 py-2 text-ink-700 animate-fade-in">
                            <Markdown>{m.reply}</Markdown>
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
                <Pager {...recentPager} onChange={recentPager.setPage} />
              </>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}

export default function UserPage() {
  return (
    <Shell>
      <Suspense fallback={<UserSkeleton />}>
        <UserDetailInner />
      </Suspense>
    </Shell>
  );
}
