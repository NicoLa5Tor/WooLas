"use client";

import { AlertTriangle, DatabaseZap, Download, LoaderCircle, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MediaLibraryBrowser } from "@/components/MediaLibraryBrowser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { useProcesses } from "@/contexts/ProcessesContext";
import { apiRequest, FRONTEND_API_PREFIX, resolveActiveTenant, type AuthSession, withTenantPath } from "@/lib/api";

async function downloadFile(path: string, fallbackFilename: string) {
  const response = await fetch(`${FRONTEND_API_PREFIX}${path}`, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("No se pudo descargar el archivo");
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch?.[1] ?? fallbackFilename;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

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

type PurgeJob = {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  total: number;
  processed: number;
  deleted: number;
  failed: number;
  progress: number;
  current_filename: string | null;
  errors: Array<{ media_id: string; error: string }>;
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
  const [exporting, setExporting] = useState(false);
  const [browserKey, setBrowserKey] = useState(0);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState("");
  const [purgeJob, setPurgeJob] = useState<PurgeJob | null>(null);
  const [purging, setPurging] = useState(false);
  const pollRef = useRef<number | null>(null);
  const purgePollRef = useRef<number | null>(null);

  useEffect(() => {
    setLoading(true);
    void apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" })
      .then((response) => setSession(response.data))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar la sesión"))
      .finally(() => setLoading(false));
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (purgePollRef.current) window.clearInterval(purgePollRef.current);
    };
  }, []);

  const startPurge = async () => {
    if (!activeTenant || purgeConfirmText !== "BORRAR") return;
    setPurging(true);
    setPurgeJob(null);
    try {
      const response = await apiRequest<PurgeJob>(
        withTenantPath(activeTenant.id, `/media/purge?confirm=BORRAR`),
        { method: "POST" }
      );
      setPurgeJob(response.data);
      const jobId = response.data.job_id;
      const procId = addProcess({
        type: "media_purge",
        label: "Limpiar TODA la galería WP",
        pollUrl: `/tenants/${activeTenant.id}/media/purge/${jobId}`,
      });
      const poll = async () => {
        try {
          const statusResponse = await apiRequest<PurgeJob>(
            withTenantPath(activeTenant.id, `/media/purge/${jobId}`),
            { cache: "no-store" }
          );
          const updated = statusResponse.data;
          setPurgeJob(updated);
          if (updated.status === "completed" || updated.status === "failed") {
            if (purgePollRef.current) window.clearInterval(purgePollRef.current);
            purgePollRef.current = null;
            setPurging(false);
            if (updated.status === "completed") {
              finishProcess(procId, "completed");
              showToast(`Galería limpiada: ${updated.deleted} eliminadas${updated.failed ? `, ${updated.failed} fallidas` : ""}`);
              setBrowserKey((k) => k + 1);
            } else {
              finishProcess(procId, "failed");
              showToast(updated.error ?? "Falló la limpieza", "error");
            }
          }
        } catch (err) {
          if (purgePollRef.current) window.clearInterval(purgePollRef.current);
          purgePollRef.current = null;
          setPurging(false);
          showToast(err instanceof Error ? err.message : "Error consultando progreso", "error");
        }
      };
      purgePollRef.current = window.setInterval(() => void poll(), 1500);
      void poll();
    } catch (err) {
      setPurging(false);
      const message = err instanceof Error ? err.message : "No se pudo iniciar la limpieza";
      showToast(message, "error");
    }
  };

  const closePurgeModal = () => {
    if (purging) return;
    setShowPurgeModal(false);
    setPurgeConfirmText("");
  };

  const activeTenant = session ? resolveActiveTenant(session) : null;

  const exportExcel = async () => {
    if (!activeTenant) return;
    setExporting(true);
    try {
      await downloadFile(withTenantPath(activeTenant.id, "/media/export"), "imagenes_woocommerce.xlsx");
      showToast("Excel de imágenes descargado");
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo descargar el Excel";
      showToast(message, "error");
    } finally {
      setExporting(false);
    }
  };

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
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                className="h-11 rounded-xl px-5"
                disabled={exporting}
                onClick={() => void exportExcel()}
                variant="outline"
              >
                {exporting
                  ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Descargando...</>
                  : <><Download className="mr-2 h-4 w-4" />Descargar Excel</>}
              </Button>
              <Button
                className="h-11 rounded-xl px-5"
                disabled={syncing}
                onClick={() => void startSync()}
                variant="outline"
              >
                {syncing
                  ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Sincronizando...</>
                  : <><DatabaseZap className="mr-2 h-4 w-4" />Sincronizar índice</>}
              </Button>
              <Button
                className="h-11 rounded-xl border-destructive/40 px-5 text-destructive hover:bg-destructive/10"
                disabled={purging}
                onClick={() => setShowPurgeModal(true)}
                variant="outline"
              >
                <Trash2 className="mr-2 h-4 w-4" />Limpiar toda la galería
              </Button>
            </div>
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

      {showPurgeModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-card shadow-2xl">
            <div className="border-b border-destructive/30 bg-destructive/5 px-6 py-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" />
                <div>
                  <h2 className="text-lg font-semibold text-destructive">Eliminar TODA la galería de WordPress</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Esta acción borra cada imagen del media library de WP. <strong>Irreversible</strong>. Los productos que referencien esas imágenes quedarán sin imagen.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4 px-6 py-5">
              {!purgeJob ? (
                <>
                  <p className="text-sm">
                    Para confirmar, escribe <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">BORRAR</span> en mayúsculas:
                  </p>
                  <input
                    type="text"
                    className="h-11 w-full rounded-xl border border-border bg-background px-3 font-mono uppercase outline-none focus:border-destructive"
                    placeholder="Escribe BORRAR"
                    value={purgeConfirmText}
                    onChange={(e) => setPurgeConfirmText(e.target.value)}
                    disabled={purging}
                    autoFocus
                  />
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {purgeJob.status === "completed" ? "Limpieza terminada" :
                       purgeJob.status === "failed" ? "Limpieza falló" :
                       "Eliminando imágenes..."}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{purgeJob.progress}%</span>
                  </div>
                  <Progress className="h-2" value={purgeJob.progress} />
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-xl border border-border px-2 py-2">
                      <div className="text-muted-foreground">Procesadas</div>
                      <div className="mt-1 text-base font-semibold tabular-nums">{purgeJob.processed} / {purgeJob.total}</div>
                    </div>
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2 py-2">
                      <div className="text-emerald-700 dark:text-emerald-400">Eliminadas</div>
                      <div className="mt-1 text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{purgeJob.deleted}</div>
                    </div>
                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-2 py-2">
                      <div className="text-destructive">Falladas</div>
                      <div className="mt-1 text-base font-semibold tabular-nums text-destructive">{purgeJob.failed}</div>
                    </div>
                  </div>
                  {purgeJob.current_filename && purgeJob.status === "running" ? (
                    <div className="truncate text-xs text-muted-foreground">
                      Borrando: <span className="font-mono">{purgeJob.current_filename}</span>
                    </div>
                  ) : null}
                  {purgeJob.error ? (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{purgeJob.error}</div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
              <Button variant="outline" onClick={closePurgeModal} disabled={purging}>
                {purgeJob?.status === "completed" || purgeJob?.status === "failed" ? "Cerrar" : "Cancelar"}
              </Button>
              {!purgeJob ? (
                <Button
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => void startPurge()}
                  disabled={purging || purgeConfirmText !== "BORRAR"}
                >
                  {purging ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Iniciando...</> : <><Trash2 className="mr-2 h-4 w-4" />Eliminar todo</>}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
