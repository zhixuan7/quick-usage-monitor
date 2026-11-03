'use client';

/**
 * Shared page primitives styled after the Amazon Quick console, built on
 * shadcn/ui. Every loading state has a skeleton counterpart so pages never
 * show a bare spinner.
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle, Inbox } from 'lucide-react';
import { Card as UICard, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TableRow, TableCell } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;

/** Client-side pagination: slices items into pages of 10. */
export function usePager<T>(items: T[]) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [items.length]);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  return {
    view: items.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE),
    page: current,
    pages,
    total: items.length,
    setPage,
  };
}

/** Quick-style pagination footer: "Items per page" + chevrons + page pill. */
export function Pager({
  page,
  pages,
  total,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  onChange: (p: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
      <span>{total} items</span>
      <div className="flex items-center gap-1.5">
        <span className="mr-2">
          Items per page <span className="rounded-md border bg-white px-2 py-1 font-medium text-foreground">{PAGE_SIZE}</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="flex h-7 min-w-7 items-center justify-center rounded-md border border-quick-300 bg-quick-50 px-2 font-medium text-quick-800">
          {page + 1}
        </span>
        <span className="text-muted-foreground">/ {pages}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={page >= pages - 1}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-medium tracking-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <UICard className="shadow-card transition-shadow duration-200 hover:shadow-md">
      <CardContent className="px-5 py-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="mt-1.5 text-3xl font-bold tracking-tight">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </UICard>
  );
}

/** Titled content card (keeps the old `Card` API used across pages). */
export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <UICard className={cn('shadow-card', className)}>
      {title && (
        <CardHeader className="flex-row items-center justify-between space-y-0 px-5 pb-0 pt-4">
          <CardTitle className="text-sm font-semibold text-ink-700">{title}</CardTitle>
          {action}
        </CardHeader>
      )}
      <CardContent className="px-5 py-4">{children}</CardContent>
    </UICard>
  );
}

export function RegionBadge({ region }: { region: string }) {
  return (
    <Badge variant="secondary" className="bg-quick-100 font-medium text-quick-800 hover:bg-quick-100">
      {region}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700',
    unsupported: 'bg-ink-100 text-ink-500',
    error: 'bg-red-100 text-red-700',
    success: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <Badge
      variant="secondary"
      className={cn('font-medium hover:bg-inherit', styles[status?.toLowerCase()] ?? 'bg-ink-100 text-ink-500')}
    >
      {status}
    </Badge>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 animate-fade-in">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

export function SuccessBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 animate-fade-in">
      {message}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground animate-fade-in">
      <Inbox className="h-8 w-8 text-ink-300" />
      {message}
    </div>
  );
}

// ------------------------------------------------------------- skeletons

/** Row of KPI card skeletons. */
export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <UICard key={i} className="shadow-card">
          <CardContent className="px-5 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-20" />
          </CardContent>
        </UICard>
      ))}
    </>
  );
}

/** Chart placeholder with axis + bars hinting the final layout. */
export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="flex items-end gap-2 pt-4" style={{ height }}>
      {[35, 55, 40, 70, 50, 80, 62, 45, 72, 58, 66, 48].map((h, i) => (
        <Skeleton key={i} className="w-full rounded-t-md" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

/** Table body skeleton rows (use inside <TableBody>). */
export function TableRowsSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r} className="hover:bg-transparent">
          {Array.from({ length: cols }).map((_, c) => (
            <TableCell key={c}>
              <Skeleton className={cn('h-4', c === 0 ? 'w-40' : 'w-16')} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/** Full-panel skeleton: title bar + content lines. */
export function PanelSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <UICard className="shadow-card">
      <CardContent className="space-y-3 px-5 py-4">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" style={{ width: `${100 - i * 12}%` }} />
        ))}
      </CardContent>
    </UICard>
  );
}
