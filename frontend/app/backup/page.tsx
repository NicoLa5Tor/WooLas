"use client";

import { LoaderCircle, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  API_RETRY_ATTEMPTS,
  FRONTEND_API_PREFIX,
  apiRequest,
  resolveActiveTenant,
  type AuthSession,
  withTenantPath
} from "@/lib/api";
import { useToast } from "@/components/ui/toast";

type BackupItem = {
  id: string;
  filename: string;
  created_at: string;
  product_count: number;
};

const progressMessages = [
  { until: 18, text: "Preparando la solicitud del backup..." },
  { until: 42, text: "Conectando con WooCommerce y validando credenciales..." },
  { until: 72, text: "Descargando productos y consolidando la información..." },
  { until: 92, text: "Guardando el respaldo y actualizando el historial..." },
  { until: 100, text: "Finalizando el proceso..." }
];

function getProgressMessage(progress: number) {
  return progressMessages.find((item) => progress <= item.until)?.text ?? progressMessages[progressMessages.length - 1].text;
}

export default function BackupPage() {
  const { showToast } = useToast();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupMessage, setBackupMessage] = useState("Preparando backup...");
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  const stopProgressTimer = () => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  const startProgressTimer = () => {
    stopProgressTimer();
    setBackupProgress(6);
    setBackupMessage(getProgressMessage(6));
    progressTimerRef.current = window.setInterval(() => {
      setBackupProgress((current) => {
        if (current >= 93) {
          return current;
        }
        const next = current < 35 ? current + 6 : current < 70 ? current + 4 : current + 2;
        setBackupMessage(getProgressMessage(next));
        return next;
      });
    }, 700);
  };

  const finishProgress = () => {
    stopProgressTimer();
    setBackupProgress(100);
    setBackupMessage("Backup completado correctamente.");
  };

  const resetProgress = () => {
    stopProgressTimer();
    setBackupProgress(0);
    setBackupMessage("Preparando backup...");
    setRetryMessage(null);
  };

  const loadBackups = async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" });
      setSession(me.data);
      const activeTenant = resolveActiveTenant(me.data);
      if (!activeTenant) {
        setBackups([]);
        return;
      }
      const response = await apiRequest<BackupItem[]>(withTenantPath(activeTenant.id, "/backups"), { cache: "no-store" });
      setBackups(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los backups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBackups();
    return () => {
      stopProgressTimer();
    };
  }, []);

  const createBackup = async () => {
    if (!session) {
      return;
    }
    const activeTenant = resolveActiveTenant(session);
    if (!activeTenant) {
      showToast("Selecciona un cliente", "error");
      return;
    }

    setCreating(true);
    setRetryMessage(null);
    startProgressTimer();

    try {
      await apiRequest<BackupItem>(withTenantPath(activeTenant.id, "/backup"), {
        method: "POST",
        onRetry: ({ attempt, maxAttempts, delayMs }) => {
          const message = `Error de red detectado. Reintentando conexión (${attempt}/${maxAttempts}) en ${Math.ceil(delayMs / 1000)}s...`;
          setRetryMessage(message);
          setBackupMessage("La conexión falló, pero WooLas seguirá intentando automáticamente.");
          showToast(message, "error");
        }
      });

      finishProgress();
      showToast("Backup creado correctamente");
      await loadBackups();
      window.setTimeout(() => {
        setCreating(false);
        resetProgress();
      }, 900);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error creando backup";
      stopProgressTimer();
      setRetryMessage(null);
      setBackupMessage(message);
      showToast(message, "error");
      window.setTimeout(() => {
        setCreating(false);
        resetProgress();
      }, 1200);
    }
  };

  const activeTenant = session ? resolveActiveTenant(session) : null;

  return (
    <>
      <div className="space-y-6 lg:space-y-8">
        <section className="rounded-3xl border border-border/80 bg-card/85 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Backup</div>
              <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Respaldo completo de productos</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
                {activeTenant
                  ? `Crea una copia reciente de ${activeTenant.name} antes de trabajar con productos o importaciones masivas.`
                  : "Selecciona un cliente activo para crear y consultar sus backups."}
              </p>
            </div>
            <Button className="h-12 w-full rounded-xl px-6 text-sm font-semibold sm:w-auto" disabled={creating || !activeTenant} onClick={createBackup}>
              {creating ? "Creando backup..." : "Crear backup"}
            </Button>
          </div>
        </section>

        <Card className="rounded-3xl border-border/80 shadow-sm">
          <CardHeader className="px-5 pt-6 sm:px-6">
            <CardTitle>Historial</CardTitle>
            <CardDescription>Se conservan solo los tres respaldos más recientes por cliente.</CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-6 sm:px-6">
            {loading ? <div className="text-sm text-muted-foreground">Cargando backups...</div> : null}
            {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error}</div> : null}
            {!loading && !error && !activeTenant ? <div className="text-sm text-muted-foreground">No hay cliente activo seleccionado.</div> : null}
            {!loading && !error && activeTenant ? (
              <>
                <div className="grid gap-4 md:hidden">
                  {backups.map((backup) => (
                    <div key={backup.id} className="rounded-2xl border border-border bg-background/70 p-4">
                      <div className="text-sm font-medium break-all">{backup.filename}</div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-muted-foreground">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em]">Productos</div>
                          <div className="mt-1 text-foreground">{backup.product_count}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em]">Fecha</div>
                          <div className="mt-1 text-foreground">{new Date(backup.created_at).toLocaleString()}</div>
                        </div>
                      </div>
                      <a className="mt-4 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline" href={`${FRONTEND_API_PREFIX}${withTenantPath(activeTenant.id, `/backups/${backup.id}`)}`} target="_blank">
                        Descargar backup
                      </a>
                    </div>
                  ))}
                  {backups.length === 0 ? <div className="rounded-2xl border border-border bg-background/70 px-4 py-6 text-sm text-muted-foreground">No hay backups disponibles.</div> : null}
                </div>

                <div className="hidden overflow-hidden rounded-2xl border border-border md:block">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="bg-accent/70 text-left">
                      <tr>
                        <th className="px-4 py-3 font-medium">Archivo</th>
                        <th className="px-4 py-3 font-medium">Productos</th>
                        <th className="px-4 py-3 font-medium">Fecha</th>
                        <th className="px-4 py-3 font-medium">Descarga</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {backups.map((backup) => (
                        <tr key={backup.id}>
                          <td className="px-4 py-3">{backup.filename}</td>
                          <td className="px-4 py-3">{backup.product_count}</td>
                          <td className="px-4 py-3">{new Date(backup.created_at).toLocaleString()}</td>
                          <td className="px-4 py-3">
                            <a className="text-primary underline-offset-4 hover:underline" href={`${FRONTEND_API_PREFIX}${withTenantPath(activeTenant.id, `/backups/${backup.id}`)}`} target="_blank">
                              Descargar
                            </a>
                          </td>
                        </tr>
                      ))}
                      {backups.length === 0 ? (
                        <tr>
                          <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                            No hay backups disponibles.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {creating ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl sm:p-7">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <LoaderCircle className="h-6 w-6 animate-spin" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Backup en progreso</div>
                <h2 className="mt-2 text-2xl font-semibold">Creando respaldo</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{backupMessage}</p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progreso estimado</span>
                <span className="font-medium">{backupProgress}%</span>
              </div>
              <Progress className="h-3" value={backupProgress} />
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">Qué está pasando</div>
              <div className="mt-2">WooLas está consultando WooCommerce, reuniendo los productos y guardando el respaldo en la base de datos.</div>
            </div>

            <div className="mt-4 flex flex-wrap items-start gap-3 rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
              <RefreshCcw className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium text-foreground">Reintentos automáticos</div>
                <div className="mt-1">Si aparece un error de red, WooLas reintentará automáticamente hasta {API_RETRY_ATTEMPTS} veces.</div>
                {retryMessage ? <div className="mt-2 text-destructive">{retryMessage}</div> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
