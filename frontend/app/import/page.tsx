"use client";

import { Download, FileSpreadsheet, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiRequest, FRONTEND_API_PREFIX, resolveActiveTenant, type AuthSession, uploadFileWithProgress, withTenantPath } from "@/lib/api";

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

type ImportDraft = {
  id: string;
  tenant_id: string;
  original_filename: string;
  headers: string[];
  sample_rows: Array<Record<string, string>>;
  row_count: number;
  created_at: string;
  updated_at: string;
};

const wcFields = [
  "name",
  "slug",
  "sku",
  "type",
  "status",
  "featured",
  "catalog_visibility",
  "regular_price",
  "sale_price",
  "date_on_sale_from",
  "date_on_sale_to",
  "description",
  "short_description",
  "manage_stock",
  "stock_quantity",
  "stock_status",
  "backorders",
  "sold_individually",
  "low_stock_amount",
  "weight",
  "shipping_class",
  "virtual",
  "downloadable",
  "download_limit",
  "download_expiry"
];

const fieldLabels: Record<string, string> = {
  product_id: "ID del producto",
  sku: "SKU",
  name: "Nombre",
  slug: "Slug",
  type: "Tipo",
  status: "Estado",
  featured: "Destacado",
  catalog_visibility: "Visibilidad catalogo",
  regular_price: "Precio regular",
  sale_price: "Precio oferta",
  date_on_sale_from: "Oferta desde",
  date_on_sale_to: "Oferta hasta",
  description: "Descripcion completa",
  short_description: "Descripcion corta",
  manage_stock: "Gestionar stock",
  stock_quantity: "Cantidad stock",
  stock_status: "Estado stock",
  backorders: "Backorders",
  sold_individually: "Venta individual",
  low_stock_amount: "Alerta stock bajo",
  weight: "Peso",
  length: "Largo",
  width: "Ancho",
  height: "Alto",
  shipping_class: "Clase de envio",
  virtual: "Virtual",
  downloadable: "Descargable",
  image_principal_id: "ID imagen principal",
  image_galeria_ids: "IDs galeria",
  image_nombres: "Nombres imagenes",
  attr1_nombre: "Atributo 1 nombre",
  attr1_valores: "Atributo 1 valores",
  attr2_nombre: "Atributo 2 nombre",
  attr2_valores: "Atributo 2 valores",
  category_ids: "IDs categorias",
  tag_ids: "IDs etiquetas",
  upsell_ids: "IDs upsells",
  cross_sell_ids: "IDs cross-sells",
  meta_key: "Meta key",
  meta_value: "Meta value"
};

