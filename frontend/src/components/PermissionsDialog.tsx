'use client';

/**
 * Per-user permission editor in a modal, opened from the admin users table.
 * Toggles save immediately (optimistic, reverted on failure); the API
 * enforces the same rules server-side.
 */
import { useEffect, useState } from 'react';
import {
  LayoutGrid, Users, MessageSquare, Database, FolderSync, Globe, FileBarChart2,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  AdminUser, PermissionKey, Permissions, PERMISSION_KEYS, PERMISSION_LABELS,
  adminSetPermissions,
} from '@/lib/api';

const PERMISSION_ICONS: Record<PermissionKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutGrid,
  users: Users,
  chatLogs: MessageSquare,
  storage: Database,
  kbSync: FolderSync,
  regions: Globe,
  reports: FileBarChart2,
};

export default function PermissionsDialog({
  user,
  onClose,
  onSaved,
}: {
  /** user being edited, or null when the dialog is closed */
  user: AdminUser | null;
  onClose: () => void;
  /** notify the parent list so it stays in sync without a refetch */
  onSaved: (username: string, permissions: Permissions) => void;
}) {
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  // Reset local state whenever a different user is opened
  useEffect(() => {
    setPerms(user ? { ...user.permissions } : null);
    setError('');
  }, [user]);

  async function toggle(key: PermissionKey, value: boolean) {
    if (!user || !perms) return;
    const previous = perms;
    const next: Permissions = { ...perms, [key]: value };
    setPerms(next);
    setSaving(key);
    setError('');
    try {
      await adminSetPermissions(user.username, next);
      onSaved(user.username, next);
    } catch (err) {
      setError((err as Error).message);
      setPerms(previous);
    } finally {
      setSaving('');
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Permissions — {user?.username}</DialogTitle>
          <DialogDescription>
            Choose which sections {user?.username} can see. Changes save immediately; turned-off
            sections disappear from their navigation and the API refuses to serve them.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-600 animate-fade-in">{error}</p>}

        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {perms &&
            PERMISSION_KEYS.map((key) => {
              const meta = PERMISSION_LABELS[key];
              const Icon = PERMISSION_ICONS[key];
              return (
                <div
                  key={key}
                  className="flex items-start justify-between gap-3 rounded-lg border bg-ink-50 px-4 py-3 transition-colors duration-150 hover:border-ink-300"
                >
                  <div className="flex items-start gap-2.5">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-quick-600" />
                    <div>
                      <div className="text-sm font-medium text-ink-900">{meta.label}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{meta.description}</div>
                    </div>
                  </div>
                  <Switch
                    checked={perms[key]}
                    disabled={saving === key}
                    onCheckedChange={(v) => void toggle(key, v)}
                    aria-label={`${meta.label} for ${user?.username}`}
                  />
                </div>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
