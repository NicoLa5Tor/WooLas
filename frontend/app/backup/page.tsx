"use client";

import { AlertTriangle, ChevronDown, LoaderCircle, RefreshCcw, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useProcesses } from "@/contexts/ProcessesContext";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import {
  API_RETRY_ATTEMPTS,
  FRONTEND_API_PREFIX,
  apiRequest,
  resolveActiveTenant,
  type AuthSession,
  uploadFileWithProgress,
  withTenantPath
} from "@/lib/api";

type BackupItem = {
  id: string;
  filename: string;
  backup_kind?: string;
  backup_kind_label?: string;
  created_at: string;
  product_count: number;
};

type BackupGroups = {
  active_backups: BackupItem[];
  restore_backups: BackupItem[];
};

type BackupResponse = BackupGroups | BackupItem[];

type RestoreJobStatus = {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  current_batch: number;
  total_batches: number;
  current_product_name: string | null;
  updated: number;
  failed: number;
  total_products: number;
  errors: Array<{ identifier: string; error: string }>;
  safety_backup_id: string | null;
  error: string | null;
};

const EMPTY_BACKUP_GROUPS: BackupGroups = { active_backups: [], restore_backups: [] };

const progressMessages = [
  { until: 18, text: "Preparando la solicitud del backup..." },
  { until: 42, text: "Conectando con WooCommerce y validando credenciales..." },
  { until: 72, text: "Descargando productos y consolidando la información..." },
  { until: 92, text: "Guardando el respaldo y actualizando el historial..." },
  { until: 100, text: "Finalizando el proceso..." }
];

const restoreMessages = [
  { until: 18, text: "Creando un backup de seguridad del estado actual..." },
  { until: 46, text: "Preparando el backup seleccionado para restaurarlo..." },
  { until: 82, text: "Restaurando productos en WooCommerce por lotes..." },
  { until: 100, text: "Finalizando la restauración..." }
];

function getProgressMessage(progress: number) {
  return progressMessages.find((item) => progress <= item.until)?.text ?? progressMessages[progressMessages.length - 1].text;
}

function getRestoreMessage(progress: number) {
  return restoreMessages.find((item) => progress <= item.until)?.text ?? restoreMessages[restoreMessages.length - 1].text;
}

function formatDate(value: string) {
  const normalizedValue = /z$|[+-]\d{2}:\d{2}$/i.test(value) ? value : `${value}Z`;
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Bogota"
  }).format(new Date(normalizedValue));
}

function getBackupKindLabel(backup: BackupItem) {
  if (backup.backup_kind_label) {
    return backup.backup_kind_label;
  }
  if (backup.backup_kind === "safety_restore") {
    return "Backup de seguridad";
  }
  if (backup.backup_kind === "restored_state") {
    return "Registro legado de restauración";
  }
  return "Backup operativo";
}

function normalizeBackupGroups(data: BackupResponse | undefined): BackupGroups {
  if (!data) {
    return EMPTY_BACKUP_GROUPS;
  }

  if (Array.isArray(data)) {
    return {
      active_backups: data,
      restore_backups: []
    };
  }

  return {
    active_backups: Array.isArray(data.active_backups) ? data.active_backups : [],
    restore_backups: Array.isArray(data.restore_backups) ? data.restore_backups : []
  };
}