async function downloadFile(path: string, fallbackFilename: string) {
  const response = await fetch(`${FRONTEND_API_PREFIX}${path}`, {
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error("No se pudo descargar el archivo");
  }
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

export default function ImportPage() {
  const { showToast } = useToast();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [idColumn, setIdColumn] = useState("");
  const [valueColumn, setValueColumn] = useState("");
  const [identifierType, setIdentifierType] = useState<"sku" | "product_id">("sku");
  const [wcField, setWcField] = useState("regular_price");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<UpdateResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingApply, setLoadingApply] = useState(false);
  const [uploadingDraft, setUploadingDraft] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const previewColumns = useMemo(() => draft?.headers.filter(Boolean) ?? [], [draft]);
  const sampleRows = draft?.sample_rows ?? [];
  const headers = draft?.headers ?? [];
  const activeTenant = session ? resolveActiveTenant(session) : null;

  const loadCurrentDraft = async (tenantId: string) => {
    try {
      const response = await apiRequest<ImportDraft | null>(withTenantPath(tenantId, "/imports/current"), { cache: "no-store" });
      const currentDraft = response.data;
      setDraft(currentDraft);
      setPreview(null);
      setResult(null);
      if (currentDraft) {
        const nextHeaders = currentDraft.headers.filter(Boolean);
        setIdColumn((current) => current || (nextHeaders.includes("sku") ? "sku" : nextHeaders[0] ?? ""));
        setValueColumn((current) => current || (nextHeaders.includes("regular_price") ? "regular_price" : nextHeaders[1] ?? nextHeaders[0] ?? ""));
      } else {
        setIdColumn("");
        setValueColumn("");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo cargar el Excel guardado";
      setError(message);
    }
  };

  useEffect(() => {
    void apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        setSession(response.data);
        const tenant = resolveActiveTenant(response.data);
        if (tenant) {
          await loadCurrentDraft(tenant.id);
        }
      })
      .catch(() => null);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeTenant) {
      void loadCurrentDraft(activeTenant.id);
    }
  }, [activeTenant?.id]);

  const handleDraftUpload = async (selectedFile: File | null) => {
    setError(null);
    setPreview(null);
    setResult(null);
    if (!selectedFile || !activeTenant) {
      return;
    }

    setUploadingDraft(true);
    setUploadProgress(0);
    try {
      const response = await uploadFileWithProgress<ImportDraft>(withTenantPath(activeTenant.id, "/imports"), selectedFile, setUploadProgress);
      setDraft(response.data);
      const nextHeaders = response.data.headers.filter(Boolean);
      setIdColumn(nextHeaders.includes("sku") ? "sku" : nextHeaders[0] ?? "");
      setValueColumn(nextHeaders.includes("regular_price") ? "regular_price" : nextHeaders[1] ?? nextHeaders[0] ?? "");
      showToast("Excel guardado en la sesión actual");
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo guardar el Excel";
      setError(message);
      showToast(message, "error");
    } finally {
      setUploadingDraft(false);
      setTimeout(() => setUploadProgress(0), 800);
    }
  };

  const handleFileSelect = (selectedFile: File | null) => {
    void handleDraftUpload(selectedFile);
  };

  const buildFormData = () => {
    if (!activeTenant) {
      throw new Error("Selecciona un cliente");
    }
    if (!draft) {
      throw new Error("Primero guarda un archivo Excel en la sesión");
    }
    const formData = new FormData();
    formData.append("id_column", idColumn);
    formData.append("value_column", valueColumn);
    formData.append("id_type", identifierType);
    formData.append("wc_field", wcField);
    return { tenantPath: withTenantPath(activeTenant.id, "/imports"), formData };
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
      const response = await apiRequest<UpdateResponse>(`${tenantPath}/apply`, { method: "POST", body: formData });
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

  const handleDeleteDraft = async () => {
    if (!activeTenant || !draft) {
      return;
    }
    try {
      await apiRequest(withTenantPath(activeTenant.id, `/imports/${draft.id}`), { method: "DELETE" });
      setDraft(null);
      setPreview(null);
      setResult(null);
      setIdColumn("");
      setValueColumn("");
      showToast("Excel guardado eliminado");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo eliminar el Excel guardado", "error");
    }
  };

  const handleDownloadTemplate = async () => {
    if (!activeTenant) {
      return;
    }
    try {
      await downloadFile(withTenantPath(activeTenant.id, "/imports/template"), "formato_importacion_productos.xlsx");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo descargar la plantilla", "error");
    }
  };

  const handleDownloadCurrentDraft = async () => {
    if (!activeTenant || !draft) {
      return;
    }
    try {
      await downloadFile(withTenantPath(activeTenant.id, "/imports/current/download"), draft.original_filename);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo descargar el Excel guardado", "error");
    }
  };

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="rounded-3xl border border-border/80 bg-card/85 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-8">
        <div className="max-w-4xl">
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Importar Excel</div>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Mapeo y actualización masiva</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            {activeTenant ? `Carga un Excel para actualizar productos de ${activeTenant.name}. El archivo queda guardado en la sesión actual del cliente para continuar luego sin perder el contexto.` : "Selecciona un cliente activo para importar y actualizar productos."}
          </p>
        </div>
      </section>

      <Card className="rounded-3xl border-border/80 shadow-sm">
        <CardHeader className="px-5 pt-6 sm:px-6">
          <CardTitle>Formato esperado</CardTitle>
          <CardDescription>Descarga una plantilla base con columnas sugeridas y una hoja de instrucciones para armar el Excel correctamente.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-5 pb-6 sm:flex-row sm:px-6">
          <Button className="rounded-xl" disabled={!activeTenant} onClick={() => void handleDownloadTemplate()} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Descargar plantilla Excel
          </Button>
          <div className="text-sm text-muted-foreground">La hoja incluye encabezados esperados, una fila ejemplo y notas de formato.</div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-border/80 shadow-sm">
        <CardHeader className="px-5 pt-6 sm:px-6">
          <CardTitle>Archivo y configuración</CardTitle>
          <CardDescription>Guarda el Excel en la sesión, selecciona las columnas y revisa la vista previa antes de aplicar cambios.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-5 pb-6 sm:px-6">
          <input ref={fileInputRef} accept=".xlsx" className="hidden" onChange={(event) => handleFileSelect(event.target.files?.[0] ?? null)} type="file" />

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
            <div className="mt-4 text-base font-medium sm:text-lg">{draft ? draft.original_filename : "Arrastra tu archivo Excel aquí"}</div>
            <div className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {draft ? "Haz click para reemplazar el Excel guardado en la sesión actual." : "También puedes hacer click para seleccionar un archivo .xlsx desde tu equipo."}
            </div>
          </button>

          {uploadingDraft || uploadProgress > 0 ? (
            <div className="space-y-2 rounded-2xl border border-border bg-background/70 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Guardando Excel en sesión...</span>
                <span className="font-medium">{uploadProgress}%</span>
              </div>
              <Progress className="h-3" value={uploadProgress} />
            </div>
          ) : null}

          {draft ? (
            <div className="rounded-2xl border border-border bg-background/70 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <FileSpreadsheet className="mt-0.5 h-5 w-5 text-muted-foreground" />
                  <div className="text-sm">
                    <div className="font-medium text-foreground">{draft.original_filename}</div>
                    <div className="text-muted-foreground">{draft.row_count} filas detectadas · actualizado {new Date(draft.updated_at).toLocaleString()}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button className="rounded-xl" onClick={() => void handleDownloadCurrentDraft()} size="sm" variant="outline">
                    <Download className="mr-2 h-4 w-4" />
                    Descargar guardado
                  </Button>
                  <Button className="rounded-xl" onClick={() => void handleDeleteDraft()} size="sm" variant="outline">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Limpiar sesión
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {previewColumns.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Columna identificador</label>
                <Select value={idColumn} onValueChange={setIdColumn}>
                  <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Selecciona columna" /></SelectTrigger>
                  <SelectContent>{previewColumns.map((column) => <SelectItem key={column} value={column}>{fieldLabels[column] ?? column}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Columna a editar</label>
                <Select value={valueColumn} onValueChange={setValueColumn}>
                  <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Selecciona columna" /></SelectTrigger>
                  <SelectContent>{previewColumns.map((column) => <SelectItem key={column} value={column}>{fieldLabels[column] ?? column}</SelectItem>)}</SelectContent>
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
                  <SelectContent>{wcFields.map((field) => <SelectItem key={field} value={field}>{fieldLabels[field] ?? field}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="h-12 rounded-xl px-6 font-semibold" disabled={!activeTenant || !draft || !idColumn || !valueColumn || loadingPreview} onClick={handlePreview}>
              {loadingPreview ? "Generando vista previa..." : "Ver vista previa"}
            </Button>
            <Button className="h-12 rounded-xl px-6 font-semibold" disabled={!activeTenant || !draft || !preview || loadingApply} onClick={handleApply} variant="secondary">
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
                  <tr className="border-b border-border bg-accent/70">{headers.map((header) => <th key={header} className="px-3 py-3 text-left font-medium">{fieldLabels[header] ?? header}</th>)}</tr>
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
