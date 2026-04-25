"use client";

import { UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiRequest, resolveActiveTenant, type AuthSession, withTenantPath } from "@/lib/api";

type PreviewResponse = {
  headers: string[];
  preview_rows: Array<{
    identifier: string;
    current_value: string | number | null;
    new_value: string;
    product_found: boolean;
    product_id: number | null;
    product_name: string | null;
  }>;
  sample_rows: Array<Record<string, string>>;
  total_rows: number;
};

type UpdateResponse = {
  updated: number;
  failed: number;
  errors: Array<{ identifier: string; error: string }>;
  total_rows: number;
};

const wcFields = ["regular_price", "sale_price", "stock_quantity", "name", "description", "short_description", "status"];

export default function ImportPage() {
  const { showToast } = useToast();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<Array<Record<string, string>>>([]);
  const [idColumn, setIdColumn] = useState("");
  const [valueColumn, setValueColumn] = useState("");
  const [identifierType, setIdentifierType] = useState<"sku" | "product_id">("sku");
  const [wcField, setWcField] = useState("regular_price");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<UpdateResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingApply, setLoadingApply] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const previewColumns = useMemo(() => headers.filter(Boolean), [headers]);
  const activeTenant = session ? resolveActiveTenant(session) : null;

  useEffect(() => {
    void apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" }).then((response) => setSession(response.data)).catch(() => null);
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, []);

  const handleFileChange = async (selectedFile: File | null) => {
    setFile(selectedFile);
    setPreview(null);
    setResult(null);
    setError(null);

    if (!selectedFile) {
      setHeaders([]);
      setSampleRows([]);
      setIdColumn("");
      setValueColumn("");
      return;
    }

    try {
      const binary = await selectedFile.arrayBuffer();
      const zipHeader = new Uint8Array(binary.slice(0, 4));
      if (zipHeader[0] !== 0x50 || zipHeader[1] !== 0x4b) {
        throw new Error("El archivo debe ser un .xlsx válido");
      }
      const workbook = await import("xlsx");
      const parsed = workbook.read(binary, { type: "array" });
      const sheet = parsed.Sheets[parsed.SheetNames[0]];
      const rows = workbook.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
      const rowHeaders = Object.keys(rows[0] ?? {});
      setHeaders(rowHeaders);
      setSampleRows(rows.slice(0, 5));
      setIdColumn(rowHeaders[0] ?? "");
      setValueColumn(rowHeaders[1] ?? rowHeaders[0] ?? "");
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo leer el archivo";
      setError(message);
      showToast(message, "error");
    }
  };

  const handleFileSelect = (selectedFile: File | null) => {
    void handleFileChange(selectedFile);
  };

  const buildFormData = () => {
    if (!activeTenant) {
      throw new Error("Selecciona un cliente");
    }
    if (!file) {
      throw new Error("Selecciona un archivo .xlsx");
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("id_column", idColumn);
    formData.append("value_column", valueColumn);
    formData.append("id_type", identifierType);
    formData.append("wc_field", wcField);
    return { tenantPath: withTenantPath(activeTenant.id, "/products"), formData };
  };

  const handlePreview = async () => {
    setLoadingPreview(true);
    setError(null);
    setResult(null);
    try {
      const { tenantPath, formData } = buildFormData();
      const response = await apiRequest<PreviewResponse>(`${tenantPath}/preview`, { method: "POST", body: formData });
      setPreview(response.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo generar la vista previa";
      setError(message);
      showToast(message, "error");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleApply = async () => {
    setLoadingApply(true);
    setError(null);
    setResult(null);
    setProgress(8);
    intervalRef.current = window.setInterval(() => setProgress((current) => (current >= 90 ? current : current + 7)), 400);

    try {
      const { tenantPath, formData } = buildFormData();
      const response = await apiRequest<UpdateResponse>(`${tenantPath}/update`, { method: "POST", body: formData });
      setProgress(100);
      setResult(response.data);
      showToast("Actualización finalizada");
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudieron aplicar los cambios";
      setError(message);
      showToast(message, "error");
    } finally {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      setTimeout(() => setProgress(0), 1000);
      setLoadingApply(false);
    }
  };

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="rounded-3xl border border-border/80 bg-card/85 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-8">
        <div className="max-w-3xl">
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Importar Excel</div>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Mapeo y actualización masiva</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            {activeTenant ? `Carga un Excel para actualizar productos de ${activeTenant.name}.` : "Selecciona un cliente activo para importar y actualizar productos."}
          </p>
        </div>
      </section>

      <Card className="rounded-3xl border-border/80 shadow-sm">
        <CardHeader className="px-5 pt-6 sm:px-6">
          <CardTitle>Archivo y configuración</CardTitle>
          <CardDescription>Sube el Excel, selecciona las columnas y revisa la vista previa antes de aplicar cambios.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-5 pb-6 sm:px-6">
          <input
            ref={fileInputRef}
            accept=".xlsx"
            className="hidden"
            onChange={(event) => handleFileSelect(event.target.files?.[0] ?? null)}
            type="file"
          />

          <button
            type="button"
            className={[
              "flex w-full flex-col items-center justify-center rounded-3xl border border-dashed px-6 py-10 text-center transition-colors sm:px-8 sm:py-14",
              isDragging ? "border-primary bg-primary/5" : "border-border bg-background/60 hover:border-primary/60 hover:bg-accent/30"
            ].join(" ")}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                return;
              }
              setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              handleFileSelect(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <UploadCloud className="h-8 w-8 text-muted-foreground sm:h-10 sm:w-10" />
            <div className="mt-4 text-base font-medium sm:text-lg">{file ? file.name : "Arrastra tu archivo Excel aquí"}</div>
            <div className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {file ? "Haz click para reemplazarlo por otro archivo .xlsx" : "También puedes hacer click para seleccionar un archivo .xlsx desde tu equipo."}
            </div>
          </button>

          {previewColumns.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Columna identificador</label>
                <Select value={idColumn} onValueChange={setIdColumn}>
                  <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Selecciona columna" /></SelectTrigger>
                  <SelectContent>{previewColumns.map((column) => <SelectItem key={column} value={column}>{column}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Columna a editar</label>
                <Select value={valueColumn} onValueChange={setValueColumn}>
                  <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Selecciona columna" /></SelectTrigger>
                  <SelectContent>{previewColumns.map((column) => <SelectItem key={column} value={column}>{column}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tipo de identificador</label>
                <Select value={identifierType} onValueChange={(value) => setIdentifierType(value as "sku" | "product_id")}>
                  <SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sku">SKU</SelectItem>
                    <SelectItem value="product_id">ID del producto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Campo WooCommerce</label>
                <Select value={wcField} onValueChange={setWcField}>
                  <SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{wcFields.map((field) => <SelectItem key={field} value={field}>{field}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="h-12 rounded-xl px-6 font-semibold" disabled={!activeTenant || !file || !idColumn || !valueColumn || loadingPreview} onClick={handlePreview}>
              {loadingPreview ? "Generando vista previa..." : "Ver vista previa"}
            </Button>
            <Button className="h-12 rounded-xl px-6 font-semibold" disabled={!activeTenant || !file || !preview || loadingApply} onClick={handleApply} variant="secondary">
              {loadingApply ? "Aplicando cambios..." : "Aplicar cambios"}
            </Button>
          </div>

          {loadingApply || progress > 0 ? <Progress value={progress} /> : null}
          {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error}</div> : null}
        </CardContent>
      </Card>

      {sampleRows.length > 0 ? (
        <Card className="rounded-3xl border-border/80 shadow-sm">
          <CardHeader className="px-5 pt-6 sm:px-6"><CardTitle>Primeras 5 filas</CardTitle></CardHeader>
          <CardContent className="px-5 pb-6 sm:px-6">
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-accent/70">{headers.map((header) => <th key={header} className="px-3 py-3 text-left font-medium">{header}</th>)}</tr>
                </thead>
                <tbody>{sampleRows.map((row, index) => <tr key={index} className="border-b border-border/60 last:border-b-0">{headers.map((header) => <td key={header} className="px-3 py-3">{row[header]}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {preview ? (
        <Card className="rounded-3xl border-border/80 shadow-sm">
          <CardHeader className="px-5 pt-6 sm:px-6"><CardTitle>Vista previa de cambios</CardTitle><CardDescription>{preview.total_rows} filas analizadas.</CardDescription></CardHeader>
          <CardContent className="px-5 pb-6 sm:px-6">
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-accent/70">
                    <th className="px-3 py-3 text-left font-medium">Identificador</th>
                    <th className="px-3 py-3 text-left font-medium">Valor actual</th>
                    <th className="px-3 py-3 text-left font-medium">Valor nuevo</th>
                    <th className="px-3 py-3 text-left font-medium">Producto</th>
                  </tr>
                </thead>
                <tbody>{preview.preview_rows.map((row) => <tr key={`${row.identifier}-${row.product_id ?? "missing"}`} className="border-b border-border/60 last:border-b-0"><td className="px-3 py-3">{row.identifier}</td><td className="px-3 py-3">{row.current_value ?? "No encontrado"}</td><td className="px-3 py-3">{row.new_value}</td><td className="px-3 py-3">{row.product_name ?? "Sin coincidencia"}</td></tr>)}</tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card className="rounded-3xl border-border/80 shadow-sm">
          <CardHeader className="px-5 pt-6 sm:px-6"><CardTitle>Resultado</CardTitle><CardDescription>{result.updated} actualizados, {result.failed} fallidos.</CardDescription></CardHeader>
          <CardContent className="px-5 pb-6 sm:px-6">
            {result.errors.length > 0 ? <div className="space-y-2 rounded-2xl border border-border bg-background/70 p-4 text-sm">{result.errors.map((item, index) => <div key={`${item.identifier}-${index}`}><span className="font-medium">{item.identifier}</span>: {item.error}</div>)}</div> : <div className="text-sm text-muted-foreground">No hubo errores en la ejecución.</div>}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
