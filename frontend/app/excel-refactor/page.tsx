"use client";

import { ArrowRightLeft, GripVertical, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { apiRequest, resolveActiveTenant, type AuthSession, withTenantPath } from "@/lib/api";

type ImportDraft = {
  id: string;
  original_filename: string;
  sample_rows: Array<Record<string, string>>;
  source_headers: string[];
  format_analysis: {
    status: "ready" | "typos" | "refactor_required";
    source_headers: string[];
    expected_fields: Array<{ key: string; label: string; required: boolean }>;
  };
};

type SourceColumn = {
  header: string;
  samples: string[];
};

export default function ExcelRefactorPage() {
  const { showToast } = useToast();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [draggedHeader, setDraggedHeader] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeTenant = session ? resolveActiveTenant(session) : null;

  useEffect(() => {
    void apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        setSession(response.data);
        const tenant = resolveActiveTenant(response.data);
        if (!tenant) {
          return;
        }
        const draftResponse = await apiRequest<ImportDraft | null>(withTenantPath(tenant.id, "/imports/current"), { cache: "no-store" });
        setDraft(draftResponse.data);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (!draft) {
      return;
    }
    const nextMapping: Record<string, string> = {};
    for (const field of draft.format_analysis.expected_fields) {
      nextMapping[field.key] = "";
    }
    setMapping(nextMapping);
  }, [draft?.id]);

  const sourceColumns = useMemo<SourceColumn[]>(() => {
    if (!draft) {
      return [];
    }
    return draft.source_headers
      .filter((header) => header.trim().length > 0)
      .map((header) => ({
        header,
        samples: draft.sample_rows.map((row) => row[header] ?? "").filter((value) => value.trim().length > 0).slice(0, 3)
      }));
  }, [draft]);

  const assignedHeaders = useMemo(() => new Set(Object.values(mapping).filter(Boolean)), [mapping]);

  const requiredMissing = useMemo(
    () => draft?.format_analysis.expected_fields.filter((field) => field.required && !mapping[field.key]) ?? [],
    [draft, mapping]
  );

  const handleAssign = (fieldKey: string, header: string) => {
    setMapping((current) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(current)) {
        next[key] = value === header ? "" : value;
      }
      next[fieldKey] = header;
      return next;
    });
  };

  const handleDrop = (fieldKey: string) => {
    if (!draggedHeader) {
      return;
    }
    handleAssign(fieldKey, draggedHeader);
    setDraggedHeader(null);
  };

  const handleClear = (fieldKey: string) => {
    setMapping((current) => ({ ...current, [fieldKey]: "" }));
  };

  const handleRefactor = async () => {
    if (!activeTenant || !draft) {
      return;
    }
    setSaving(true);
    try {
      await apiRequest(withTenantPath(activeTenant.id, "/imports/refactor"), {
        method: "POST",
        body: JSON.stringify({ mapping })
      });
      showToast("Excel refactorizado y guardado en la sesión");
      window.location.href = "/import";
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo refactorizar el Excel", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="rounded-3xl border border-border/80 bg-card/85 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-8">
        <div className="max-w-4xl">
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Refactorizar Excel</div>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Arrastra columnas al formato oficial</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            Este módulo trabaja con las columnas reales del Excel del usuario. Arrastra cada columna fuente al campo esperado de WooLas y genera un archivo compatible.
          </p>
        </div>
      </section>

      {!draft ? (
        <Card className="rounded-3xl border-border/80 shadow-sm">
          <CardContent className="px-5 py-8 text-sm text-muted-foreground sm:px-6">No hay un Excel cargado en la sesión actual.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <Card className="rounded-3xl border-border/80 shadow-sm">
            <CardHeader className="px-5 pt-6 sm:px-6">
              <CardTitle>Columnas del archivo fuente</CardTitle>
              <CardDescription>{draft.original_filename}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-6 sm:px-6">
              {sourceColumns.map((column) => {
                const assigned = assignedHeaders.has(column.header);
                return (
                  <button
                    key={column.header}
                    className={[
                      "w-full rounded-2xl border p-4 text-left transition-colors",
                      assigned ? "border-primary/40 bg-primary/5" : "border-border bg-background/70 hover:bg-accent/40"
                    ].join(" ")}
                    draggable
                    onClick={() => setDraggedHeader(column.header)}
                    onDragStart={() => setDraggedHeader(column.header)}
                    type="button"
                  >
                    <div className="flex items-start gap-3">
                      <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{column.header}</div>
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {column.samples.length > 0 ? column.samples.map((sample, index) => <div key={`${column.header}-${index}`} className="truncate">Ejemplo: {sample}</div>) : <div>Sin datos de muestra.</div>}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-border/80 shadow-sm">
            <CardHeader className="px-5 pt-6 sm:px-6">
              <CardTitle>Formato esperado por WooLas</CardTitle>
              <CardDescription>Suelta aquí la columna fuente correspondiente. Si una columna no aplica, déjala vacía.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-5 pb-6 sm:px-6">
              {draft.format_analysis.expected_fields.map((field) => {
                const assignedHeader = mapping[field.key];
                return (
                  <div
                    key={field.key}
                    className={[
                      "grid gap-3 rounded-2xl border p-4 transition-colors lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center",
                      assignedHeader ? "border-primary/40 bg-primary/5" : "border-border bg-background/70"
                    ].join(" ")}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleDrop(field.key)}
                  >
                    <div>
                      <div className="font-medium text-foreground">{field.label}</div>
                      <div className="text-sm text-muted-foreground">{field.required ? "Obligatoria" : "Opcional"}</div>
                    </div>
                    <div className="flex justify-center text-muted-foreground"><ArrowRightLeft className="h-4 w-4" /></div>
                    <div className="rounded-2xl border border-dashed border-border bg-card p-3">
                      {assignedHeader ? (
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{assignedHeader}</div>
                            <div className="text-xs text-muted-foreground">Columna asignada</div>
                          </div>
                          <Button className="rounded-xl" onClick={() => handleClear(field.key)} size="sm" variant="outline">
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Quitar
                          </Button>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          {draggedHeader ? "Suelta aquí la columna seleccionada." : "Arrastra una columna desde la izquierda y suéltala aquí."}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {requiredMissing.length > 0 ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                  Faltan campos obligatorios por mapear: {requiredMissing.map((field) => field.label).join(", ")}.
                </div>
              ) : null}

              <div className="flex gap-3">
                <Button className="rounded-xl px-6" disabled={saving || requiredMissing.length > 0} onClick={() => void handleRefactor()}>
                  {saving ? "Refactorizando..." : "Generar Excel compatible"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
