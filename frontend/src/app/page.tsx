'use client';

/** Overview dashboard: all users, all regions, at a glance. */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { ArrowRight, Users as UsersIcon, MessageSquare, Timer, ThumbsUp } from 'lucide-react';
import Shell from '@/components/Shell';
import DateRangePicker from '@/components/DateRangePicker';
import { DayRange, lastNDays, toTimeRange } from '@/lib/timerange';
import {
  PageHeader, KpiCard, Panel, ErrorBox, EmptyState, RegionBadge,
  usePager, Pager, KpiSkeleton, ChartSkeleton, TableRowsSkeleton,
} from '@/components/shared';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { fetchOverview, Overview } from '@/lib/api';

// Quick brand gradient palette: violet -> magenta -> plum -> orange
const PURPLES = ['#6842FF', '#D600BA', '#9F86F7', '#78008A', '#FF4B14', '#C4B5FB'];

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiSkeleton count={4} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Chat activity over time" className="xl:col-span-2">
          <ChartSkeleton height={260} />
        </Panel>
        <Panel title="Agent hours by service">
          <ChartSkeleton height={260} />
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Usage by region">
          <ChartSkeleton height={240} />
        </Panel>
        <Panel title="Top users" className="xl:col-span-2">
          <Table>
            <TableBody>
              <TableRowsSkeleton rows={5} cols={4} />
            </TableBody>
          </Table>
        </Panel>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [range, setRange] = useState<DayRange>(() => lastNDays(7));
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (r: DayRange) => {
    setData(null);
    setError('');
    try {
      setData(await fetchOverview(toTimeRange(r)));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  const connectorsPager = usePager(data?.connectors ?? []);

  const positive = data ? Object.entries(data.kpis.feedback)
    .filter(([k]) => /useful|positive|up/i.test(k) && !/not/i.test(k))
    .reduce((s, [, v]) => s + v, 0) : 0;
  const totalFeedback = data ? Object.values(data.kpis.feedback).reduce((s, v) => s + v, 0) : 0;

  return (
    <Shell>
      <PageHeader
        title="Usage overview"
        subtitle={
          data
            ? `Aggregated across ${data.queriedRegions.length} monitored region${data.queriedRegions.length === 1 ? '' : 's'}`
            : 'Amazon Quick activity across all regions'
        }
        right={<DateRangePicker value={range} onChange={setRange} />}
      />

      {error && <ErrorBox message={error} />}
      {!data && !error && <DashboardSkeleton />}

      {data && (
        <div className="space-y-5 animate-fade-in-up">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KpiCard label="Active users" value={data.kpis.activeUsers} icon={<UsersIcon className="h-3.5 w-3.5" />} />
            <KpiCard label="Chat messages" value={data.kpis.totalMessages.toLocaleString()} icon={<MessageSquare className="h-3.5 w-3.5" />} />
            <KpiCard label="Agent hours" value={data.kpis.totalAgentHours} hint="Flows + Research" icon={<Timer className="h-3.5 w-3.5" />} />
            <KpiCard
              label="Positive feedback"
              value={totalFeedback > 0 ? `${Math.round((positive / totalFeedback) * 100)}%` : '—'}
              hint={totalFeedback > 0 ? `${totalFeedback} ratings` : 'No ratings yet'}
              icon={<ThumbsUp className="h-3.5 w-3.5" />}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Panel title="Chat activity over time" className="xl:col-span-2">
              {data.series.length === 0 ? (
                <EmptyState message="No chat activity in this period." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={data.series}>
                    <defs>
                      <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6842FF" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#6842FF" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E9E9EC" />
                    <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#69707D' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#69707D' }} width={36} />
                    <Tooltip />
                    <Area type="monotone" dataKey="messages" stroke="#6842FF" strokeWidth={2} fill="url(#grad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Panel>

            <Panel title="Agent hours by service">
              {data.hoursByService.length === 0 ? (
                <EmptyState message="No agent hours recorded." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={data.hoursByService}
                      dataKey="hours"
                      nameKey="service"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                    >
                      {data.hoursByService.map((_, i) => (
                        <Cell key={i} fill={PURPLES[i % PURPLES.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Panel title="Usage by region">
              {data.byRegion.length === 0 ? (
                <EmptyState message="No regional activity yet." />
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

            <Panel title="Top users" className="xl:col-span-2">
              {data.topUsers.length === 0 ? (
                <EmptyState message="No user activity in this period." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead className="text-right">Messages</TableHead>
                      <TableHead className="text-right">Agent hours</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topUsers.map((u) => (
                      <TableRow key={u.userArn}>
                        <TableCell>
                          <Link
                            href={`/user/?arn=${encodeURIComponent(u.userArn)}`}
                            className="font-medium text-quick-600 hover:text-quick-800 hover:underline"
                          >
                            {u.userName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right">{u.messages.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{u.agentHours}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/user/?arn=${encodeURIComponent(u.userArn)}`}
                            className="inline-flex items-center gap-1 text-sm font-medium text-quick-600 hover:text-quick-800"
                          >
                            View <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          </div>

          <Panel title="Connector usage">
            {data.connectors.length === 0 ? (
              <EmptyState message="No connectors listed in this period." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Connector</TableHead>
                    <TableHead className="text-right">Conversations</TableHead>
                    <TableHead className="text-right">Users</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connectorsPager.view.map((c) => (
                    <TableRow key={c.connector}>
                      <TableCell className="font-medium">{c.connector}</TableCell>
                      <TableCell className="text-right">{c.uses}</TableCell>
                      <TableCell className="text-right">{c.users}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Pager {...connectorsPager} onChange={connectorsPager.setPage} />
          </Panel>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Monitoring: {data.queriedRegions.map((r) => <RegionBadge key={r} region={r} />)}
          </div>
        </div>
      )}
    </Shell>
  );
}
