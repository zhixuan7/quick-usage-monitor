'use client';

/** All users list with search and usage summaries. */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, ArrowRight } from 'lucide-react';
import Shell from '@/components/Shell';
import DateRangePicker from '@/components/DateRangePicker';
import { DayRange, lastNDays, toTimeRange } from '@/lib/timerange';
import {
  PageHeader, Panel, ErrorBox, EmptyState, RegionBadge,
  usePager, Pager, TableRowsSkeleton,
} from '@/components/shared';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchUsers, UserSummary } from '@/lib/api';

export default function UsersPage() {
  const [range, setRange] = useState<DayRange>(() => lastNDays(7));
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async (r: DayRange) => {
    setUsers(null);
    setError('');
    try {
      setUsers(await fetchUsers(toTimeRange(r)));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  const filtered = (users ?? []).filter(
    (u) =>
      u.userName.toLowerCase().includes(search.toLowerCase()) ||
      u.userArn.toLowerCase().includes(search.toLowerCase()),
  );
  const pager = usePager(filtered);

  return (
    <Shell>
      <PageHeader
        title="Users"
        subtitle="Every user with Quick activity in the selected period"
        right={<DateRangePicker value={range} onChange={setRange} />}
      />

      {error && <ErrorBox message={error} />}

      {!users && !error && (
        <Panel>
          <Skeleton className="mb-4 h-9 w-72 rounded-full" />
          <Table>
            <TableBody>
              <TableRowsSkeleton rows={8} cols={6} />
            </TableBody>
          </Table>
        </Panel>
      )}

      {users && (
        <Panel>
          <div className="relative mb-4 w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search users"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-full pl-9"
            />
          </div>
          {filtered.length === 0 ? (
            <EmptyState message="No users with activity found." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">Conversations</TableHead>
                  <TableHead className="text-right">Agents</TableHead>
                  <TableHead className="text-right">Flows</TableHead>
                  <TableHead className="text-right">Agent hours</TableHead>
                  <TableHead className="text-right">Feedback +/-</TableHead>
                  <TableHead>Regions</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.view.map((u) => (
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
                    <TableCell className="text-right">{u.conversations}</TableCell>
                    <TableCell className="text-right">{u.agents}</TableCell>
                    <TableCell className="text-right">{u.flows}</TableCell>
                    <TableCell className="text-right">{u.agentHours}</TableCell>
                    <TableCell className="text-right">
                      <span className="text-emerald-600">{u.feedbackPositive}</span>
                      {' / '}
                      <span className="text-red-500">{u.feedbackNegative}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.regions.map((r) => <RegionBadge key={r} region={r} />)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/user/?arn=${encodeURIComponent(u.userArn)}`}
                        className="inline-flex items-center gap-1 font-medium text-quick-600 hover:text-quick-800"
                      >
                        Drill down <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager {...pager} onChange={pager.setPage} />
        </Panel>
      )}
    </Shell>
  );
}
