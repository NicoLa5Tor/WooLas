"use client";

import { Boxes, ImagePlus, LoaderCircle, Pencil, Plus, Search, Trash2, UploadCloud, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  apiRequest,
  resolveActiveTenant,
  uploadFileWithProgress,
  withTenantPath,
  type AuthSession,
  type MediaItem,
} from "@/lib/api";

type WCProduct = {
  id: number;
  name: string;
  sku: string;
  type: string;
  regular_price?: string;
  sale_price?: string;
  price?: string;
  images?: Array<{ id: number; src: string }>;
  grouped_products?: number[];
  short_description?: string;
  meta_data?: Array<{ key: string; value: unknown }>;
};

const META_REGULAR = "_combo_regular_price";
const META_SALE = "_combo_sale_price";
const META_CHILDREN = "_combo_children";
const META_MODE = "_combo_mode";

const COMBO_BLOCK_RE = /<!-- combo:children-start -->[\s\S]*?<!-- combo:children-end -->/g;

const stripComboBlock = (text: string | undefined | null): string =>
  (text || "").replace(COMBO_BLOCK_RE, "").trim();

const getMeta = (combo: WCProduct, key: string): string => {
  const item = (combo.meta_data ?? []).find((m) => m.key === key);
  return item?.value == null ? "" : String(item.value);
};

const parseChildIds = (combo: WCProduct): number[] => {
  const raw = getMeta(combo, META_CHILDREN);
  if (!raw) return combo.grouped_products ?? [];
  return raw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
};

type ListResponse = {
  items: WCProduct[];
  page: number;
  total: number;
  total_pages: number;
};

type ComboMode = "sum_children" | "custom_price";

type ComboFormState = {
  id?: number;
  name: string;
  sku: string;
  regular_price: string;
  sale_price: string;
  short_description: string;
  image: MediaItem | null;
  children: WCProduct[];
  mode: ComboMode;
};

const emptyForm: ComboFormState = {
  name: "",
  sku: "",
  regular_price: "",
  sale_price: "",
  short_description: "",
  image: null,
  children: [],
  mode: "custom_price",
};

