'use client';

/** Knowledge base sync health: document status rollup + failure detail. */
import { useCallback, useEffect, useState } from 'react';
import { FileText, FilePlus, FilePen, FileWarning, Wrench } from 'lucide-react';
import Shell from '@/components/Shell';
import DateRangePicker from '@/components/DateRangePicker';
import { DayRange, lastNDays, toTimeRange } from '@/lib/timerange';
import {
  PageHeader, KpiCard, Panel, ErrorBox, EmptyState,
  RegionBadge, StatusBadge, usePager, Pager, KpiSkeleton, PanelSkeleton,
} from '@/components/shared';
import { Badge } from '@/components/ui/badge';
import { fetchKbSync, KbSyncData } from '@/lib/api';

const STATUS_ORDER = ['ADDED', 'MODIFIED', 'UNMODIFIED', 'DELETED', 'SKIPPED', 'FAILED'];

function KbSyncSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiSkeleton count={4} />
      </div>
      <PanelSkeleton lines={3} />
      <PanelSkeleton lines={5} />
    </div>
  );
}

export default function KbSyncPage() {
  const [range, setRange] = useState<DayRange>(() => lastNDays(7));
  const [data, setData] = useState<KbSyncData | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (r: DayRange) => {
    setData(null);
    setError('');
    try {
      setData(await fetchKbSync(toTimeRange(r)));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  const failuresPager = usePager(data?.failures ?? []);
  const totalDocs = data ? Object.values(data.statuses).reduce((s, v) => s + v, 0) : 0;
  const problems = data ? (data.statuses.FAILED ?? 0) + (data.statuses.SKIPPED ?? 0) : 0;

  return (
    <Shell>
      <PageHeader
        title="Knowledge sync"
        subtitle="Per-document sync results across all knowledge bases and regions"
        right={<DateRangePicker value={range} onChange={setRange} />}
      />

      {error && <ErrorBox message={error} />}
      {!data && !error && <KbSyncSkeleton />}

      {data && (
        <div className="space-y-5 animate-fade-in-up">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KpiCard label="Documents processed" value={totalDocs.toLocaleString()} icon={<FileText className="h-3.5 w-3.5" />} />
            <KpiCard label="Added" value={(data.statuses.ADDED ?? 0).toLocaleString()} icon={<FilePlus className="h-3.5 w-3.5" />} />
            <KpiCard label="Modified" value={(data.statuses.MODIFIED ?? 0).toLocaleString()} icon={<FilePen className="h-3.5 w-3.5" />} />
            <KpiCard
              label="Failed / skipped"
              value={problems.toLocaleString()}
              hint={problems > 0 ? 'See failures below' : 'All healthy'}
              icon={<FileWarning className="h-3.5 w-3.5" />}
            />
          </div>

          <Panel title="Status breakdown">
            {totalDocs === 0 ? (
              <EmptyState message="No knowledge base sync activity in this period." />
            ) : (
              <div className="flex flex-wrap gap-3">
                {STATUS_ORDER.filter((s) => data.statuses[s]).map((s) => (
                  <div
                    key={s}
                    className="rounded-lg border px-4 py-3 transition-shadow duration-200 hover:shadow-card"
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s}</div>
                    <div className="mt-1 text-xl font-bold">{data.statuses[s].toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Recent failures and skips">
            {data.failures.length === 0 ? (
              <EmptyState message="No failed or skipped documents. Nice." />
            ) : (
              <div className="space-y-3">
                {failuresPager.view.map((f, i) => (
                  <div key={i} className="rounded-lg border bg-ink-50 px-4 py-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{f.timestamp}</span>
                      <RegionBadge region={f.region} />
                      <StatusBadge status={f.status === 'FAILED' ? 'error' : 'unsupported'} />
                      {f.errorType && (
                        <Badge variant="secondary" className="bg-red-100 font-medium text-red-700 hover:bg-red-100">
                          {f.errorType}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium">{f.documentTitle || f.sourceUri}</p>
                    <p className="mt-1 text-sm text-ink-700">{f.errorMessage}</p>
                    {f.errorMitigation && (
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-quick-700">
                        <Wrench className="h-3.5 w-3.5" /> {f.errorMitigation}
                      </p>
                    )}
                  </div>
                ))}
                <Pager {...failuresPager} onChange={failuresPager.setPage} />
              </div>
            )}
          </Panel>
        </div>
      )}
    </Shell>
  );
}