export default function BackupPage() {
  const { showToast } = useToast();
  const { addProcess, finishProcess } = useProcesses();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [backupGroups, setBackupGroups] = useState<BackupGroups>(EMPTY_BACKUP_GROUPS);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importFilename, setImportFilename] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null);
  const [confirmRestoreTarget, setConfirmRestoreTarget] = useState<BackupItem | null>(null);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<BackupItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupMessage, setBackupMessage] = useState("Preparando backup...");
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreMessage, setRestoreMessage] = useState("Preparando restauración...");
  const [restoreJob, setRestoreJob] = useState<RestoreJobStatus | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const restorePollerRef = useRef<number | null>(null);

  const stopProgressTimer = () => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  const stopRestorePoller = () => {
    if (restorePollerRef.current) {
      window.clearInterval(restorePollerRef.current);
      restorePollerRef.current = null;
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

  const resetRestore = () => {
    stopRestorePoller();
    setRestoreProgress(0);
    setRestoreMessage("Preparando restauración...");
    setRestoreJob(null);
    setRestoreTarget(null);
  };

  const resetImport = () => {
    setImporting(false);
    setImportProgress(0);
    setImportFilename(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const loadBackups = async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" });
      setSession(me.data);
      const activeTenant = resolveActiveTenant(me.data);
      if (!activeTenant) {
        setBackupGroups(EMPTY_BACKUP_GROUPS);
        return;
      }
      const response = await apiRequest<BackupResponse>(withTenantPath(activeTenant.id, "/backups"), { cache: "no-store" });
      setBackupGroups(normalizeBackupGroups(response.data));
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
      stopRestorePoller();
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
    const procId = addProcess({ type: "backup_create", label: "Crear backup", pollUrl: null });

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
      finishProcess(procId, "completed");
      showToast("Backup creado correctamente");
      await loadBackups();
      window.setTimeout(() => { setCreating(false); resetProgress(); }, 900);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error creando backup";
      stopProgressTimer();
      setRetryMessage(null);
      setBackupMessage(message);
      finishProcess(procId, "failed", { error: message });
      showToast(message, "error");
      window.setTimeout(() => { setCreating(false); resetProgress(); }, 1200);
    }
  };

  const importBackupFile = async (file: File) => {
    if (!session) {
      return;
    }
    const activeTenant = resolveActiveTenant(session);
    if (!activeTenant) {
      showToast("Selecciona un cliente", "error");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json")) {
      showToast("Debes subir un archivo JSON", "error");
      return;
    }

    setImporting(true);
    setImportProgress(0);
    setImportFilename(file.name);

    try {
      await uploadFileWithProgress<BackupItem>(withTenantPath(activeTenant.id, "/backups/import"), file, (percent) => {
        setImportProgress(percent);
      });
      setImportProgress(100);
      showToast("Backup importado correctamente");
      await loadBackups();
      window.setTimeout(() => {
        resetImport();
        setShowImportPanel(false);
      }, 900);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo importar el backup", "error");
      window.setTimeout(() => {
        resetImport();
      }, 1200);
    }
  };

  const onFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }
    await importBackupFile(selectedFile);
  };

  const onDropFile = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const selectedFile = event.dataTransfer.files?.[0];
    if (!selectedFile) {
      return;
    }
    await importBackupFile(selectedFile);
  };

  const requestRestore = (backup: BackupItem) => {
    setConfirmRestoreTarget(backup);
  };

  const cancelRestoreConfirmation = () => {
    if (restoring) {
      return;
    }
    setConfirmRestoreTarget(null);
  };

  const confirmRestore = async () => {
    if (!session || !confirmRestoreTarget) return;
    const activeTenant = resolveActiveTenant(session);
    if (!activeTenant) { showToast("Selecciona un cliente", "error"); return; }

    const backup = confirmRestoreTarget;
    setConfirmRestoreTarget(null);
    setRestoreTarget(backup);
    setRestoring(true);
    setRestoreJob(null);
    setRestoreProgress(0);
    setRestoreMessage("Iniciando restauración...");

    try {
      const startResponse = await apiRequest<RestoreJobStatus>(
        withTenantPath(activeTenant.id, `/backups/${backup.id}/restore`),
        { method: "POST" }
      );
      const jobId = startResponse.data.job_id;
      const procId = addProcess({
        type: "restore",
        label: `Restaurar ${backup.filename}`,
        pollUrl: `/tenants/${activeTenant.id}/backups/restore-jobs/${jobId}`,
      });

      stopRestorePoller();
      restorePollerRef.current = window.setInterval(async () => {
        try {
          const jobResponse = await apiRequest<RestoreJobStatus>(
            withTenantPath(activeTenant.id, `/backups/restore-jobs/${jobId}`),
            { cache: "no-store", retryAttempts: 1 }
          );
          const job = jobResponse.data;
          setRestoreJob(job);
          setRestoreProgress(job.progress);

          if (job.status === "running" || job.status === "pending") {
            const batchInfo = job.total_batches > 0
              ? `Lote ${job.current_batch} de ${job.total_batches}`
              : "Preparando...";
            const productInfo = job.current_product_name ? ` · ${job.current_product_name}` : "";
            setRestoreMessage(`${batchInfo}${productInfo}`);
          } else if (job.status === "completed") {
            stopRestorePoller();
            finishProcess(procId, "completed", { result: { updated: job.updated, failed: job.failed } });
            setRestoreProgress(100);
            setRestoreMessage(`Restauración completada — ${job.updated} actualizados, ${job.failed} fallidos`);
            showToast("Backup restaurado correctamente");
            await loadBackups();
            window.setTimeout(() => { setRestoring(false); resetRestore(); }, 2000);
          } else if (job.status === "failed") {
            stopRestorePoller();
            finishProcess(procId, "failed", { error: job.error ?? "La restauración falló" });
            setRestoreMessage(job.error ?? "La restauración falló");
            showToast(job.error ?? "No se pudo restaurar el backup", "error");
            window.setTimeout(() => { setRestoring(false); resetRestore(); }, 2000);
          }
        } catch {
          // red error — seguir intentando
        }
      }, 1500);

    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo iniciar la restauración";
      setRestoreMessage(message);
      showToast(message, "error");
      window.setTimeout(() => { setRestoring(false); resetRestore(); }, 1800);
    }
  };

  const confirmDelete = async () => {
    if (!session || !confirmDeleteTarget) return;
    const activeTenant = resolveActiveTenant(session);
    if (!activeTenant) return;
    const backup = confirmDeleteTarget;
    setConfirmDeleteTarget(null);
    setDeleting(true);
    try {
      await apiRequest(withTenantPath(activeTenant.id, `/backups/${backup.id}`), { method: "DELETE" });
      showToast("Backup eliminado");
      await loadBackups();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo eliminar el backup", "error");
    } finally {
      setDeleting(false);
    }
  };

  const renderMobileCards = (items: BackupItem[] | undefined, allowRestore: boolean) => {
    const safeItems = Array.isArray(items) ? items : [];

    if (safeItems.length === 0) {
      return <div className="rounded-2xl border border-border bg-background/70 px-4 py-6 text-sm text-muted-foreground">No hay backups disponibles.</div>;
    }

    return (
      <div className="grid gap-4 md:hidden">
        {safeItems.map((backup) => (
          <div key={backup.id} className="rounded-2xl border border-border bg-background/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-sm font-medium break-all">{backup.filename}</div>
              <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-foreground">{getBackupKindLabel(backup)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-muted-foreground">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em]">Productos</div>
                <div className="mt-1 text-foreground">{backup.product_count}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em]">Fecha</div>
                <div className="mt-1 text-foreground">{formatDate(backup.created_at)}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <a className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline" href={`${FRONTEND_API_PREFIX}${withTenantPath(activeTenant!.id, `/backups/${backup.id}`)}`} rel="noreferrer" target="_blank">
                Descargar backup
              </a>
              {allowRestore ? (
                <Button className="rounded-xl" disabled={creating || importing || restoring || deleting} onClick={() => requestRestore(backup)} size="sm" variant="outline">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Restaurar
                </Button>
              ) : null}
              <Button className="rounded-xl" disabled={creating || importing || restoring || deleting} onClick={() => setConfirmDeleteTarget(backup)} size="sm" variant="outline">
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderDesktopTable = (items: BackupItem[] | undefined, allowRestore: boolean) => {
    const safeItems = Array.isArray(items) ? items : [];

    if (safeItems.length === 0) {
      return (
        <div className="hidden rounded-2xl border border-border bg-background/70 px-4 py-6 text-sm text-muted-foreground md:block">
          No hay backups disponibles.
        </div>
      );
    }

    return (
      <div className="hidden max-w-full overflow-x-auto overflow-y-hidden rounded-2xl border border-border md:block">
        <table className="min-w-[760px] divide-y divide-border text-sm">
          <thead className="bg-accent/70 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Archivo</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Productos</th>
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Descarga</th>
              {allowRestore ? <th className="px-4 py-3 font-medium">Restaurar</th> : null}
              <th className="px-4 py-3 font-medium">Eliminar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {safeItems.map((backup) => (
              <tr key={backup.id}>
                <td className="max-w-[280px] px-4 py-3 break-words">{backup.filename}</td>
                <td className="px-4 py-3 whitespace-nowrap">{getBackupKindLabel(backup)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{backup.product_count}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(backup.created_at)}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <a className="font-medium text-primary underline-offset-4 hover:underline" href={`${FRONTEND_API_PREFIX}${withTenantPath(activeTenant!.id, `/backups/${backup.id}`)}`} rel="noreferrer" target="_blank">
                    Descargar backup
                  </a>
                </td>
                {allowRestore ? (
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Button disabled={creating || importing || restoring || deleting} onClick={() => requestRestore(backup)} size="sm" variant="outline">
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Restaurar
                    </Button>
                  </td>
                ) : null}
                <td className="px-4 py-3 whitespace-nowrap">
                  <Button disabled={creating || importing || restoring || deleting} onClick={() => setConfirmDeleteTarget(backup)} size="sm" variant="outline">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const activeTenant = session ? resolveActiveTenant(session) : null;

  return (
    <>
      <div className="max-w-full space-y-6 overflow-x-hidden lg:space-y-8">
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
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button className="h-12 rounded-xl px-6 text-sm font-semibold" disabled={creating || importing || restoring || !activeTenant} onClick={createBackup}>
                {creating ? "Creando backup..." : "Crear backup"}
              </Button>
            </div>
          </div>
        </section>

        <Card className="max-w-full overflow-hidden rounded-3xl border-border/80 shadow-sm">
          <CardHeader className="px-5 pt-6 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle>Importar backup JSON</CardTitle>
                <CardDescription>Sube un backup descargado de WooLas solo cuando lo necesites. Al importarlo quedará disponible en el historial operativo.</CardDescription>
              </div>
              <Button
                className="rounded-xl sm:shrink-0"
                disabled={creating || importing || restoring || !activeTenant}
                onClick={() => setShowImportPanel((current) => !current)}
                variant="outline"
              >
                <Upload className="mr-2 h-4 w-4" />
                {showImportPanel ? "Ocultar importación" : "Importar backup"}
                <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${showImportPanel ? "rotate-180" : ""}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className={`px-5 transition-all duration-200 sm:px-6 ${showImportPanel ? "max-h-[520px] pb-6 opacity-100" : "max-h-0 overflow-hidden pb-0 opacity-0"}`}>
            <input accept="application/json,.json" className="hidden" onChange={(event) => void onFileSelected(event)} ref={fileInputRef} type="file" />
            <div
              className={`rounded-3xl border border-dashed p-6 text-center transition ${isDragActive ? "border-primary bg-primary/5" : "border-border bg-background/70"}`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragActive(false);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDrop={(event) => void onDropFile(event)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Upload className="h-6 w-6" />
              </div>
              <div className="mt-4 text-base font-medium">Arrastra un backup JSON aquí o haz clic para seleccionarlo</div>
              <div className="mt-2 text-sm text-muted-foreground">WooLas validará el archivo y lo agregará al historial operativo del cliente actual.</div>
              <div className="mt-4 text-xs uppercase tracking-[0.22em] text-muted-foreground">Formato esperado: archivo `.json` exportado desde WooLas</div>
            </div>
          </CardContent>
        </Card>

        <Card className="max-w-full overflow-hidden rounded-3xl border-border/80 shadow-sm">
          <CardHeader className="px-5 pt-6 sm:px-6">
            <CardTitle>Backups operativos</CardTitle>
            <CardDescription>Se conservan únicamente los tres backups manuales más recientes por cliente. Desde aquí puedes restaurar uno anterior.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5 pb-6 sm:px-6">
            {loading ? <div className="text-sm text-muted-foreground">Cargando backups...</div> : null}
            {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error}</div> : null}
            {!loading && !error && !activeTenant ? <div className="text-sm text-muted-foreground">No hay cliente activo seleccionado.</div> : null}
            {!loading && !error && activeTenant ? (
              <>
                {renderMobileCards(backupGroups.active_backups, true)}
                {renderDesktopTable(backupGroups.active_backups, true)}
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="max-w-full overflow-hidden rounded-3xl border-border/80 shadow-sm">
          <CardHeader className="px-5 pt-6 sm:px-6">
            <CardTitle>Backups de seguridad por restauración</CardTitle>
            <CardDescription>Este historial guarda sin límite el estado anterior del catálogo justo antes de cada restauración, para que puedas volver atrás si hace falta.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5 pb-6 sm:px-6">
            {loading ? <div className="text-sm text-muted-foreground">Cargando backups de seguridad...</div> : null}
            {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error}</div> : null}
            {!loading && !error && !activeTenant ? <div className="text-sm text-muted-foreground">No hay cliente activo seleccionado.</div> : null}
            {!loading && !error && activeTenant ? (
              <>
                {renderMobileCards(backupGroups.restore_backups, false)}
                {renderDesktopTable(backupGroups.restore_backups, false)}
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {confirmDeleteTarget ? (
        <div className="fixed inset-0 z-[58] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-border bg-card p-6 shadow-2xl sm:p-7">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
                <Trash2 className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Confirmar eliminación</div>
                <h2 className="mt-2 text-2xl font-semibold">Eliminar backup</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Se eliminará <span className="font-medium text-foreground">{confirmDeleteTarget.filename}</span>. Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button className="rounded-xl" onClick={() => setConfirmDeleteTarget(null)} variant="outline">
                Cancelar
              </Button>
              <Button className="rounded-xl" onClick={() => void confirmDelete()} variant="destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Sí, eliminar
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmRestoreTarget ? (
        <div className="fixed inset-0 z-[58] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-border bg-card p-6 shadow-2xl sm:p-7">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-600">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Confirmar restauración</div>
                <h2 className="mt-2 text-2xl font-semibold">Vas a restaurar un backup</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Se restaurará <span className="font-medium text-foreground">{confirmRestoreTarget.filename}</span>. Antes de hacerlo,
                  WooLas guardará un backup de seguridad con el estado actual para que puedas regresar si algo no te convence.
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">Qué va a pasar</div>
              <div className="mt-2">1. Se guarda un backup de seguridad del catálogo actual.</div>
              <div className="mt-1">2. Se aplican los datos del backup elegido en WooCommerce.</div>
              <div className="mt-1">3. El backup de seguridad queda guardado sin límite en el historial inferior.</div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button className="rounded-xl" onClick={cancelRestoreConfirmation} variant="outline">
                Cancelar
              </Button>
              <Button className="rounded-xl" onClick={() => void confirmRestore()}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Sí, restaurar backup
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
              <Button className="shrink-0 rounded-xl" onClick={() => setCreating(false)} size="icon" title="Minimizar — el proceso sigue en segundo plano" variant="ghost">
                <X className="h-4 w-4" />
              </Button>
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

      {importing ? (
        <div className="fixed inset-0 z-[62] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl sm:p-7">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <Upload className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Importación en progreso</div>
                <h2 className="mt-2 text-2xl font-semibold">Subiendo backup</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{importFilename ? `Procesando ${importFilename}` : "Subiendo y validando el backup JSON."}</p>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progreso</span>
                <span className="font-medium">{importProgress}%</span>
              </div>
              <Progress className="h-3" value={importProgress} />
            </div>
            <div className="mt-6 rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">Qué está pasando</div>
              <div className="mt-2">WooLas está subiendo el archivo, validando que sea un backup JSON correcto y agregándolo al historial operativo del cliente.</div>
            </div>
          </div>
        </div>
      ) : null}

      {restoring ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-border bg-card p-6 shadow-2xl sm:p-7">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <RotateCcw className={`h-6 w-6 ${restoreJob?.status === "completed" || restoreJob?.status === "failed" ? "" : "animate-spin"}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Restauración en progreso</div>
                <h2 className="mt-2 text-2xl font-semibold">Restaurando backup</h2>
                {restoreTarget ? <div className="mt-1 truncate text-xs text-muted-foreground">{restoreTarget.filename}</div> : null}
              </div>
              <Button
                className="shrink-0 rounded-xl"
                onClick={() => setRestoring(false)}
                size="icon"
                title="Minimizar — el proceso sigue en segundo plano"
                variant="ghost"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{restoreMessage}</span>
                <span className="tabular-nums text-muted-foreground">{restoreProgress}%</span>
              </div>
              <Progress className="h-3" value={restoreProgress} />
              {restoreJob && restoreJob.total_batches > 0 ? (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Lote {restoreJob.current_batch} / {restoreJob.total_batches}</span>
                  <span>{restoreJob.updated} actualizados · {restoreJob.failed} fallidos · {restoreJob.total_products} total</span>
                </div>
              ) : null}
            </div>

            {restoreJob?.current_product_name && restoreJob.status === "running" ? (
              <div className="mt-4 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm">
                <span className="text-muted-foreground">Procesando: </span>
                <span className="font-medium text-foreground">{restoreJob.current_product_name}</span>
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div>
                  <div className="font-medium text-foreground">Backup de seguridad automático</div>
                  <div className="mt-1">WooLas guardó el estado actual antes de restaurar. Puedes volver atrás desde el historial inferior.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
