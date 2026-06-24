"use client";

import { AlertCircle, Check, CheckCircle2, Circle, Copy, Download, ExternalLink, FileSpreadsheet, LoaderCircle, RefreshCw, Trash2, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { useProcesses } from "@/contexts/ProcessesContext";
import { apiRequest, FRONTEND_API_PREFIX, resolveActiveTenant, type AuthSession, uploadFileWithProgress, withTenantPath } from "@/lib/api";

type SkuCandidate = { id: number | null; name: string | null; sku: string | null };

type PreviewResponse = {
  headers: string[];
  preview_rows: Array<{
    row_index: number;
    identifier: string;
    product_found: boolean;
    product_id: number | null;
    product_name: string | null;
    changed_fields: string[];
    changes: Array<{ field: string; before: string; after: string }>;
    row_data: Record<string, string>;
    ambiguous: boolean;
    sku_candidates: SkuCandidate[];
  }>;
  sample_rows: Array<Record<string, string>>;
  total_rows: number;
};

type UpdateResponse = {
  updated: number;
  failed: number;
  errors: Array<{ identifier: string; error: string }>;
  total_rows: number;
  images_job?: { job_id: string } | null;
};

type ImageRowDetail = {
  requested_principal_id: number | null;
  requested_gallery_ids: number[];
  requested_names: string[];
  resolved_image_ids: number[];
  resolved_image_names: string[];
  unresolved_names: string[];
  applied_image_ids: number[];
};

type ApplyResultRow = {
  row_index: number;
  identifier: string;
  product_name: string | null;
  status: "ok" | "failed" | "skipped";
  error: string | null;
  image_detail?: ImageRowDetail;
};

type ImportImagesJobStatus = {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  stage: "pending" | "preparing" | "updating" | "completed" | "failed";
  progress: number;
  prepared: number;
  processed: number;
  total: number;
  current_identifier: string | null;
  current_product_name: string | null;
  rows: Array<{
    row_index: number;
    identifier: string;
    product_id: number | null;
    product_name: string | null;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    error: string | null;
    requested_principal_id: number | null;
    requested_gallery_ids: number[];
    requested_names: string[];
    resolved_image_ids: number[];
    resolved_image_names: string[];
    unresolved_names: string[];
    applied_image_ids: number[];
  }>;
  result: {
    updated: number;
    skipped: number;
    failed: number;
    errors: Array<{ identifier: string; error: string }>;
    total_rows: number;
  } | null;
  error: string | null;
};

type ImportDraft = {
  id: string;
  tenant_id: string;
  original_filename: string;
  headers: string[];
  sample_rows: Array<Record<string, string>>;
  source_headers: string[];
  row_count: number;
  created_at: string;
  updated_at: string;
  format_analysis: {
    status: "ready" | "typos" | "refactor_required";
    source_headers: string[];
    normalized_headers: string[];
    typo_suggestions: Array<{ provided: string; expected: string; confidence: number }>;
    missing_required: string[];
    unknown_headers: string[];
    expected_fields: Array<{ key: string; label: string; required: boolean }>;
  };
};

const editableFields = [
  "name",
  "slug",
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
  "length",
  "width",
  "height",
  "shipping_class",
  "virtual",
  "downloadable",
  "images",
  "attr1_nombre",
  "attr1_valores",
  "attr2_nombre",
  "attr2_valores",
  "category_ids",
  "tag_ids",
  "upsell_ids",
  "cross_sell_ids",
  "meta_key",
  "meta_value"
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
  images: "Imágenes",
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

const fieldGroups: Record<string, string[]> = {
  images: ["image_principal_id", "image_galeria_ids", "image_nombres"]
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
  const { addProcess, finishProcess } = useProcesses();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
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
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [selectedPreviewRowIndexes, setSelectedPreviewRowIndexes] = useState<number[]>([]);
  const [productIdOverrides, setProductIdOverrides] = useState<Record<number, number>>({});
  const [selectedPreviewRow, setSelectedPreviewRow] = useState<PreviewResponse["preview_rows"][number] | null>(null);
  const [applyStatusMessage, setApplyStatusMessage] = useState<string | null>(null);
  const [applyStatusDetail, setApplyStatusDetail] = useState<string | null>(null);
  const [applyStatusError, setApplyStatusError] = useState<string | null>(null);
  const [showApplyStatusModal, setShowApplyStatusModal] = useState(false);
  const [imagesJobStatus, setImagesJobStatus] = useState<ImportImagesJobStatus | null>(null);
  const [applyRows, setApplyRows] = useState<ApplyResultRow[]>([]);

  const previewColumns = useMemo(() => draft?.headers.filter(Boolean) ?? [], [draft]);
  const sampleRows = draft?.sample_rows ?? [];
  const headers = draft?.headers ?? [];
  const formatAnalysis = draft?.format_analysis ?? null;
  const activeTenant = session ? resolveActiveTenant(session) : null;
  const availableEditableFields = useMemo(
    () => editableFields.filter((field) => (fieldGroups[field] ?? [field]).every((column) => previewColumns.includes(column))),
    [previewColumns]
  );
  const selectedFieldLabels = useMemo(() => selectedFields.map((field) => fieldLabels[field] ?? field), [selectedFields]);
  const selectedFieldsSummary = useMemo(() => {
    if (selectedFields.length === 0) {
      return "";
    }
    return selectedFields.map((field) => fieldLabels[field] ?? field).join(", ");
  }, [selectedFields]);
  const claudePrompt = useMemo(() => {
    if (!formatAnalysis) {
      return "";
    }

    const suggestions = formatAnalysis.typo_suggestions.map((item) => `- Corrige "${item.provided}" por "${item.expected}"`).join("\n");
    const required = formatAnalysis.missing_required.map((item) => `- ${item}`).join("\n");
    const unknown = formatAnalysis.unknown_headers.map((item) => `- ${item}`).join("\n");

    return [
      "Necesito que conviertas un Excel de productos al formato exacto que usa mi sistema interno para importar productos WooCommerce.",
      "",
      "Contexto:",
      "- Mi sistema administra productos WooCommerce.",
      "- El objetivo es tomar un Excel de origen del usuario y devolver un nuevo Excel compatible con el formato oficial de importación.",
      "- Te voy a adjuntar 2 archivos:",
      "  1. El Excel del usuario que hay que transformar.",
      "  2. El Excel plantilla/formato oficial que debes usar como referencia de estructura, columnas y estilo.",
      "",
      "Tu tarea:",
      "- Analiza el Excel del usuario.",
      "- Analiza la plantilla oficial.",
      "- Devuélveme un nuevo Excel siguiendo el formato oficial.",
      "- Debes mapear las columnas del Excel del usuario hacia las columnas de la plantilla.",
      "- Si un encabezado está mal escrito pero claramente corresponde a una columna del formato oficial, corrígelo.",
      "- Si faltan columnas obligatorias, créalas y déjalas vacías.",
      "- Si hay columnas extra que no sirven para el formato oficial, puedes ignorarlas.",
      "- Conserva toda la información útil del archivo del usuario.",
      "- No me devuelvas una explicación: devuélveme el archivo resultante listo para importar.",
      "",
      "Reglas importantes:",
      "- Usa como salida el formato de la plantilla oficial, no inventes otra estructura.",
      "- Mantén los nombres de columnas exactamente como aparecen en la plantilla.",
      "- Si una descripción viene en HTML, conviértela a texto legible en el Excel de salida.",
      "- Si hay listas múltiples, usa el separador que define la plantilla.",
      "- Si no puedes inferir un valor, déjalo vacío en vez de inventarlo.",
      "",
      "Columnas esperadas y significado:",
      "- ID del producto: ID numérico del producto en WooCommerce.",
      "- SKU: código único del producto.",
      "- Nombre: nombre comercial del producto.",
      "- Slug: identificador SEO.",
      "- Tipo: simple, variable, grouped o external.",
      "- Estado: publish, draft, pending o private.",
      "- Destacado: true o false.",
      "- Visibilidad catalogo: visible, catalog, search o hidden.",
      "- Precio regular: precio base.",
      "- Precio oferta: precio rebajado.",
      "- Oferta desde: fecha inicio de oferta en ISO 8601.",
      "- Oferta hasta: fecha fin de oferta en ISO 8601.",
      "- Descripcion completa: texto largo del producto.",
      "- Descripcion corta: resumen corto del producto.",
      "- Gestionar stock: true o false.",
      "- Cantidad stock: cantidad disponible.",
      "- Estado stock: instock, outofstock u onbackorder.",
      "- Backorders: no, notify o yes.",
      "- Venta individual: true o false.",
      "- Alerta stock bajo: umbral de alerta.",
      "- Peso: peso del producto.",
      "- Largo, Ancho, Alto: dimensiones.",
      "- Clase de envio: slug de clase de envío.",
      "- Virtual: true o false.",
      "- Descargable: true o false.",
      "- Imágenes: grupo que representa la imagen principal, la galería y los nombres de referencia.",
      "- Atributo 1 nombre / valores: primer atributo y sus valores.",
      "- Atributo 2 nombre / valores: segundo atributo y sus valores.",
      "- IDs categorias: IDs de categorías separadas según plantilla.",
      "- IDs etiquetas: IDs de etiquetas separadas según plantilla.",
      "- IDs upsells: productos recomendados en producto.",
      "- IDs cross-sells: productos recomendados en carrito.",
      "- Meta key / Meta value: campos personalizados.",
      "",
      suggestions ? `Sugerencias detectadas por mi sistema:\n${suggestions}` : "",
      required ? `Columnas obligatorias faltantes detectadas:\n${required}` : "",
      unknown ? `Columnas no reconocidas detectadas:\n${unknown}` : "",
      "",
      "Salida esperada:",
      "- Un archivo Excel nuevo.",
      "- Debe conservar la estructura de la plantilla oficial.",
      "- Debe quedar listo para importar directamente en mi sistema.",
    ].filter(Boolean).join("\n");
  }, [formatAnalysis]);

  const loadCurrentDraft = async (tenantId: string) => {
    try {
      const response = await apiRequest<ImportDraft | null>(withTenantPath(tenantId, "/imports/current"), { cache: "no-store" });
      const currentDraft = response.data;
      setDraft(currentDraft);
      setPreview(null); setProductIdOverrides({});
      setResult(null);
      setSelectedFields([]);
      setSelectedPreviewRowIndexes([]);
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

  // Auto-scroll to the active row when it changes
  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [imagesJobStatus?.rows?.find?.((r) => r.status === "running")?.row_index]);

  const handleDraftUpload = async (selectedFile: File | null) => {
    setError(null);
    setPreview(null); setProductIdOverrides({});
    setResult(null);
    if (!selectedFile || !activeTenant) {
      return;
    }

    setUploadingDraft(true);
    setUploadProgress(0);
    try {
      const response = await uploadFileWithProgress<ImportDraft>(withTenantPath(activeTenant.id, "/imports"), selectedFile, setUploadProgress);
      setDraft(response.data);
      setSelectedFields([]);
      setSelectedPreviewRowIndexes([]);
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
    if (selectedFields.length === 0) {
      throw new Error("Selecciona al menos una columna para editar");
    }
    const formData = new FormData();
    formData.append("selected_fields", JSON.stringify(selectedFields));
    formData.append("selected_row_indexes", JSON.stringify(selectedPreviewRowIndexes));
    if (Object.keys(productIdOverrides).length > 0) {
      formData.append("product_id_overrides", JSON.stringify(productIdOverrides));
    }
    return { tenantPath: withTenantPath(activeTenant.id, "/imports"), formData };
  };

  const handlePreview = async () => {
    setLoadingPreview(true);
    setError(null);
    setResult(null);
    setProductIdOverrides({});
    try {
      const { tenantPath, formData } = buildFormData();
      const response = await apiRequest<PreviewResponse>(`${tenantPath}/preview`, { method: "POST", body: formData });
      setPreview(response.data);
      setSelectedPreviewRowIndexes(response.data.preview_rows.filter((row) => row.product_found && !row.ambiguous).map((row) => row.row_index));
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo generar la vista previa";
      setError(message);
      showToast(message, "error");
    } finally {
      setLoadingPreview(false);
    }
  };

  const buildApplyRows = (
    res: UpdateResponse,
    currentPreview: PreviewResponse,
    appliedIndexes: number[],
    imageRows?: ImportImagesJobStatus["rows"],
  ): ApplyResultRow[] => {
    const errorMap = new Map<string, string>();
    for (const e of res.errors) errorMap.set(e.identifier, e.error);

    // image job rows override status for image fields
    const imgRowMap = new Map<number, ImportImagesJobStatus["rows"][number]>();
    for (const r of imageRows ?? []) imgRowMap.set(r.row_index, r);

    return appliedIndexes.map((ri) => {
      const previewRow = currentPreview.preview_rows.find((r) => r.row_index === ri);
      const identifier = previewRow?.identifier ?? String(ri);
      const product_name = previewRow?.product_name ?? null;
      const imgRow = imgRowMap.get(ri);

      if (imgRow) {
        return {
          row_index: ri,
          identifier,
          product_name,
          status: imgRow.status === "completed" ? "ok" : imgRow.status === "skipped" ? "skipped" : "failed",
          error: imgRow.error,
          image_detail: {
            requested_principal_id: imgRow.requested_principal_id ?? null,
            requested_gallery_ids: imgRow.requested_gallery_ids ?? [],
            requested_names: imgRow.requested_names ?? [],
            resolved_image_ids: imgRow.resolved_image_ids ?? [],
            resolved_image_names: imgRow.resolved_image_names ?? [],
            unresolved_names: imgRow.unresolved_names ?? [],
            applied_image_ids: imgRow.applied_image_ids ?? [],
          },
        };
      }

      const error = errorMap.get(identifier) ?? null;
      return {
        row_index: ri,
        identifier,
        product_name,
        status: error ? "failed" : "ok",
        error,
      };
    });
  };

  const handleRetryRows = (rowIndexes: number[]) => {
    setSelectedPreviewRowIndexes(rowIndexes);
    setResult(null);
    setApplyRows([]);
    setError(null);
    // scroll to apply button area
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleApply = async () => {
    let hasError = false;
    let hasImagesJob = false;
    // Snapshot at start — don't let user interaction change these mid-flight
    const appliedIndexes = [...selectedPreviewRowIndexes];
    const appliedPreview = preview;
    setLoadingApply(true);
    setError(null);
    setResult(null);
    setApplyRows([]);
    setApplyStatusError(null);
    setImagesJobStatus(null);
    setShowApplyStatusModal(true);
    setProgress(8);
    setApplyStatusMessage(selectedFields.includes("images") ? "Editando imágenes desde el Excel..." : "Aplicando cambios del Excel...");
    setApplyStatusDetail(
      selectedFields.includes("images")
        ? `Resolviendo imágenes y preparando ${selectedPreviewRowIndexes.length} producto(s) para actualización masiva.`
        : `Preparando ${selectedPreviewRowIndexes.length} producto(s) con estas columnas: ${selectedFieldsSummary}`
    );
    intervalRef.current = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 90) {
          return current;
        }
        if (current >= 55) {
          setApplyStatusMessage(selectedFields.includes("images") ? "Buscando coincidencias de imágenes en la media library..." : "Enviando cambios al backend...");
          setApplyStatusDetail(
            selectedFields.includes("images")
              ? "Se están resolviendo nombres, galería e imagen principal antes de guardar."
              : `Se aplicarán ${selectedFieldsSummary} sobre ${selectedPreviewRowIndexes.length} fila(s) seleccionada(s).`
          );
        }
        if (current >= 78) {
          setApplyStatusMessage("Finalizando importación...");
          setApplyStatusDetail("Esperando respuesta final del servidor y consolidando el resultado.");
        }
        return current + 7;
      });
    }, 400);

    try {
      const { tenantPath, formData } = buildFormData();
      const response = await apiRequest<UpdateResponse>(`${tenantPath}/apply`, {
        method: "POST",
        body: formData,
        retryAttempts: 1,
      });
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }

      if (response.data.images_job?.job_id) {
        hasImagesJob = true;
        const imgJobId = response.data.images_job.job_id;
        addProcess({
          type: "image_import",
          label: "Importar imágenes masivo",
          pollUrl: `${tenantPath}/apply-jobs/${imgJobId}`,
        });
        setResult({
          updated: response.data.updated,
          failed: response.data.failed,
          errors: response.data.errors,
          total_rows: response.data.total_rows,
        });
        setProgress(5);
        setApplyStatusMessage("Cambios generales listos. Procesando imágenes...");
        setApplyStatusDetail("Las demás columnas ya fueron aplicadas. Ahora se actualizarán las imágenes producto por producto.");

        const pollJob = async () => {
          try {
            const jobResponse = await apiRequest<ImportImagesJobStatus>(
              `${tenantPath}/apply-jobs/${response.data.images_job!.job_id}`,
              { cache: "no-store", retryAttempts: 1 }
            );
            const job = jobResponse.data;
            setImagesJobStatus(job);
            setProgress(job.progress);
            setApplyStatusMessage(
              job.status === "failed"
                ? "La actualización de imágenes falló"
                : job.status === "completed"
                  ? "Actualización de imágenes completada"
                  : job.stage === "preparing"
                    ? "Preparando imágenes por producto..."
                    : "Actualizando imágenes producto por producto..."
            );
            setApplyStatusDetail(
              job.status === "running" || job.status === "pending"
                ? job.stage === "preparing"
                  ? `Resolviendo imágenes: ${job.prepared} de ${job.total} filas listas.${job.current_product_name ? ` Actual: ${job.current_product_name}.` : ""}`
                  : `${job.processed} de ${job.total} productos actualizados.${job.current_product_name ? ` Actual: ${job.current_product_name}.` : ""}`
                : job.status === "completed"
                  ? `Imágenes terminadas para ${job.result?.updated ?? 0} producto(s).`
                  : (job.error ?? "Falló el procesamiento de imágenes.")
            );

            if (job.status === "completed") {
              const mergedResult: UpdateResponse = {
                updated: response.data.updated + (job.result?.updated ?? 0),
                failed: response.data.failed + (job.result?.failed ?? 0),
                errors: [...response.data.errors, ...(job.result?.errors ?? [])],
                total_rows: Math.max(response.data.total_rows, job.result?.total_rows ?? 0),
              };
              setResult(mergedResult);
              if (appliedPreview) {
                setApplyRows(buildApplyRows(mergedResult, appliedPreview, appliedIndexes, job.rows));
              }
              setLoadingApply(false);
              const hasFailed = mergedResult.failed > 0;
              setTimeout(() => {
                setShowApplyStatusModal(false);
                setProgress(0);
              }, 1200);
              showToast(
                hasFailed ? `${mergedResult.updated} actualizados, ${mergedResult.failed} fallidos` : "Actualización finalizada",
                hasFailed ? "error" : undefined
              );
              return true;
            }

            if (job.status === "failed") {
              hasError = true;
              const message = job.error ?? "Falló el procesamiento de imágenes";
              setError(message);
              setApplyStatusError(message);
              setLoadingApply(false);
              showToast(message, "error");
              return true;
            }
          } catch (pollError) {
            hasError = true;
            const message = pollError instanceof Error ? pollError.message : "No se pudo consultar el progreso de imágenes";
            setError(message);
            setApplyStatusError(message);
            setLoadingApply(false);
            showToast(message, "error");
            return true;
          }
          return false;
        };

        const finished = await pollJob();
        if (!finished) {
          intervalRef.current = window.setInterval(() => {
            void pollJob().then((done) => {
              if (done && intervalRef.current) {
                window.clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            });
          }, 1500);
        }
      } else {
        setProgress(100);
        setResult(response.data);
        if (appliedPreview) {
          setApplyRows(buildApplyRows(response.data, appliedPreview, appliedIndexes));
        }
        const hasFailed = response.data.failed > 0;
        const hasUpdated = response.data.updated > 0;
        setApplyStatusMessage(
          hasFailed && !hasUpdated ? "Ningún producto fue actualizado" :
          hasFailed ? "Importación finalizada con errores" : "Importación finalizada"
        );
        setApplyStatusDetail(`Se actualizaron ${response.data.updated} producto(s).${hasFailed ? ` ${response.data.failed} fallo(s) — ver detalles abajo.` : " No hubo errores."}`);
        showToast(
          hasFailed
            ? `${response.data.updated} actualizados, ${response.data.failed} fallidos`
            : "Actualización finalizada",
          hasFailed ? "error" : undefined
        );
      }
    } catch (err) {
      hasError = true;
      const message = err instanceof Error ? err.message : "No se pudieron aplicar los cambios";
      setError(message);
      setApplyStatusMessage("La importación falló");
      setApplyStatusDetail(message);
      setApplyStatusError(message);
      showToast(message, "error");
    } finally {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (!hasImagesJob) {
        setTimeout(() => {
          setProgress(0);
          if (!hasError) {
            setShowApplyStatusModal(false);
          }
        }, hasError ? 0 : 1000);
        setLoadingApply(false);
      }
    }
  };

  const handleDeleteDraft = async () => {
    if (!activeTenant || !draft) {
      return;
    }
    try {
      await apiRequest(withTenantPath(activeTenant.id, `/imports/${draft.id}`), { method: "DELETE" });
      setDraft(null);
      setPreview(null); setProductIdOverrides({});
      setResult(null);
      setSelectedFields([]);
      setSelectedPreviewRowIndexes([]);
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

  const handleCopyClaudePrompt = async () => {
    try {
      await navigator.clipboard.writeText(claudePrompt);
      showToast("Prompt copiado");
    } catch {
      showToast("No se pudo copiar el prompt", "error");
    }
  };

  const toggleSelectedField = (field: string) => {
    setSelectedFields((current) => (current.includes(field) ? current.filter((item) => item !== field) : [...current, field]));
  };

  const handleSelectAllFields = () => {
    setSelectedFields(availableEditableFields);
    setPreview(null); setProductIdOverrides({});
    setResult(null);
    setIsColumnModalOpen(false);
  };

  const handleClearSelectedFields = () => {
    setSelectedFields([]);
    setPreview(null); setProductIdOverrides({});
    setResult(null);
    setSelectedPreviewRowIndexes([]);
  };

  const allPreviewRowsSelected = Boolean(preview && preview.preview_rows.length > 0 && selectedPreviewRowIndexes.length === preview.preview_rows.length);

  const togglePreviewRowIndex = (rowIndex: number) => {
    setSelectedPreviewRowIndexes((current) => (current.includes(rowIndex) ? current.filter((item) => item !== rowIndex) : [...current, rowIndex]));
  };

  const handleToggleAllPreviewRows = () => {
    if (!preview) {
      return;
    }
    setSelectedPreviewRowIndexes(allPreviewRowsSelected ? [] : preview.preview_rows.filter((row) => row.product_found).map((row) => row.row_index));
  };

  const handleCreateProductFromRow = (row: PreviewResponse["preview_rows"][number]) => {
    if (!activeTenant) {
      return;
    }
    window.sessionStorage.setItem("woolas.import.prefill", JSON.stringify({ tenantId: activeTenant.id, row: row.row_data }));
    window.location.href = "/products?create=import";
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

          {formatAnalysis ? (
            <div className="rounded-2xl border border-border bg-background/70 p-4">
              <div className="text-sm font-medium text-foreground">
                {formatAnalysis.status === "ready" ? "Formato detectado correctamente" : formatAnalysis.status === "typos" ? "Hay encabezados por corregir" : "Este Excel necesita refactorización"}
              </div>
              {formatAnalysis.status === "ready" ? <div className="mt-2 text-sm text-muted-foreground">El archivo coincide con el formato esperado y puede usarse en este módulo.</div> : null}
              {formatAnalysis.typo_suggestions.length > 0 ? (
                <div className="mt-3 space-y-2 text-sm text-amber-700">
                  {formatAnalysis.typo_suggestions.map((item) => (
                    <div key={`${item.provided}-${item.expected}`}>Corrige `{item.provided}` por `{item.expected}`.</div>
                  ))}
                </div>
              ) : null}
              {formatAnalysis.missing_required.length > 0 ? (
                <div className="mt-3 text-sm text-destructive">Faltan columnas obligatorias: {formatAnalysis.missing_required.join(", ")}.</div>
              ) : null}
              {formatAnalysis.unknown_headers.length > 0 ? (
                <div className="mt-3 text-sm text-muted-foreground">Columnas no reconocidas: {formatAnalysis.unknown_headers.join(", ")}.</div>
              ) : null}
              {formatAnalysis.status === "refactor_required" ? (
                <div className="mt-4 space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Este archivo no coincide con el formato oficial. La vía recomendada es convertirlo externamente y luego volver a subirlo.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button className="rounded-xl" onClick={() => void handleCopyClaudePrompt()} variant="outline">
                      <Copy className="mr-2 h-4 w-4" />
                      Copiar prompt para Claude
                    </Button>
                    <a href="https://claude.ai/new" rel="noreferrer" target="_blank">
                      <Button className="rounded-xl" variant="outline">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Abrir Claude
                      </Button>
                    </a>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                    1. Descarga o ubica tu Excel actual.
                    <br />
                    2. Copia el prompt.
                    <br />
                    3. Ábrelo en Claude y adjunta tu Excel.
                    <br />
                    4. Pídele que te lo devuelva en el formato esperado por WooLas.
                    <br />
                    5. Sube aquí el archivo resultante.
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

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

          {previewColumns.length > 0 && formatAnalysis?.status === "ready" ? (
            <div className="space-y-4 rounded-2xl border border-border bg-background/70 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">Columnas a editar</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    El archivo ya tiene el formato correcto. Solo selecciona qué columnas quieres aplicar sobre los productos existentes.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button className="rounded-xl" onClick={() => setIsColumnModalOpen(true)} variant="outline">
                    Seleccionar columnas
                  </Button>
                  <Button className="rounded-xl" onClick={handleSelectAllFields} variant="secondary">
                    Editar todo
                  </Button>
                </div>
              </div>

              {availableEditableFields.length === 0 ? (
                <div className="text-sm text-muted-foreground">Este archivo no tiene columnas editables disponibles para este módulo.</div>
              ) : selectedFields.length > 0 ? (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-foreground">Seleccionadas: {selectedFields.length}</div>
                  <div className="flex flex-wrap gap-2">
                    {selectedFieldLabels.map((label, index) => (
                      <span key={`${label}-${index}`} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground">
                        {label}
                      </span>
                    ))}
                  </div>
                  <Button className="rounded-xl" onClick={handleClearSelectedFields} size="sm" variant="ghost">
                    Limpiar selección
                  </Button>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                    Solo se editarán estas columnas. Si aquí aparece `Imágenes` o cualquier otra que no quieras tocar, quítala antes de aplicar.
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No has seleccionado columnas todavía.</div>
              )}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="h-12 rounded-xl px-6 font-semibold" disabled={!activeTenant || !draft || formatAnalysis?.status !== "ready" || selectedFields.length === 0 || loadingPreview} onClick={handlePreview}>
              {loadingPreview ? "Generando vista previa..." : "Ver vista previa"}
            </Button>
            <Button
              className="h-12 rounded-xl px-6 font-semibold"
              disabled={
                !activeTenant || !draft || formatAnalysis?.status !== "ready" ||
                selectedFields.length === 0 || selectedPreviewRowIndexes.length === 0 || !preview || loadingApply ||
                // Block if any selected row still has unresolved ambiguous SKU
                selectedPreviewRowIndexes.some((i) => preview?.preview_rows.find((r) => r.row_index === i)?.ambiguous && !productIdOverrides[i])
              }
              onClick={handleApply}
              variant="secondary"
              title={selectedPreviewRowIndexes.some((i) => preview?.preview_rows.find((r) => r.row_index === i)?.ambiguous && !productIdOverrides[i]) ? "Hay filas con SKU ambiguo sin resolver" : undefined}
            >
              {loadingApply ? "Aplicando cambios..." : "Aplicar cambios"}
            </Button>
          </div>

          {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error}</div> : null}
        </CardContent>
      </Card>

      {sampleRows.length > 0 && formatAnalysis?.status === "ready" ? (
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

      {preview && formatAnalysis?.status === "ready" ? (
        <Card className="rounded-3xl border-border/80 shadow-sm">
              <CardHeader className="px-5 pt-6 sm:px-6">
                <CardTitle>Vista previa de cambios</CardTitle>
                <CardDescription>{preview.total_rows} filas analizadas. {selectedPreviewRowIndexes.length} filas marcadas para aplicar. Las filas sin coincidencia solo se pueden crear.</CardDescription>
              </CardHeader>
              <CardContent className="px-5 pb-6 sm:px-6">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Button className="rounded-xl" onClick={handleToggleAllPreviewRows} size="sm" variant="outline">
                    {allPreviewRowsSelected ? "Desmarcar todo" : "Marcar editables"}
                  </Button>
                  <div className="text-sm text-muted-foreground">
                    Marca solo las filas que quieres editar. Las que no tienen coincidencia no se aplican y deben crearse aparte.
                  </div>
                </div>
                <div className="overflow-x-auto rounded-2xl border border-border">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-accent/70">
                        <th className="px-3 py-3 text-left font-medium">#</th>
                        <th className="px-3 py-3 text-left font-medium">Editar</th>
                        <th className="px-3 py-3 text-left font-medium">Identificador</th>
                        <th className="px-3 py-3 text-left font-medium">Producto</th>
                        <th className="px-3 py-3 text-left font-medium">Columnas a actualizar</th>
                        <th className="px-3 py-3 text-left font-medium">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>{preview.preview_rows.map((row) => {
                      const chosenId = productIdOverrides[row.row_index];
                      const isAmbiguousUnresolved = row.ambiguous && !chosenId;
                      const resolvedName = chosenId
                        ? (row.sku_candidates.find((c) => c.id === chosenId)?.name ?? `ID ${chosenId}`)
                        : row.product_name;
                      const isFound = row.product_found || Boolean(chosenId);
                      return (
                        <tr key={`${row.row_index}-${row.identifier}-${row.product_id ?? "missing"}`} className={["border-b border-border/60 last:border-b-0", isAmbiguousUnresolved ? "bg-amber-50/40 dark:bg-amber-950/20" : !isFound ? "bg-muted/25 opacity-80" : ""].join(" ")}>
                          <td className="px-3 py-3 text-muted-foreground">{row.row_index + 1}</td>
                          <td className="px-3 py-3">
                            <input
                              checked={selectedPreviewRowIndexes.includes(row.row_index)}
                              disabled={!isFound || isAmbiguousUnresolved}
                              onChange={() => togglePreviewRowIndex(row.row_index)}
                              type="checkbox"
                            />
                          </td>
                          <td className="px-3 py-3">{row.identifier}</td>
                          <td className="px-3 py-3">
                            {isAmbiguousUnresolved ? (
                              <div className="space-y-1.5">
                                <div className="text-xs font-medium text-amber-600 dark:text-amber-400">SKU ambiguo — elige producto:</div>
                                <select
                                  className="w-full rounded-lg border border-amber-400/60 bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                                  defaultValue=""
                                  onChange={(e) => {
                                    const pid = Number(e.target.value);
                                    if (!pid) return;
                                    setProductIdOverrides((prev) => ({ ...prev, [row.row_index]: pid }));
                                    setSelectedPreviewRowIndexes((prev) => prev.includes(row.row_index) ? prev : [...prev, row.row_index]);
                                  }}
                                >
                                  <option disabled value="">Seleccionar...</option>
                                  {row.sku_candidates.map((c) => (
                                    <option key={c.id} value={c.id ?? ""}>{c.name ?? `ID ${c.id}`}</option>
                                  ))}
                                </select>
                              </div>
                            ) : resolvedName ?? "Sin coincidencia"}
                          </td>
                          <td className="px-3 py-3">{row.changed_fields.length > 0 ? row.changed_fields.map((field) => fieldLabels[field] ?? field).join(", ") : "Sin cambios"}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-2">
                              {isFound && !isAmbiguousUnresolved ? <Button className="rounded-xl" onClick={() => setSelectedPreviewRow(row)} size="sm" variant="outline">Ver comparación</Button> : null}
                              {!isFound ? <Button className="rounded-xl" onClick={() => handleCreateProductFromRow(row)} size="sm">Agregar producto</Button> : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
      ) : null}

      {result && applyRows.length > 0 && formatAnalysis?.status === "ready" ? (() => {
        const failedRows = applyRows.filter((r) => r.status === "failed");
        const okRows = applyRows.filter((r) => r.status === "ok");
        const skippedRows = applyRows.filter((r) => r.status === "skipped");
        return (
          <Card className="rounded-3xl border-border/80 shadow-sm">
            <CardHeader className="px-5 pt-6 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Resultado de la importación</CardTitle>
                  <CardDescription className="mt-1">
                    <span className="text-emerald-600 dark:text-emerald-400">{okRows.length} actualizados</span>
                    {skippedRows.length > 0 ? <span className="ml-2 text-amber-600 dark:text-amber-400">{skippedRows.length} omitidos</span> : null}
                    {failedRows.length > 0 ? <span className="ml-2 text-destructive">{failedRows.length} fallidos</span> : null}
                  </CardDescription>
                </div>
                {failedRows.length > 0 ? (
                  <Button
                    className="shrink-0 rounded-xl"
                    onClick={() => handleRetryRows(failedRows.map((r) => r.row_index))}
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Reintentar todos los fallidos ({failedRows.length})
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-6 sm:px-6">
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-accent/70">
                      <th className="px-3 py-3 text-left font-medium">#</th>
                      <th className="px-3 py-3 text-left font-medium">Estado</th>
                      <th className="px-3 py-3 text-left font-medium">Identificador</th>
                      <th className="px-3 py-3 text-left font-medium">Producto</th>
                      <th className="px-3 py-3 text-left font-medium">Detalle</th>
                      <th className="px-3 py-3 text-left font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {applyRows.map((row) => (
                      <tr
                        key={row.row_index}
                        className={[
                          "border-b border-border/60 last:border-b-0",
                          row.status === "failed" ? "bg-destructive/5" : row.status === "skipped" ? "bg-amber-50/40 dark:bg-amber-950/20" : "",
                        ].join(" ")}
                      >
                        <td className="px-3 py-3 text-muted-foreground">{row.row_index + 1}</td>
                        <td className="px-3 py-3">
                          {row.status === "ok" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> OK
                            </span>
                          ) : row.status === "skipped" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              <Circle className="h-3 w-3" /> Omitido
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                              <AlertCircle className="h-3 w-3" /> Error
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs">{row.identifier}</td>
                        <td className="px-3 py-3 text-muted-foreground">{row.product_name ?? "—"}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">
                          {row.image_detail ? (
                            <div className="space-y-1">
                              {row.image_detail.requested_principal_id !== null ? (
                                <div><span className="font-semibold">Principal pedido:</span> #{row.image_detail.requested_principal_id}</div>
                              ) : null}
                              {row.image_detail.requested_gallery_ids.length > 0 ? (
                                <div><span className="font-semibold">Galería pedida:</span> {row.image_detail.requested_gallery_ids.join(", ")}</div>
                              ) : null}
                              {row.image_detail.requested_names.length > 0 ? (
                                <div><span className="font-semibold">Nombres pedidos:</span> {row.image_detail.requested_names.join(", ")}</div>
                              ) : null}
                              {row.image_detail.resolved_image_names.length > 0 ? (
                                <div><span className="font-semibold">Resueltos:</span> {row.image_detail.resolved_image_names.join(", ")}</div>
                              ) : null}
                              {row.image_detail.applied_image_ids.length > 0 ? (
                                <div className="text-emerald-700 dark:text-emerald-400"><span className="font-semibold">WC aplicó IDs:</span> {row.image_detail.applied_image_ids.join(", ")}</div>
                              ) : null}
                              {row.image_detail.unresolved_names.length > 0 ? (
                                <div className="text-amber-700 dark:text-amber-400"><span className="font-semibold">No encontrados:</span> {row.image_detail.unresolved_names.join(", ")}</div>
                              ) : null}
                              {row.error ? <div className="text-destructive">{row.error}</div> : null}
                            </div>
                          ) : (
                            row.error ?? (row.status === "ok" ? "Actualizado correctamente" : "Sin datos")
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {row.status === "failed" ? (
                            <Button
                              className="rounded-xl"
                              onClick={() => handleRetryRows([row.row_index])}
                              size="sm"
                              variant="outline"
                            >
                              <RefreshCw className="mr-1 h-3 w-3" /> Reintentar
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })() : null}

      {isColumnModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-3xl rounded-3xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
              <div>
                <div className="text-lg font-semibold text-foreground">Seleccionar columnas</div>
                <div className="mt-1 text-sm text-muted-foreground">Marca las columnas del Excel que quieres aplicar en esta importación.</div>
              </div>
              <Button className="rounded-xl" onClick={() => setIsColumnModalOpen(false)} size="icon" variant="ghost">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto px-5 py-5 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {availableEditableFields.map((field) => {
                  const checked = selectedFields.includes(field);
                  return (
                    <label key={field} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card/80 p-4 transition-colors hover:bg-accent/30">
                      <input
                        checked={checked}
                        className="mt-1 h-4 w-4 rounded border-border"
                        onChange={() => {
                          toggleSelectedField(field);
                          setPreview(null); setProductIdOverrides({});
                          setResult(null);
                        }}
                        type="checkbox"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{fieldLabels[field] ?? field}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{field}</div>
                      </div>
                      {checked ? <Check className="ml-auto mt-0.5 h-4 w-4 text-primary" /> : null}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="text-sm text-muted-foreground">{selectedFields.length} columnas seleccionadas</div>
              <div className="flex flex-wrap gap-2">
                <Button className="rounded-xl" onClick={handleSelectAllFields} variant="secondary">
                  Editar todo
                </Button>
                <Button className="rounded-xl" onClick={() => setIsColumnModalOpen(false)}>
                  Listo
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedPreviewRow ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-4xl rounded-3xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
              <div>
                <div className="text-lg font-semibold text-foreground">Comparación de cambios</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {selectedPreviewRow.product_found ? `${selectedPreviewRow.product_name ?? selectedPreviewRow.identifier}` : `Sin coincidencia para ${selectedPreviewRow.identifier}`}
                </div>
              </div>
              <Button className="rounded-xl" onClick={() => setSelectedPreviewRow(null)} size="icon" variant="ghost">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6">
              <div className="overflow-hidden rounded-2xl border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-accent/70">
                    <tr>
                      <th className="px-3 py-3 text-left font-medium">Campo</th>
                      <th className="px-3 py-3 text-left font-medium">Antes</th>
                      <th className="px-3 py-3 text-left font-medium">Después</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPreviewRow.changes.map((change) => (
                      <tr key={change.field} className="border-b border-border/60 last:border-b-0 align-top">
                        <td className="px-3 py-3 font-medium">{fieldLabels[change.field] ?? change.field}</td>
                        <td className="px-3 py-3 whitespace-pre-wrap text-muted-foreground">{change.before || "Vacío"}</td>
                        <td className="px-3 py-3 whitespace-pre-wrap">{change.after || "Vacío"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showApplyStatusModal ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-4">
          <div className="flex w-full max-w-2xl flex-col rounded-t-3xl border border-border bg-background shadow-2xl sm:rounded-3xl" style={{ maxHeight: "90dvh" }}>

            {/* Header */}
            <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
              <div className="rounded-2xl border border-border bg-card p-2.5">
                <LoaderCircle className={["h-5 w-5", loadingApply ? "animate-spin text-primary" : applyStatusError ? "text-destructive" : "text-emerald-600"].join(" ")} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-foreground sm:text-lg">{applyStatusMessage ?? "Procesando importación..."}</div>
                <div className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                  {selectedPreviewRowIndexes.length} fila(s) · {selectedFieldsSummary || "Sin columnas"}
                </div>
              </div>
              <Button className="shrink-0 rounded-xl" onClick={() => setShowApplyStatusModal(false)} size="icon" title="Minimizar — el proceso sigue en segundo plano" variant="ghost">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Progress bar + detail */}
            <div className="shrink-0 space-y-3 px-5 pt-4 sm:px-6">
              {imagesJobStatus?.current_product_name && imagesJobStatus.status === "running" ? (
                <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Actualizando: </span>
                  <span className="font-semibold text-foreground">{imagesJobStatus.current_product_name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">({imagesJobStatus.processed + 1} / {imagesJobStatus.total})</span>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{applyStatusDetail ?? "Preparando..."}</span>
                  <span className="font-medium tabular-nums">{progress}%</span>
                </div>
                <Progress className="h-2" value={progress} />
              </div>

              {applyStatusError ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                  <span className="font-medium">Error: </span>{applyStatusError}
                </div>
              ) : null}
            </div>

            {/* Per-product list */}
            {imagesJobStatus?.rows?.length ? (
              <div className="min-h-0 flex-1 overflow-hidden px-5 pb-5 pt-3 sm:px-6">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Productos</span>
                  <span className="text-xs text-muted-foreground">
                    {imagesJobStatus.rows.filter((r) => r.status === "completed" || r.status === "skipped").length} / {imagesJobStatus.rows.length} procesados
                  </span>
                </div>
                <div className="h-full overflow-y-auto rounded-2xl border border-border">
                  {imagesJobStatus.rows.map((row) => (
                    <div
                      key={`${row.row_index}-${row.identifier}`}
                      ref={row.status === "running" ? activeRowRef : null}
                      className="border-b border-border/50 px-4 py-3 last:border-b-0"
                    >
                      {/* Header: icon + name + badge */}
                      <div className="flex items-center gap-2">
                        <div className="shrink-0">
                          {row.status === "completed" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : row.status === "failed" ? (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          ) : row.status === "skipped" ? (
                            <AlertCircle className="h-4 w-4 text-amber-500" />
                          ) : row.status === "running" ? (
                            <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                          ) : (
                            <Circle className="h-4 w-4 text-muted-foreground/30" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium leading-tight text-foreground">
                            {row.product_name ?? row.identifier}
                          </div>
                          {row.product_name && row.identifier !== row.product_name ? (
                            <div className="truncate text-[11px] text-muted-foreground">{row.identifier}</div>
                          ) : null}
                        </div>
                        <span className={[
                          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          row.status === "completed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : row.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : row.status === "skipped" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                : row.status === "running" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                  : "bg-muted text-muted-foreground",
                        ].join(" ")}>
                          {row.status === "completed" ? "Listo" : row.status === "failed" ? "Falló" : row.status === "skipped" ? "Omitido" : row.status === "running" ? "Enviando" : "En cola"}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        {row.status === "completed" ? (
                          <div className="h-full w-full rounded-full bg-emerald-500" />
                        ) : row.status === "failed" ? (
                          <div className="h-full w-full rounded-full bg-destructive" />
                        ) : row.status === "skipped" ? (
                          <div className="h-full w-full rounded-full bg-amber-400" />
                        ) : row.status === "running" ? (
                          <div className="h-full w-1/3 animate-[progress_1s_ease-in-out_infinite] rounded-full bg-primary" style={{ animation: "slideProgress 1.2s ease-in-out infinite" }} />
                        ) : (
                          <div className="h-full w-0" />
                        )}
                      </div>

                      {/* Image detail */}
                      {(row.requested_names?.length || row.requested_gallery_ids?.length || row.requested_principal_id || row.applied_image_ids?.length) ? (
                        <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                          {row.requested_principal_id ? (
                            <div>Principal pedido: #{row.requested_principal_id}</div>
                          ) : null}
                          {row.requested_gallery_ids?.length ? (
                            <div>Galería pedida: {row.requested_gallery_ids.join(", ")}</div>
                          ) : null}
                          {row.requested_names?.length ? (
                            <div>Nombres: {row.requested_names.join(", ")}</div>
                          ) : null}
                          {row.resolved_image_names?.length ? (
                            <div>Resueltos: {row.resolved_image_names.join(", ")}</div>
                          ) : null}
                          {row.applied_image_ids?.length ? (
                            <div className="text-emerald-700 dark:text-emerald-400">WC aplicó: {row.applied_image_ids.join(", ")}</div>
                          ) : null}
                          {row.unresolved_names?.length ? (
                            <div className="text-amber-700 dark:text-amber-400">No encontrados: {row.unresolved_names.join(", ")}</div>
                          ) : null}
                        </div>
                      ) : null}

                      {/* Error / skip reason */}
                      {(row.status === "failed" || row.status === "skipped") && row.error ? (
                        <div className={`mt-1 text-[11px] ${row.status === "skipped" ? "text-amber-600 dark:text-amber-400" : "text-destructive"}`}>{row.error}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-5 pb-5 pt-3 sm:px-6">
                <div className="rounded-2xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
                  {applyStatusDetail ?? "Preparando la operación..."}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
