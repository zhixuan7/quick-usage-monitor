'use client';

/** Storage: index consumption per Space / knowledge base, across regions. */
import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { HardDrive, FolderOpen, BookOpen, Layers } from 'lucide-react';
import Shell from '@/components/Shell';
import DateRangePicker from '@/components/DateRangePicker';
import { DayRange, lastNDays, toTimeRange } from '@/lib/timerange';
import {
  PageHeader, KpiCard, Panel, ErrorBox, EmptyState, RegionBadge,
  usePager, Pager, formatBytes, KpiSkeleton, ChartSkeleton, TableRowsSkeleton,
} from '@/components/shared';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { fetchStorage, StorageData } from '@/lib/api';

function StorageSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiSkeleton count={4} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Index size by region">
          <ChartSkeleton height={220} />
        </Panel>
        <Panel title="Sources" className="xl:col-span-2">
          <Table>
            <TableBody>
              <TableRowsSkeleton rows={6} cols={5} />
            </TableBody>
          </Table>
        </Panel>
      </div>
    </div>
  );
}

export default function StoragePage() {
  // Index-usage events publish on change, so a wider default window shows state
  const [range, setRange] = useState<DayRange>(() => lastNDays(30));
  const [data, setData] = useState<StorageData | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (r: DayRange) => {
    setData(null);
    setError('');
    try {
      setData(await fetchStorage(toTimeRange(r)));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  const spaces = data?.sources.filter((s) => s.sourceType === 'SPACE') ?? [];
  const kbs = data?.sources.filter((s) => s.sourceType === 'KB') ?? [];
  const sourcesPager = usePager(data?.sources ?? []);

  return (
    <Shell>
      <PageHeader
        title="Storage"
        subtitle="Index consumption by Spaces and knowledge bases (latest state per source in the selected window)"
        right={<DateRangePicker value={range} onChange={setRange} />}
      />

      {error && <ErrorBox message={error} />}
      {!data && !error && <StorageSkeleton />}

      {data && (
        <div className="space-y-5 animate-fade-in-up">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KpiCard label="Total index size" value={formatBytes(data.totalIndexBytes)} icon={<HardDrive className="h-3.5 w-3.5" />} />
            <KpiCard label="Sources" value={data.sources.length} icon={<Layers className="h-3.5 w-3.5" />} />
            <KpiCard label="Spaces" value={spaces.length} icon={<FolderOpen className="h-3.5 w-3.5" />} />
            <KpiCard label="Knowledge bases" value={kbs.length} icon={<BookOpen className="h-3.5 w-3.5" />} />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Panel title="Index size by region">
              {data.byRegion.length === 0 ? (
                <EmptyState message="No index usage events in this period. Events publish only when a Space or KB changes - widen the range or sync a source." />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.byRegion} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E9E9EC" />
                    <XAxis type="number" tickFormatter={(v) => formatBytes(v)} tick={{ fontSize: 11, fill: '#69707D' }} />
                    <YAxis type="category" dataKey="region" width={110} tick={{ fontSize: 11, fill: '#69707D' }} />
                    <Tooltip formatter={(v) => formatBytes(Number(v))} />
                    <Bar dataKey="bytes" fill="#6842FF" radius={[0, 4, 4, 0]} name="Index size" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>

            <Panel title="Sources" className="xl:col-span-2">
              {data.sources.length === 0 ? (
                <EmptyState message="No Spaces or knowledge bases reported yet." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead className="text-right">Documents</TableHead>
                      <TableHead>Last change by</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sourcesPager.view.map((s) => (
                      <TableRow key={s.sourceArn || s.sourceName}>
                        <TableCell className="font-medium">{s.sourceName}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-medium text-ink-700">{s.sourceType}</Badge>
                        </TableCell>
                        <TableCell><RegionBadge region={s.region} /></TableCell>
                        <TableCell className="text-right">{formatBytes(s.sizeBytes)}</TableCell>
                        <TableCell className="text-right">{s.docCount.toLocaleString()}</TableCell>
                        <TableCell className="text-muted-foreground">{s.lastUpdatedBy || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Pager {...sourcesPager} onChange={sourcesPager.setPage} />
            </Panel>
          </div>
        </div>
      )}
    </Shell>
  );
}
