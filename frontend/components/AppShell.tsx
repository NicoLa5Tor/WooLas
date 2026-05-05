"use client";

import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { ProcessesPanel } from "@/components/ProcessesPanel";
import { Sidebar } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { ProcessesProvider } from "@/contexts/ProcessesContext";
import type { ApiResponse, AuthSession } from "@/lib/api";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(pathname !== "/login");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isLogin = pathname === "/login";

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (isLogin) {
      setSession(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch("/api/auth/me", {
      credentials: "include",
      cache: "no-store"
    })
      .then(async (response) => {
        const payload = (await response.json()) as ApiResponse<AuthSession>;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? "Authentication failed");
        }
        return payload.data;
      })
      .then((nextSession) => {
        if (cancelled) {
          return;
        }
        setSession(nextSession);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        void fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include"
        }).catch(() => null);
        setSession(null);
        setLoading(false);
        window.location.replace("/login");
      });

    return () => {
      cancelled = true;
    };
  }, [isLogin, pathname]);

  if (isLogin) {
    return <>{children}</>;
  }

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(184,115,51,0.16),_transparent_35%),linear-gradient(180deg,_rgba(255,247,237,1),_rgba(245,241,234,1))] px-4 dark:bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.12),_transparent_35%),linear-gradient(180deg,_rgba(15,23,42,1),_rgba(17,24,39,1))]">
        <div className="rounded-2xl border border-border bg-card/90 px-6 py-5 text-sm text-muted-foreground shadow-xl backdrop-blur">
          Verificando sesión...
        </div>
      </div>
    );
  }

  return (
    <ProcessesProvider>
      <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(197,168,128,0.18),_transparent_30%),linear-gradient(180deg,_rgba(255,250,245,1),_rgba(246,242,236,1))] text-foreground dark:bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.12),_transparent_30%),linear-gradient(180deg,_rgba(15,23,42,1),_rgba(17,24,39,1))]">
        <div className="flex min-h-screen max-w-full overflow-x-hidden">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} session={session} />
          <div className="flex min-h-screen min-w-0 max-w-full flex-1 flex-col overflow-x-hidden lg:pl-80">
            <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur lg:hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.35em] text-muted-foreground">WooLas</div>
                  <div className="truncate text-sm font-semibold">{session.tenants[0]?.name ?? session.user.username}</div>
                </div>
                <Button className="h-10 w-10 p-0" onClick={() => setSidebarOpen(true)} size="icon" variant="outline">
                  <Menu className="h-5 w-5" />
                </Button>
              </div>
            </header>
            <main className="flex-1 overflow-x-hidden overflow-y-auto">
              <div className="min-h-screen max-w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
                <div className="mx-auto min-w-0 max-w-7xl">{children}</div>
              </div>
            </main>
          </div>
        </div>
        <ProcessesPanel />
      </div>
    </ProcessesProvider>
  );
}
