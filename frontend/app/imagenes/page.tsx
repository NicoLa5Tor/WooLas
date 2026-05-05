"use client";

import { DatabaseZap, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MediaLibraryBrowser } from "@/components/MediaLibraryBrowser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { useProcesses } from "@/contexts/ProcessesContext";
import { apiRequest, resolveActiveTenant, type AuthSession, withTenantPath } from "@/lib/api";

type SyncJob = {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  processed_pages: number;
  total_pages: number;
  total_items: number;
  from_cache: boolean;
  progress: number;
  error: string | null;
};

export default function ImagesPage() {
  const { showToast } = useToast();
  const { addProcess, finishProcess } = useProcesses();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncJob, setSyncJob] = useState<SyncJob | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [browserKey, setBrowserKey] = useState(0);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    setLoading(true);
    void apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" })
      .then((response) => setSession(response.data))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar la sesión"))
      .finally(() => setLoading(false));
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const activeTenant = session ? resolveActiveTenant(session) : null;

  const startSync = async () => {
    if (!activeTenant) return;
    setSyncing(true);
    setSyncJob(null);
    try {
      const response = await apiRequest<SyncJob>(withTenantPath(activeTenant.id, "/media/sync"), { method: "POST" });
      const job = response.data;
      setSyncJob(job);
      const procId = addProcess({
        type: "media_sync",
        label: "Sincronizar índice de imágenes",
        pollUrl: `/tenants/${activeTenant.id}/media/sync/${job.job_id}`,
      });

      const poll = async () => {
        try {
          const statusResponse = await apiRequest<SyncJob>(
            withTenantPath(activeTenant.id, `/media/sync/${job.job_id}`),
            { cache: "no-store" }
          );
          const updated = statusResponse.data;
          setSyncJob(updated);
          if (updated.status === "completed" || updated.status === "failed") {
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setSyncing(false);
            if (updated.status === "completed") {
              finishProcess(procId, "completed");
              showToast(`Índice sincronizado: ${updated.total_items} imágenes`);
              setBrowserKey((k) => k + 1);
            } else {
              finishProcess(procId, "failed", { error: updated.error ?? "Error al sincronizar" });
              showToast(updated.error ?? "Error al sincronizar", "error");
            }
          }
        } catch {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setSyncing(false);
        }
      };

      await poll();
      pollRef.current = window.setInterval(() => void poll(), 1200);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo iniciar la sincronización", "error");
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="rounded-3xl border border-border/80 bg-card/85 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Imágenes</div>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Biblioteca de medios</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              {activeTenant
                ? `Gestiona las imágenes de WordPress para ${activeTenant.name} y reutilízalas en los productos.`
                : "Selecciona un cliente activo para administrar su biblioteca de medios."}
            </p>
          </div>
          {activeTenant ? (
            <Button
              className="h-11 shrink-0 rounded-xl px-5"
              disabled={syncing}
              onClick={() => void startSync()}
              variant="outline"
            >
              {syncing
                ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Sincronizando...</>
                : <><DatabaseZap className="mr-2 h-4 w-4" />Sincronizar índice</>}
            </Button>
          ) : null}
        </div>
      </section>

      <Card className="rounded-3xl border-border/80 shadow-sm">
        <CardHeader className="px-5 pt-6 sm:px-6">
          <CardTitle>Galería</CardTitle>
          <CardDescription>Consulta, busca y sube imágenes a la biblioteca de WordPress.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-6 sm:px-6">
          {loading ? <div className="text-sm text-muted-foreground">Cargando biblioteca...</div> : null}
          {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error}</div> : null}
          {!loading && !error && !activeTenant ? <div className="text-sm text-muted-foreground">No hay cliente activo seleccionado.</div> : null}
          {!loading && !error && activeTenant ? (
            <MediaLibraryBrowser key={browserKey} onSyncRequest={() => void startSync()} tenantId={activeTenant.id} />
          ) : null}
        </CardContent>
      </Card>

      {/* Sync modal */}
      {syncJob ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl border border-border bg-background shadow-2xl sm:rounded-3xl">
            <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
              <div className="rounded-2xl border border-border bg-card p-2.5">
                <LoaderCircle className={["h-5 w-5", syncing ? "animate-spin text-primary" : syncJob.status === "failed" ? "text-destructive" : "text-emerald-500"].join(" ")} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-foreground">
                  {syncing ? "Sincronizando índice de imágenes..." : syncJob.status === "completed" ? "Sincronización completada" : "Sincronización fallida"}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {syncJob.status === "completed"
                    ? `${syncJob.total_items} imágenes indexadas`
                    : syncJob.total_pages > 0
                      ? `Página ${syncJob.processed_pages} de ${syncJob.total_pages}`
                      : "Conectando con WordPress..."}
                </div>
              </div>
              <Button className="shrink-0 rounded-xl" onClick={() => setSyncJob(null)} size="icon" title="Minimizar — el proceso sigue en segundo plano" variant="ghost">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4 px-5 py-5 sm:px-6">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {syncJob.status === "running"
                      ? `Descargando metadatos de imágenes de WordPress...`
                      : syncJob.status === "completed"
                        ? "Índice listo para usar en importaciones"
                        : syncJob.error ?? "Error desconocido"}
                  </span>
                  <span className="font-medium tabular-nums">{syncJob.progress}%</span>
                </div>
                <Progress className="h-2" value={syncJob.progress} />
              </div>

              {syncJob.status === "completed" ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                  {syncJob.total_items} imágenes indexadas. Las importaciones masivas ya no necesitan consultar WordPress.
                </div>
              ) : null}

              {syncJob.status === "failed" ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {syncJob.error ?? "No se pudo completar la sincronización."}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