export default function CombosPage() {
  const { showToast } = useToast();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [combos, setCombos] = useState<WCProduct[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState<ComboFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" })
      .then((r) => setSession(r.data))
      .catch(() => null);
  }, []);

  const activeTenant = session ? resolveActiveTenant(session) : null;

  const loadCombos = useCallback(
    async (currentPage: number, currentSearch: string) => {
      if (!activeTenant) return;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(currentPage));
        if (currentSearch.trim()) params.set("search", currentSearch.trim());
        const response = await apiRequest<ListResponse>(
          withTenantPath(activeTenant.id, `/combos?${params.toString()}`),
          { cache: "no-store" }
        );
        setCombos(response.data.items);
        setTotalPages(response.data.total_pages);
      } catch (err) {
        const message = err instanceof Error ? err.message : "No se pudieron cargar los combos";
        showToast(message, "error");
      } finally {
        setLoading(false);
      }
    },
    [activeTenant, showToast]
  );

  useEffect(() => {
    if (activeTenant) void loadCombos(page, searchTerm);
  }, [activeTenant, page, searchTerm, loadCombos]);

  const openCreateDialog = () => {
    setForm(emptyForm);
    setShowDialog(true);
  };

  const openEditDialog = async (combo: WCProduct) => {
    if (!activeTenant) return;
    const childIds = parseChildIds(combo);
    let children: WCProduct[] = [];
    if (childIds.length) {
      try {
        const results = await Promise.all(
          childIds.map((id) =>
            apiRequest<WCProduct>(withTenantPath(activeTenant.id, `/products/${id}`), { cache: "no-store" })
              .then((r) => r.data)
              .catch(() => null)
          )
        );
        children = results.filter((c): c is WCProduct => c !== null);
      } catch {
        children = [];
      }
    }
    const storedMode = getMeta(combo, META_MODE);
    const mode: ComboMode = storedMode === "sum_children"
      ? "sum_children"
      : storedMode === "custom_price"
        ? "custom_price"
        : (combo.type === "grouped" ? "sum_children" : "custom_price");
    setForm({
      id: combo.id,
      name: combo.name,
      sku: combo.sku || "",
      regular_price: getMeta(combo, META_REGULAR) || combo.regular_price || "",
      sale_price: getMeta(combo, META_SALE) || combo.sale_price || "",
      short_description: stripComboBlock(combo.short_description),
      mode,
      image: combo.images?.[0]
        ? {
            id: combo.images[0].id,
            url: combo.images[0].src,
            thumbnail: combo.images[0].src,
            filename: "",
            uploaded_at: "",
          }
        : null,
      children,
    });
    setShowDialog(true);
  };

  const handleImageFile = async (file: File) => {
    if (!activeTenant) return;
    setUploadingImage(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await uploadFileWithProgress<MediaItem>(
        withTenantPath(activeTenant.id, "/media"),
        file,
        (p) => setUploadProgress(p)
      );
      setForm((prev) => ({ ...prev, image: response.data }));
      showToast("Imagen subida a la galería");
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo subir la imagen";
      showToast(message, "error");
    } finally {
      setUploadingImage(false);
      setUploadProgress(0);
    }
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void handleImageFile(file);
  };

  const handleSave = async () => {
    if (!activeTenant) return;
    if (!form.name.trim()) {
      showToast("Falta el nombre del combo", "error");
      return;
    }
    if (form.children.length === 0) {
      showToast("Agrega al menos un producto al combo", "error");
      return;
    }

    const meta_data: Array<{ key: string; value: string }> = [];
    if (form.regular_price.trim()) meta_data.push({ key: META_REGULAR, value: form.regular_price.trim() });
    if (form.sale_price.trim()) meta_data.push({ key: META_SALE, value: form.sale_price.trim() });

    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || undefined,
      type: "grouped" as const,
      status: "publish" as const,
      regular_price: form.regular_price.trim() || undefined,
      sale_price: form.sale_price.trim() || undefined,
      short_description: form.short_description.trim() || undefined,
      grouped_products: form.children.map((c) => c.id),
      images: form.image ? [{ id: form.image.id }] : [],
      meta_data,
    };

    setSaving(true);
    try {
      const modeParam = `?mode=${form.mode}`;
      if (form.id) {
        await apiRequest(withTenantPath(activeTenant.id, `/combos/${form.id}${modeParam}`), {
          method: "PUT",
          body: JSON.stringify(payload),
          headers: { "Content-Type": "application/json" },
        });
        showToast("Combo actualizado");
      } else {
        await apiRequest(withTenantPath(activeTenant.id, `/combos${modeParam}`), {
          method: "POST",
          body: JSON.stringify(payload),
          headers: { "Content-Type": "application/json" },
        });
        showToast("Combo creado");
      }
      setShowDialog(false);
      setForm(emptyForm);
      void loadCombos(page, searchTerm);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo guardar el combo";
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (combo: WCProduct) => {
    if (!activeTenant) return;
    if (!confirm(`¿Eliminar combo "${combo.name}"? Esto elimina solo el combo, no los productos hijos.`)) return;
    try {
      await apiRequest(withTenantPath(activeTenant.id, `/combos/${combo.id}?force=true`), { method: "DELETE" });
      showToast("Combo eliminado");
      void loadCombos(page, searchTerm);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo eliminar el combo";
      showToast(message, "error");
    }
  };

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="rounded-3xl border border-border/80 bg-card/85 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Combos</div>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Productos combo</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Agrupa varios productos en un combo (tipo <span className="font-mono text-xs">grouped</span> en WooCommerce).
              Sube una imagen, define el precio sin IVA y selecciona los productos hijos.
            </p>
          </div>
          {activeTenant ? (
            <Button className="h-11 shrink-0 rounded-xl px-5" onClick={openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />Nuevo combo
            </Button>
          ) : null}
        </div>
      </section>

      <Card className="rounded-3xl border-border/80 shadow-sm">
        <CardHeader className="px-5 pt-6 sm:px-6">
          <CardTitle>Combos existentes</CardTitle>
          <CardDescription>Combos creados en WooCommerce para este cliente.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-6 sm:px-6">
          <div className="mb-4 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 rounded-xl pl-9"
                placeholder="Buscar por nombre o SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setPage(1);
                    setSearchTerm(search);
                  }
                }}
              />
            </div>
            <Button
              className="h-10 rounded-xl"
              variant="outline"
              onClick={() => {
                setPage(1);
                setSearchTerm(search);
              }}
            >
              Buscar
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />Cargando combos...
            </div>
          ) : combos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center text-sm text-muted-foreground">
              <Boxes className="mx-auto mb-3 h-8 w-8 opacity-40" />
              No hay combos aún. Crea el primero con el botón "Nuevo combo".
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-accent/70">
                    <th className="px-3 py-3 text-left font-medium">Imagen</th>
                    <th className="px-3 py-3 text-left font-medium">Nombre</th>
                    <th className="px-3 py-3 text-left font-medium">SKU</th>
                    <th className="px-3 py-3 text-left font-medium">Regular</th>
                    <th className="px-3 py-3 text-left font-medium">Con dto</th>
                    <th className="px-3 py-3 text-left font-medium">Dto</th>
                    <th className="px-3 py-3 text-left font-medium">Hijos</th>
                    <th className="px-3 py-3 text-left font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {combos.map((combo) => (
                    <tr key={combo.id} className="border-b border-border/60 last:border-b-0">
                      <td className="px-3 py-3">
                        {combo.images?.[0] ? (
                          <img src={combo.images[0].src} alt={combo.name} className="h-12 w-12 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-muted-foreground"><ImagePlus className="h-5 w-5" /></div>
                        )}
                      </td>
                      <td className="px-3 py-3 font-medium">{combo.name}</td>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{combo.sku || "—"}</td>
                      {(() => {
                        const regRaw = getMeta(combo, META_REGULAR) || combo.regular_price || "";
                        const saleRaw = getMeta(combo, META_SALE) || combo.sale_price || "";
                        const reg = parseFloat(regRaw.replace(/[^0-9.]/g, ""));
                        const sale = parseFloat(saleRaw.replace(/[^0-9.]/g, ""));
                        const fmt = (n: number) => isFinite(n) && n > 0 ? n.toLocaleString("es-CO") : "—";
                        const pct = isFinite(reg) && isFinite(sale) && reg > 0 && sale > 0 && sale < reg
                          ? Math.round((1 - sale / reg) * 100)
                          : null;
                        return (
                          <>
                            <td className="px-3 py-3 tabular-nums">{fmt(reg)}</td>
                            <td className="px-3 py-3 tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(sale)}</td>
                            <td className="px-3 py-3">
                              {pct !== null ? (
                                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">-{pct}%</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </>
                        );
                      })()}
                      <td className="px-3 py-3 text-muted-foreground">{parseChildIds(combo).length}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => void openEditDialog(combo)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void handleDelete(combo)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">Página {page} de {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Siguiente
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {showDialog && activeTenant ? (
        <ComboDialog
          tenantId={activeTenant.id}
          form={form}
          setForm={setForm}
          saving={saving}
          uploadingImage={uploadingImage}
          uploadProgress={uploadProgress}
          fileInputRef={fileInputRef}
          onClose={() => setShowDialog(false)}
          onSave={handleSave}
          onImageFile={handleImageFile}
          onImageDrop={onDrop}
        />
      ) : null}
    </div>
  );
}

