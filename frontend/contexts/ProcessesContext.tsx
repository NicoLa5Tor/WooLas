"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ProcessType = "restore" | "media_sync" | "image_import" | "backup_create" | "media_purge";
export type ProcessStatus = "pending" | "running" | "completed" | "failed";

export type Process = {
  id: string;
  type: ProcessType;
  label: string;
  pollUrl: string | null;
  status: ProcessStatus;
  progress: number;
  detail: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
  result: { updated?: number; failed?: number; skipped?: number } | null;
};

type ProcessesContextValue = {
  processes: Process[];
  addProcess: (opts: { type: ProcessType; label: string; pollUrl: string | null }) => string;
  finishProcess: (id: string, status: ProcessStatus, opts?: { error?: string; result?: Process["result"] }) => void;
  clearFinished: () => void;
};

const ProcessesContext = createContext<ProcessesContextValue | null>(null);

function normalizeJob(type: ProcessType, data: Record<string, unknown>): {
  status: ProcessStatus;
  progress: number;
  detail: string;
  result: Process["result"] | null;
  error: string | null;
} {
  const raw = String(data.status ?? "pending");
  const status: ProcessStatus =
    raw === "completed" ? "completed" : raw === "failed" ? "failed" : raw === "running" ? "running" : "pending";

  if (type === "restore") {
    const batch = Number(data.current_batch ?? 0);
    const total = Number(data.total_batches ?? 0);
    const name = data.current_product_name ? String(data.current_product_name) : null;
    return {
      status, progress: Number(data.progress ?? 0),
      detail: total > 0 ? `Lote ${batch}/${total}${name ? ` · ${name}` : ""}` : (name ?? "Preparando..."),
      result: { updated: Number(data.updated ?? 0), failed: Number(data.failed ?? 0) },
      error: data.error ? String(data.error) : null,
    };
  }

  if (type === "media_sync") {
    const pages = Number(data.processed_pages ?? 0);
    const totalPages = Number(data.total_pages ?? 0);
    const items = Number(data.total_items ?? 0);
    return {
      status, progress: Number(data.progress ?? 0),
      detail: totalPages > 0 ? `Página ${pages}/${totalPages}${items > 0 ? ` · ${items} imágenes` : ""}` : "Descargando...",
      result: null,
      error: data.error ? String(data.error) : null,
    };
  }

  if (type === "image_import") {
    const processed = Number(data.processed ?? 0);
    const total = Number(data.total ?? 0);
    const name = data.current_product_name ? String(data.current_product_name) : null;
    const r = data.result as Record<string, unknown> | null | undefined;
    return {
      status, progress: Number(data.progress ?? 0),
      detail: total > 0 ? `${processed}/${total}${name ? ` · ${name}` : ""}` : (name ?? "Procesando..."),
      result: r ? { updated: Number(r.updated ?? 0), failed: Number(r.failed ?? 0), skipped: Number(r.skipped ?? 0) } : null,
      error: data.error ? String(data.error) : null,
    };
  }

  return { status, progress: Number(data.progress ?? 0), detail: "", result: null, error: data.error ? String(data.error) : null };
}

export function ProcessesProvider({ children }: { children: React.ReactNode }) {
  const [processes, setProcesses] = useState<Process[]>([]);
  const processesRef = useRef<Process[]>([]);
  const pollerRef = useRef<number | null>(null);

  // Keep ref in sync
  useEffect(() => {
    processesRef.current = processes;
  }, [processes]);

  const addProcess = useCallback((opts: { type: ProcessType; label: string; pollUrl: string | null }): string => {
    const id = crypto.randomUUID();
    const proc: Process = {
      id, type: opts.type, label: opts.label, pollUrl: opts.pollUrl,
      status: "pending", progress: 0, detail: "Iniciando...",
      startedAt: new Date(), finishedAt: null, error: null, result: null,
    };
    setProcesses((prev) => [proc, ...prev]);
    return id;
  }, []);

  const finishProcess = useCallback((id: string, status: ProcessStatus, opts?: { error?: string; result?: Process["result"] }) => {
    setProcesses((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, status, progress: status === "completed" ? 100 : p.progress, finishedAt: new Date(), error: opts?.error ?? null, result: opts?.result ?? p.result }
          : p
      )
    );
  }, []);

  const clearFinished = useCallback(() => {
    setProcesses((prev) => prev.filter((p) => p.status !== "completed" && p.status !== "failed"));
  }, []);

  // Global poller
  useEffect(() => {
    const tick = async () => {
      const active = processesRef.current.filter(
        (p) => p.pollUrl && (p.status === "pending" || p.status === "running")
      );
      for (const p of active) {
        try {
          const res = await fetch(`/api/backend/api${p.pollUrl}`, { credentials: "include", cache: "no-store" });
          if (!res.ok) continue;
          const json = (await res.json()) as { data: Record<string, unknown> };
          const n = normalizeJob(p.type, json.data);
          setProcesses((prev) =>
            prev.map((item) =>
              item.id === p.id
                ? {
                    ...item,
                    status: n.status,
                    progress: n.progress,
                    detail: n.detail,
                    result: n.result ?? item.result,
                    error: n.error,
                    finishedAt: (n.status === "completed" || n.status === "failed") ? new Date() : item.finishedAt,
                  }
                : item
            )
          );
        } catch {
          // keep trying
        }
      }
    };

    pollerRef.current = window.setInterval(() => void tick(), 1500);
    return () => { if (pollerRef.current) window.clearInterval(pollerRef.current); };
  }, []);

  return (
    <ProcessesContext.Provider value={{ processes, addProcess, finishProcess, clearFinished }}>
      {children}
    </ProcessesContext.Provider>
  );
}

export function useProcesses() {
  const ctx = useContext(ProcessesContext);
  if (!ctx) throw new Error("useProcesses must be used inside ProcessesProvider");
  return ctx;
}
