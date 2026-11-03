'use client';

/** Region pipeline health, as reported by the deploy-time provisioner. */
import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { PageHeader, Panel, ErrorBox, StatusBadge, TableRowsSkeleton } from '@/components/shared';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { fetchStatus, RegionStatus } from '@/lib/api';

export default function RegionsPage() {
  const [data, setData] = useState<RegionStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStatus().then(setData).catch((err) => setError((err as Error).message));
  }, []);

  return (
    <Shell>
      <PageHeader
        title="Region pipelines"
        subtitle={data ? `Last provisioned ${new Date(data.updatedAt).toLocaleString()}` : 'Vended log delivery status per region'}
      />

      {error && <ErrorBox message={error} />}

      {!data && !error && (
        <Panel>
          <Table>
            <TableBody>
              <TableRowsSkeleton rows={7} cols={4} />
            </TableBody>
          </Table>
        </Panel>
      )}

      {data && (
        <Panel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Region</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Log types collected</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.regions.map((r) => (
                <TableRow key={r.region}>
                  <TableCell className="font-medium">{r.region}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.logTypes.map((t) => (
                        <Badge key={t} variant="secondary" className="font-medium text-ink-700">{t}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.detail ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </Shell>
  );
}
