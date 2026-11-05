"use client";

/**
 * App shell styled after the Amazon Quick console: a slim top bar with the
 * brand cube and account menu, plus a light sidebar with lavender selection.
 * Redirects to /login when there is no valid session.
 *
 * Navigation is permission-aware: sections an admin turned off for this user
 * are hidden (the API also refuses them server-side), and members of the
 * "admins" Cognito group get an extra Admin section.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Users,
  Database,
  FolderSync,
  Globe,
  UserPlus,
  CircleUser,
  LogOut,
  ChevronDown,
  Settings,
  FileBarChart2,
} from "lucide-react";
import { logoutSso } from "@/lib/sso";
import { getToken, signOut, isAdmin, getClaims } from "@/lib/auth";
import {
  fetchMyPermissions,
  Permissions,
  PermissionKey,
  FULL_ACCESS,
} from "@/lib/api";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import QuickLogo from "./QuickLogo";

interface NavItem {
  href: string;
  label: string;
  perm?: PermissionKey;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", perm: "dashboard", icon: LayoutGrid },
  { href: "/directory/", label: "Users & groups", perm: "users", icon: Users },
  { href: "/agents/", label: "Agents", perm: "dashboard", icon: LayoutGrid },
  {
    href: "/connectors/",
    label: "Connectors",
    perm: "dashboard",
    icon: Database,
  },
  {
    href: "/invocations/",
    label: "Connector activity",
    perm: "dashboard",
    icon: Globe,
  },
  {
    href: "/relationships/",
    label: "Agent connections",
    perm: "dashboard",
    icon: FolderSync,
  },
  {
    href: "/audit/",
    label: "Audit timeline",
    perm: "dashboard",
    icon: FileBarChart2,
  },
  { href: "/users/", label: "User usage", perm: "users", icon: Users },
  { href: "/storage/", label: "Storage", perm: "storage", icon: Database },
  { href: "/regions/", label: "Regions", perm: "regions", icon: Globe },
  { href: "/reports/", label: "Reports", perm: "reports", icon: FileBarChart2 },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/", label: "User management", icon: UserPlus },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-[7px] text-[13px] transition-colors duration-150",
        active
          ? "bg-quick-100 font-medium text-ink-900"
          : "text-ink-700 hover:bg-ink-100",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-quick-600" : "text-ink-500",
        )}
      />
      {item.label}
    </Link>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-2 px-3 pt-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [username, setUsername] = useState("");
  const [perms, setPerms] = useState<Permissions>(FULL_ACCESS);

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login/";
      return;
    }
    setAdmin(isAdmin());
    setUsername(getClaims()?.username ?? "");
    // Fail open in the nav if the lookup fails - the API enforces regardless
    fetchMyPermissions()
      .then(setPerms)
      .catch(() => setPerms(FULL_ACCESS))
      .finally(() => setReady(true));
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    const base = href.replace(/\/$/, "");
    // /admin/ must not stay highlighted on /admin/permissions/
    if (base === "/admin")
      return pathname === "/admin" || pathname === "/admin/";
    return pathname.startsWith(base);
  };

  const visibleNav = NAV.filter(
    (item) => !item.perm || admin || perms[item.perm],
  );

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-20 flex h-12 items-center justify-between border-b bg-white px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <QuickLogo className="h-6 w-6 shrink-0" />
          <span className="text-sm font-semibold text-ink-900">
            Quick Usage Monitor
          </span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-ink-700 transition-colors hover:bg-ink-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <CircleUser className="h-4 w-4 text-ink-500" />
            {username || "Account"}
            <ChevronDown className="h-3.5 w-3.5 text-ink-500" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Signed in as{" "}
              <span className="font-medium text-foreground">
                {username || "user"}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account/" className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Account settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-red-600 focus:text-red-600"
              onClick={() => {
                void logoutSso();
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Sidebar */}
      <aside className="fixed bottom-0 left-0 top-12 z-10 flex w-56 flex-col overflow-y-auto border-r bg-white">
        {ready ? (
          <>
            <nav className="space-y-0.5 px-3 pt-3">
              {visibleNav.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                />
              ))}
            </nav>
            {admin && (
              <>
                <Separator className="mx-3 my-3 w-auto" />
                <div className="px-6 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Admin
                </div>
                <nav className="space-y-0.5 px-3">
                  {ADMIN_NAV.map((item) => (
                    <NavLink
                      key={item.href}
                      item={item}
                      active={isActive(item.href)}
                    />
                  ))}
                </nav>
              </>
            )}
          </>
        ) : (
          <SidebarSkeleton />
        )}
        <div className="mt-auto border-t p-3">
          <NavLink
            item={{ href: "/account/", label: "Account", icon: Settings }}
            active={isActive("/account/")}
          />
        </div>
      </aside>

      {/* Content */}
      <main className="ml-56 px-8 pb-10 pt-[68px]">
        <div className="mx-auto max-w-[1400px] animate-fade-in-up">
          {children}
        </div>
      </main>
    </div>
  );
}
