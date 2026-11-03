'use client';

/**
 * Reports: build an aggregated account summary or an individual user report
 * for a chosen period, preview it inline, and export it as CSV, JSON,
 * Markdown, HTML, or print-to-PDF.
 */
import { useEffect, useState } from 'react';
import {
  FileBarChart2, User as UserIcon, Loader2, Download, FileSpreadsheet, FileJson,
  FileText, FileCode2, Printer, Sparkles,
} from 'lucide-react';
import Shell from '@/components/Shell';
import DateRangePicker from '@/components/DateRangePicker';
import { DayRange, lastNDays, toTimeRange } from '@/lib/timerange';
import {
  PageHeader, Panel, ErrorBox, EmptyState, KpiSkeleton, PanelSkeleton,
} from '@/components/shared';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card as UICard, CardContent } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { fetchUsers, fetchMyPermissions, UserSummary } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { buildAggregatedReport, buildUserReport, downloadFile, printHtml } from '@/lib/report';
import { ReportDoc, toCsv, toJson, toMarkdown, toHtml } from '@/lib/report-format';

type ReportType = 'summary' | 'user';

const PREVIEW_ROWS = 10;

function ReportSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiSkeleton count={4} />
      </div>
      <PanelSkeleton lines={5} />
      <PanelSkeleton lines={5} />
    </div>
  );
}

function ReportPreview({ doc }: { doc: ReportDoc }) {
  return (
    <div className="space-y-5 animate-fade-in-up">
      <UICard className="border-l-4 border-l-quick-600 shadow-card">
        <CardContent className="px-5 py-4">
          <h2 className="text-lg font-semibold text-ink-900">{doc.title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{doc.subtitle}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-semibold text-ink-700">Period:</span> {doc.periodLabel}
            <span className="mx-2">·</span>
            <span className="font-semibold text-ink-700">Generated:</span> {doc.generatedAt}
          </p>
        </CardContent>
      </UICard>

      {doc.sections.map((s) => (
        <Panel key={s.title} title={s.title}>
          {s.note && <p className="mb-3 text-sm italic text-muted-foreground">{s.note}</p>}
          {s.kpis && s.kpis.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-3">
              {s.kpis.map((k) => (
                <div key={k.label} className="min-w-[130px] rounded-lg border px-4 py-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {k.label}
                  </div>
                  <div className="mt-0.5 text-lg font-bold">{k.value}</div>
                </div>
              ))}
            </div>
          )}
          {s.table && s.table.rows.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    {s.table.columns.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.table.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                    <TableRow key={i}>
                      {row.map((cell, j) => (
                        <TableCell
                          key={j}
                          className={cn('align-top', j === 0 && 'font-medium')}
                        >
                          <span className="line-clamp-2 [overflow-wrap:anywhere]">{cell}</span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {s.table.rows.length > PREVIEW_ROWS && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing {PREVIEW_ROWS} of {s.table.rows.length} rows — the export includes everything.
                </p>
              )}
            </>
          )}
          {s.table && s.table.rows.length === 0 && !s.note && (
            <p className="text-sm text-muted-foreground">No data in this period.</p>
          )}
        </Panel>
      ))}
    </div>
  );
}

function ReportsInner() {
  const [type, setType] = useState<ReportType>('summary');
  const [range, setRange] = useState<DayRange>(() => lastNDays(7));
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [usersError, setUsersError] = useState('');
  const [selectedArn, setSelectedArn] = useState('');
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Load the user list lazily, only when an individual report is requested
  useEffect(() => {
    if (type !== 'user' || users || usersError) return;
    fetchUsers(toTimeRange(range))
      .then(setUsers)
      .catch((err) => setUsersError((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  async function generate() {
    setGenerating(true);
    setError('');
    setDoc(null);
    try {
      const timeRange = toTimeRange(range);
      const report =
        type === 'summary'
          ? await buildAggregatedReport(timeRange)
          : await buildUserReport(selectedArn, timeRange);
      setDoc(report);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const base = type === 'summary'
    ? `quick-usage-summary-${stamp}`
    : `quick-usage-user-${(selectedArn.split('/').pop() ?? 'user')}-${stamp}`;

  const exports = doc && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => downloadFile(`${base}.csv`, toCsv(doc), 'text/csv')}>
          <FileSpreadsheet className="mr-2 h-4 w-4" /> CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadFile(`${base}.json`, toJson(doc), 'application/json')}>
          <FileJson className="mr-2 h-4 w-4" /> JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadFile(`${base}.md`, toMarkdown(doc), 'text/markdown')}>
          <FileText className="mr-2 h-4 w-4" /> Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadFile(`${base}.html`, toHtml(doc), 'text/html')}>
          <FileCode2 className="mr-2 h-4 w-4" /> HTML
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => printHtml(toHtml(doc))}>
          <Printer className="mr-2 h-4 w-4" /> Print / PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const typeBtn = (t: ReportType, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      onClick={() => setType(t)}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-200',
        type === t ? 'bg-quick-100 text-quick-800 shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Create a comprehensive usage report for a time period, preview it, and export it in multiple formats."
        right={exports ?? undefined}
      />

      <Panel title="Create a report" className="mb-5">
        <div className="flex flex-wrap items-end gap-5">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ink-700">Report type</Label>
            <div className="flex rounded-lg border bg-white p-0.5 shadow-card">
              {typeBtn('summary', 'Account summary', FileBarChart2)}
              {typeBtn('user', 'Individual user', UserIcon)}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ink-700">Time period</Label>
            <DateRangePicker value={range} onChange={setRange} />
          </div>

          {type === 'user' && (
            <div className="w-64 space-y-1.5">
              <Label className="text-xs font-semibold text-ink-700">User</Label>
              <Select value={selectedArn} onValueChange={setSelectedArn}>
                <SelectTrigger>
                  <SelectValue placeholder={users ? 'Select a user' : usersError ? 'Unavailable' : 'Loading users…'} />
                </SelectTrigger>
                <SelectContent>
                  {(users ?? []).map((u) => (
                    <SelectItem key={u.userArn} value={u.userArn}>
                      {u.userName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button onClick={generate} disabled={generating || (type === 'user' && !selectedArn)}>
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {generating ? 'Generating…' : 'Generate report'}
          </Button>
        </div>
        {type === 'user' && usersError && (
          <p className="mt-2 text-xs text-red-600">Could not load the user list: {usersError}</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          The account summary aggregates KPIs, top users, per-user detail, regions, connectors, storage,
          and knowledge sync for the period. Individual reports cover one user&apos;s full activity.
          Sections you don&apos;t have permission to view are skipped with a note.
        </p>
      </Panel>

      {error && <ErrorBox message={error} />}
      {generating && <ReportSkeleton />}
      {doc && !generating && <ReportPreview doc={doc} />}
      {!doc && !generating && !error && (
        <Panel>
          <EmptyState message="Configure a report above and select Generate report to preview and export it." />
        </Panel>
      )}
    </>
  );
}

export default function ReportsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (isAdmin()) {
      setAllowed(true);
      return;
    }
    fetchMyPermissions()
      .then((p) => setAllowed(p.reports))
      .catch(() => setAllowed(true)); // fail open in UI; API enforces per-section
  }, []);
  return (
    <Shell>
      {allowed === null && <ReportSkeleton />}
      {allowed === false && <ErrorBox message="You do not have access to reports. Ask an administrator." />}
      {allowed === true && <ReportsInner />}
    </Shell>
  );
}
