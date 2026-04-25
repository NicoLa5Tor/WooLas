"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DatabaseBackup, FileSpreadsheet, LogOut, MoonStar, PackageSearch, ShieldCheck, SunMedium, X } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { clearStoredTenantId, resolveActiveTenant, setStoredTenantId, type AuthSession } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const items: Array<{
  href: string;
  label: string;
  icon: typeof DatabaseBackup;
  roles: Array<"admin" | "client">;
}> = [
  { href: "/backup", label: "Backup", icon: DatabaseBackup, roles: ["admin", "client"] },
  { href: "/import", label: "Importar Excel", icon: FileSpreadsheet, roles: ["admin", "client"] },
  { href: "/products", label: "Productos", icon: PackageSearch, roles: ["admin", "client"] },
  { href: "/admin/users", label: "Clientes", icon: ShieldCheck, roles: ["admin"] }
];

export function Sidebar({
  session,
  isOpen,
  onClose
}: {
  session: AuthSession;
  isOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);

  useEffect(() => {
    const activeTenant = resolveActiveTenant(session);
    setActiveTenantId(activeTenant?.id ?? null);
    if (activeTenant) {
      setStoredTenantId(activeTenant.id);
    }
  }, [session]);

  const effectiveRole = session.user.role ?? "client";
  const visibleItems = items.filter((item) => item.roles.includes(effectiveRole));
  const activeTenant = session.tenants.find((tenant) => tenant.id === activeTenantId) ?? session.tenants[0] ?? null;

  const handleLogout = async () => {
    clearStoredTenantId();
    onClose();
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  return (
    <>
      <div
        aria-hidden={!isOpen}
        className={cn(
          "fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm transition-opacity lg:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[88vw] max-w-sm flex-col border-r border-border bg-card/96 shadow-2xl backdrop-blur transition-transform duration-200 lg:sticky lg:top-0 lg:z-20 lg:h-screen lg:w-80 lg:translate-x-0 lg:shadow-none",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="border-b border-border px-5 py-5 sm:px-6">
          <div className="mb-5 flex items-start justify-between lg:hidden">
            <div>
              <div className="text-[11px] uppercase tracking-[0.35em] text-muted-foreground">WooLas</div>
              <div className="mt-1 text-lg font-semibold">Panel principal</div>
            </div>
            <Button className="h-9 w-9 p-0" onClick={onClose} size="icon" variant="ghost">
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="hidden text-xs uppercase tracking-[0.35em] text-muted-foreground lg:block">WooLas</div>
          <div className="mt-1 text-xl font-semibold lg:mt-3">WooCommerce Manager</div>
          <div className="mt-3 rounded-2xl border border-border bg-background/75 px-4 py-3">
            <div className="text-sm font-medium">{session.user.username}</div>
            <div className="mt-1 text-xs uppercase tracking-[0.22em] text-muted-foreground">{effectiveRole}</div>
          </div>

          {session.tenants.length > 0 ? (
            <div className="mt-4 space-y-2">
              <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Cliente activo</div>
              <Select
                value={activeTenant?.id ?? ""}
                onValueChange={(value) => {
                  setActiveTenantId(value);
                  setStoredTenantId(value);
                  onClose();
                  window.location.reload();
                }}
              >
                <SelectTrigger className="h-12 rounded-xl bg-background/80">
                  <SelectValue placeholder="Selecciona cliente" />
                </SelectTrigger>
                <SelectContent>
                  {session.tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-border bg-background/70 px-3 py-3 text-xs text-muted-foreground">
              No tienes clientes asignados.
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-2 px-4 py-5 sm:px-5">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
                onClick={onClose}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border px-4 py-4 sm:px-5">
          <div className="mb-3 flex items-center justify-between rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{activeTenant?.name ?? session.user.username}</div>
              <div className="text-xs text-muted-foreground">Modo {resolvedTheme === "dark" ? "oscuro" : "claro"}</div>
            </div>
            <button
              type="button"
              className="rounded-xl p-2 hover:bg-accent"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {resolvedTheme === "dark" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
            </button>
          </div>
          <Button className="h-11 w-full justify-center gap-2 rounded-xl" variant="outline" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </Button>
        </div>
      </aside>
    </>
  );
}
