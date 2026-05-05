"use client";

import { AlertCircle, CheckCircle2, ChevronDown, DatabaseZap, Image, LoaderCircle, RotateCcw, Server, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { type Process, type ProcessType, useProcesses } from "@/contexts/ProcessesContext";

function typeIcon(type: ProcessType) {
  if (type === "restore") return <RotateCcw className="h-4 w-4" />;
  if (type === "media_sync") return <DatabaseZap className="h-4 w-4" />;
  if (type === "image_import") return <Image className="h-4 w-4" />;
  return <Server className="h-4 w-4" />;
}

function statusIcon(p: Process) {
  if (p.status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (p.status === "failed") return <AlertCircle className="h-4 w-4 text-destructive" />;
  return <LoaderCircle className="h-4 w-4 animate-spin text-primary" />;
}

function statusBadge(p: Process) {
  if (p.status === "completed") return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Completado</span>;
  if (p.status === "failed") return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">Falló</span>;
  if (p.status === "running") return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">En curso</span>;
  return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">En cola</span>;
}

function resultSummary(p: Process) {
  if (!p.result) return null;
  const parts: string[] = [];
  if (p.result.updated !== undefined) parts.push(`${p.result.updated} actualizados`);
  if (p.result.failed !== undefined && p.result.failed > 0) parts.push(`${p.result.failed} fallidos`);
  if (p.result.skipped !== undefined && p.result.skipped > 0) parts.push(`${p.result.skipped} omitidos`);
  return parts.length ? parts.join(" · ") : null;
}

export function ProcessesPanel() {
  const { processes, clearFinished } = useProcesses();
  const [open, setOpen] = useState(false);

  const activeCount = processes.filter((p) => p.status === "pending" || p.status === "running").length;
  const hasAny = processes.length > 0;

  if (!hasAny) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-[80] flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-transform hover:scale-105 active:scale-95"
        aria-label="Ver procesos en segundo plano"
      >
        {activeCount > 0 ? (
          <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        )}
        {activeCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {activeCount}
          </span>
        ) : null}
      </button>

      {/* Panel */}
      {open ? (
        <div className="fixed bottom-20 right-4 z-[80] w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl sm:right-5">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Procesos en segundo plano</span>
              {activeCount > 0 ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{activeCount} activo{activeCount > 1 ? "s" : ""}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              {processes.some((p) => p.status === "completed" || p.status === "failed") ? (
                <button
                  onClick={clearFinished}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Limpiar completados"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Process list */}
          <div className="max-h-[60dvh] overflow-y-auto">
            {processes.map((p) => (
              <div key={p.id} className="border-b border-border/50 px-4 py-3 last:border-b-0">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0 text-muted-foreground">{typeIcon(p.type)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{p.label}</span>
                      {statusBadge(p)}
                    </div>

                    {(p.status === "running" || p.status === "pending") ? (
                      <>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${p.progress}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="truncate">{p.detail}</span>
                          <span className="ml-2 shrink-0 tabular-nums">{p.progress}%</span>
                        </div>
                      </>
                    ) : p.status === "completed" ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {resultSummary(p) ?? "Proceso finalizado correctamente"}
                      </div>
                    ) : p.error ? (
                      <div className="mt-1 truncate text-xs text-destructive">{p.error}</div>
                    ) : null}

                    {p.status === "completed" || p.status === "failed" ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {statusIcon(p)}
                        <span className="text-[11px] text-muted-foreground">
                          {p.finishedAt ? new Intl.DateTimeFormat("es-CO", { timeStyle: "short" }).format(p.finishedAt) : ""}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
