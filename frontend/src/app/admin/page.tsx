'use client';

/**
 * Admin panel: invite dashboard users and manage existing ones
 * (resend invite, reset password, delete, jump to permissions).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Send, RotateCw, KeyRound, Trash2, SlidersHorizontal, ShieldCheck, Loader2, UserPlus,
} from 'lucide-react';
import Shell from '@/components/Shell';
import PermissionsDialog from '@/components/PermissionsDialog';
import {
  PageHeader, Panel, ErrorBox, SuccessBox, EmptyState, usePager, Pager, TableRowsSkeleton,
} from '@/components/shared';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AdminUser, Permissions, adminListUsers, adminInviteUser, adminResendInvite,
  adminResetPassword, adminDeleteUser,
} from '@/lib/api';
import { isAdmin, getClaims } from '@/lib/auth';

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  CONFIRMED: { label: 'Active', className: 'bg-emerald-100 text-emerald-700' },
  FORCE_CHANGE_PASSWORD: { label: 'Invite pending', className: 'bg-amber-100 text-amber-700' },
  RESET_REQUIRED: { label: 'Reset required', className: 'bg-amber-100 text-amber-700' },
};

function UserStatusBadge({ status, enabled }: { status: string; enabled: boolean }) {
  if (!enabled) {
    return <Badge variant="secondary" className="bg-red-100 font-medium text-red-700 hover:bg-red-100">Disabled</Badge>;
  }
  const s = STATUS_LABELS[status] ?? { label: status, className: 'bg-ink-100 text-ink-500' };
  return <Badge variant="secondary" className={`font-medium hover:bg-inherit ${s.className}`}>{s.label}</Badge>;
}

/** Confirmation dialog for destructive / impactful actions. */
function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PendingAction =
  | { kind: 'delete'; user: AdminUser }
  | { kind: 'reset'; user: AdminUser }
  | null;

function AdminPageInner() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const [permUser, setPermUser] = useState<AdminUser | null>(null);
  const me = getClaims()?.username ?? '';

  const load = useCallback(async () => {
    setError('');
    try {
      setUsers(await adminListUsers());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pager = usePager(users ?? []);

  async function run(key: string, action: () => Promise<unknown>, successMessage: string) {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(successMessage);
      setPending(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    await run('invite', () => adminInviteUser(email),
      `Invitation sent to ${email}. They will receive a temporary password by email.`);
    setInviteEmail('');
  }

  return (
    <>
      <PageHeader
        title="User management"
        subtitle="Invite dashboard users, resend invitations, reset passwords, and remove access."
      />

      {notice && <div className="mb-4"><SuccessBox message={notice} /></div>}
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}

      <div className="space-y-5">
        <Panel title="Invite a user">
          <form onSubmit={handleInvite} className="flex items-end gap-3">
            <div className="w-full max-w-md space-y-1.5">
              <Label htmlFor="invite-email" className="text-xs font-semibold text-ink-700">
                Email address
              </Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="analyst@example.com"
              />
            </div>
            <Button type="submit" disabled={busy === 'invite'}>
              {busy === 'invite'
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Send className="mr-2 h-4 w-4" />}
              Send invite
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            The user receives an email with a temporary password and is asked to choose a new one on
            first sign-in. New users can see every section until you turn items off in Permissions.
          </p>
        </Panel>

        <Panel title="Dashboard users">
          {!users && !error && (
            <Table>
              <TableBody>
                <TableRowsSkeleton rows={4} cols={6} />
              </TableBody>
            </Table>
          )}
          {users && users.length === 0 && <EmptyState message="No users yet." />}
          {users && users.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pager.view.map((u) => (
                    <TableRow key={u.username}>
                      <TableCell className="font-medium">
                        {u.username}
                        {u.username === me && (
                          <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                        )}
                      </TableCell>
                      <TableCell>{u.email || '—'}</TableCell>
                      <TableCell><UserStatusBadge status={u.status} enabled={u.enabled} /></TableCell>
                      <TableCell>
                        {u.isAdmin ? (
                          <Badge variant="secondary" className="gap-1 bg-quick-100 font-medium text-quick-800 hover:bg-quick-100">
                            <ShieldCheck className="h-3 w-3" /> Admin
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">Member</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.created ? u.created.slice(0, 10) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {u.status === 'FORCE_CHANGE_PASSWORD' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={busy !== ''}
                              onClick={() =>
                                void run(`resend:${u.username}`, () => adminResendInvite(u.username),
                                  `Invitation re-sent to ${u.email || u.username}.`)
                              }
                            >
                              {busy === `resend:${u.username}`
                                ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                : <RotateCw className="mr-1.5 h-3 w-3" />}
                              Resend invite
                            </Button>
                          )}
                          {u.status === 'CONFIRMED' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={busy !== ''}
                              onClick={() => setPending({ kind: 'reset', user: u })}
                            >
                              <KeyRound className="mr-1.5 h-3 w-3" />
                              Reset password
                            </Button>
                          )}
                          {!u.isAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setPermUser(u)}
                            >
                              <SlidersHorizontal className="mr-1.5 h-3 w-3" />
                              Permissions
                            </Button>
                          )}
                          {!u.isAdmin && u.username !== me && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 border-red-200 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                              disabled={busy !== ''}
                              onClick={() => setPending({ kind: 'delete', user: u })}
                            >
                              <Trash2 className="mr-1.5 h-3 w-3" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pager {...pager} onChange={pager.setPage} />
            </>
          )}
        </Panel>
      </div>

      <PermissionsDialog
        user={permUser}
        onClose={() => setPermUser(null)}
        onSaved={(username: string, permissions: Permissions) =>
          setUsers((prev) =>
            prev?.map((u) => (u.username === username ? { ...u, permissions } : u)) ?? null,
          )
        }
      />
      <ConfirmDialog
        open={pending?.kind === 'delete'}
        title={`Delete ${pending?.user.username}?`}
        description={`${pending?.user.email || pending?.user.username} will immediately lose access to the dashboard. This cannot be undone.`}
        confirmLabel="Delete user"
        destructive
        busy={busy.startsWith('delete:')}
        onConfirm={() => {
          const u = pending!.user;
          void run(`delete:${u.username}`, () => adminDeleteUser(u.username), `Deleted ${u.username}.`);
        }}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === 'reset'}
        title={`Reset password for ${pending?.user.username}?`}
        description="Their current password stops working immediately. They will receive a verification code by email and set a new password at the next sign-in."
        confirmLabel="Reset password"
        busy={busy.startsWith('reset:')}
        onConfirm={() => {
          const u = pending!.user;
          void run(`reset:${u.username}`, () => adminResetPassword(u.username),
            `Password reset initiated for ${u.username}. They will receive a code by email.`);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    setAllowed(isAdmin());
  }, []);
  return (
    <Shell>
      {allowed === null && (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <UserPlus className="h-4 w-4" /> Loading…
        </div>
      )}
      {allowed === false && <ErrorBox message="Admin access required." />}
      {allowed === true && <AdminPageInner />}
    </Shell>
  );
}