function ComboDialog({
  tenantId,
  form,
  setForm,
  saving,
  uploadingImage,
  uploadProgress,
  fileInputRef,
  onClose,
  onSave,
  onImageFile,
  onImageDrop,
}: {
  tenantId: string;
  form: ComboFormState;
  setForm: React.Dispatch<React.SetStateAction<ComboFormState>>;
  saving: boolean;
  uploadingImage: boolean;
  uploadProgress: number;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSave: () => void;
  onImageFile: (file: File) => void;
  onImageDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}) {
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<WCProduct[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);

  const childIdSet = useMemo(() => new Set(form.children.map((c) => c.id)), [form.children]);

  useEffect(() => {
    if (!productSearch.trim()) {
      setProductResults([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      setSearchingProducts(true);
      try {
        const response = await apiRequest<ListResponse>(
          withTenantPath(tenantId, `/products?search=${encodeURIComponent(productSearch.trim())}&page=1`),
          { cache: "no-store" }
        );
        setProductResults(response.data.items.filter((p) => p.type !== "grouped"));
      } catch {
        setProductResults([]);
      } finally {
        setSearchingProducts(false);
      }
    }, 280);
    return () => window.clearTimeout(handle);
  }, [productSearch, tenantId]);

  const addChild = (product: WCProduct) => {
    if (childIdSet.has(product.id)) return;
    setForm((prev) => ({ ...prev, children: [...prev.children, product] }));
    setProductSearch("");
    setProductResults([]);
  };

  const removeChild = (id: number) => {
    setForm((prev) => ({ ...prev, children: prev.children.filter((c) => c.id !== id) }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex h-full w-full max-w-3xl flex-col rounded-t-3xl bg-card shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-3xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold">{form.id ? "Editar combo" : "Nuevo combo"}</h2>
            <p className="text-xs text-muted-foreground">Tipo grouped — el precio que pongas es el precio sin IVA.</p>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <div>
            <label className="mb-2 block text-sm font-medium">Precio del combo</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, mode: "custom_price" }))}
                className={[
                  "rounded-2xl border-2 px-4 py-3 text-left transition",
                  form.mode === "custom_price"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                ].join(" ")}
              >
                <div className="text-sm font-semibold">Precio que yo pongo</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Uso los precios que escribo abajo (regular + con descuento). Hijos siempre se muestran en la página.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, mode: "sum_children" }))}
                className={[
                  "rounded-2xl border-2 px-4 py-3 text-left transition",
                  form.mode === "sum_children"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                ].join(" ")}
              >
                <div className="text-sm font-semibold">Suma de los hijos</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Sumo automáticamente los precios de los hijos. Lo que escribas abajo se ignora.
                </div>
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Imagen del combo</label>
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/30 p-5 transition hover:border-primary/50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onImageDrop}
            >
              {form.image ? (
                <div className="flex w-full items-center gap-3">
                  <img src={form.image.thumbnail || form.image.url} alt="combo" className="h-20 w-20 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{form.image.filename || `Imagen #${form.image.id}`}</div>
                    <div className="text-xs text-muted-foreground">ID WordPress: {form.image.id}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setForm((prev) => ({ ...prev, image: null }))}>
                    Quitar
                  </Button>
                </div>
              ) : uploadingImage ? (
                <div className="flex flex-col items-center gap-2 py-4">
                  <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                  <div className="text-sm text-muted-foreground">Subiendo imagen... {uploadProgress}%</div>
                </div>
              ) : (
                <>
                  <UploadCloud className="h-8 w-8 text-muted-foreground" />
                  <div className="text-sm text-muted-foreground">Arrastra una imagen aquí o</div>
                  <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    Seleccionar archivo
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onImageFile(f);
                      e.target.value = "";
                    }}
                  />
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Nombre del combo</label>
              <Input
                className="h-10 rounded-xl"
                placeholder="ej. Combo Yerry Mina"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">SKU</label>
              <Input
                className="h-10 rounded-xl font-mono"
                placeholder="ej. 562165"
                value={form.sku}
                onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Precio regular sin IVA</label>
              <Input
                className="h-10 rounded-xl tabular-nums"
                inputMode="numeric"
                placeholder="ej. 1195893"
                value={form.regular_price ? Number(form.regular_price).toLocaleString("es-CO") : ""}
                onChange={(e) => setForm((prev) => ({ ...prev, regular_price: e.target.value.replace(/\D+/g, "") }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">PVP WEB — precio lleno sin descuento.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Precio con descuento sin IVA</label>
              <Input
                className="h-10 rounded-xl tabular-nums"
                inputMode="numeric"
                placeholder="ej. 920838"
                value={form.sale_price ? Number(form.sale_price).toLocaleString("es-CO") : ""}
                onChange={(e) => setForm((prev) => ({ ...prev, sale_price: e.target.value.replace(/\D+/g, "") }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">PVP con dto. Dejar vacío si no hay descuento.</p>
            </div>
          </div>
          {(() => {
            const reg = parseFloat(form.regular_price.replace(/[^0-9.]/g, ""));
            const sale = parseFloat(form.sale_price.replace(/[^0-9.]/g, ""));
            if (!isFinite(reg) || !isFinite(sale) || reg <= 0 || sale <= 0 || sale >= reg) return null;
            const pct = Math.round((1 - sale / reg) * 100);
            const ahorro = reg - sale;
            return (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
                <span className="font-semibold">Descuento: {pct}%</span>
                <span className="ml-3 text-xs">Ahorro de {ahorro.toLocaleString("es-CO")} (sin IVA). WooCommerce agregará el IVA al mostrar al cliente.</span>
              </div>
            );
          })()}

          <div>
            <label className="mb-1.5 block text-sm font-medium">Descripción corta</label>
            <Textarea
              className="min-h-[80px] rounded-xl"
              placeholder="Resumen del combo"
              value={form.short_description}
              onChange={(e) => setForm((prev) => ({ ...prev, short_description: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Productos del combo</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 rounded-xl pl-9"
                placeholder="Buscar producto por SKU o nombre..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>
            {productResults.length > 0 ? (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-2xl border border-border">
                {productResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={childIdSet.has(p.id)}
                    className="flex w-full items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-40 last:border-b-0"
                    onClick={() => addChild(p)}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{p.sku} · {p.type}</div>
                    </div>
                    {childIdSet.has(p.id) ? (
                      <span className="text-xs text-muted-foreground">Ya agregado</span>
                    ) : (
                      <Plus className="h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            ) : searchingProducts ? (
              <div className="mt-2 text-xs text-muted-foreground">Buscando...</div>
            ) : null}

            {form.children.length > 0 ? (
              <div className="mt-3 rounded-2xl border border-border">
                <div className="border-b border-border/60 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {form.children.length} producto(s) en el combo
                </div>
                {form.children.map((c, i) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-sm last:border-b-0">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      {c.images?.[0] ? (
                        <img src={c.images[0].src} alt={c.name} className="h-8 w-8 rounded object-cover" />
                      ) : null}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{c.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{c.sku || `ID ${c.id}`}</div>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => removeChild(c.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Aún no agregaste productos al combo.</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={saving || uploadingImage}>
            {saving ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Guardando...</> : form.id ? "Guardar cambios" : "Crear combo"}
          </Button>
        </div>
      </div>
    </div>
  );
}
