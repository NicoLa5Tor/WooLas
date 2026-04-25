"use client";

import { Copy, ExternalLink, ImagePlus, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MediaLibraryBrowser } from "@/components/MediaLibraryBrowser";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { apiRequest, type AuthSession, type MediaItem, resolveActiveTenant, withTenantPath } from "@/lib/api";

type ProductCategory = {
  id: number;
  name: string;
  slug: string;
};

type ProductImage = {
  id: number;
  src: string;
  name?: string;
  alt?: string;
};

type ProductDimensions = {
  length: string;
  width: string;
  height: string;
};

type Product = {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  type: "simple" | string;
  status: "publish" | "draft";
  description: string;
  short_description: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: "instock" | "outofstock" | "onbackorder" | string;
  weight: string;
  dimensions: ProductDimensions;
  categories: ProductCategory[];
  images: ProductImage[];
};

type ProductListResponse = {
  items: Product[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

type EditorProduct = {
  id?: number;
  name: string;
  sku: string;
  slug: string;
  permalink: string;
  type: "simple";
  status: "publish" | "draft";
  regular_price: string;
  sale_price: string;
  stock_quantity: string;
  manage_stock: boolean;
  stock_status: "instock" | "outofstock" | "onbackorder";
  short_description: string;
  description: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  categoryIds: string;
  images: ProductImage[];
};

function stripHtml(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function displayPrice(product: Product) {
  return product.sale_price || product.regular_price || product.price || "-";
}

function serializeCategoryIds(categories: ProductCategory[]) {
  return categories.map((category) => String(category.id)).join(", ");
}

function toEditorProduct(product?: Product): EditorProduct {
  if (!product) {
    return {
      name: "",
      sku: "",
      slug: "",
      permalink: "",
      type: "simple",
      status: "publish",
      regular_price: "",
      sale_price: "",
      stock_quantity: "",
      manage_stock: false,
      stock_status: "instock",
      short_description: "",
      description: "",
      weight: "",
      length: "",
      width: "",
      height: "",
      categoryIds: "",
      images: []
    };
  }

  return {
    id: product.id,
    name: product.name ?? "",
    sku: product.sku ?? "",
    slug: product.slug ?? "",
    permalink: product.permalink ?? "",
    type: "simple",
    status: product.status === "draft" ? "draft" : "publish",
    regular_price: product.regular_price ?? "",
    sale_price: product.sale_price ?? "",
    stock_quantity: product.stock_quantity == null ? "" : String(product.stock_quantity),
    manage_stock: Boolean(product.manage_stock),
    stock_status: product.stock_status === "outofstock" || product.stock_status === "onbackorder" ? product.stock_status : "instock",
    short_description: product.short_description ?? "",
    description: product.description ?? "",
    weight: product.weight ?? "",
    length: product.dimensions?.length ?? "",
    width: product.dimensions?.width ?? "",
    height: product.dimensions?.height ?? "",
    categoryIds: serializeCategoryIds(product.categories ?? []),
    images: product.images ?? []
  };
}

function parseCategoryIds(value: string) {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function buildPayload(product: EditorProduct) {
  return {
    name: product.name.trim(),
    sku: product.sku.trim() || null,
    regular_price: product.regular_price.trim() || null,
    sale_price: product.sale_price.trim() || null,
    stock_quantity: product.manage_stock && product.stock_quantity !== "" ? Number(product.stock_quantity) : null,
    short_description: product.short_description,
    description: product.description,
    status: product.status,
    manage_stock: product.manage_stock,
    stock_status: product.stock_status,
    weight: product.weight.trim() || null,
    categories: parseCategoryIds(product.categoryIds),
    images: product.images.map((image) => ({ id: image.id })),
    dimensions: {
      length: product.length.trim(),
      width: product.width.trim(),
      height: product.height.trim()
    }
  };
}

export default function ProductsPage() {
  const { showToast } = useToast();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<EditorProduct | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("edit");
  const [panelLoading, setPanelLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState<"replace" | "append" | null>(null);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 1 });

  const activeTenant = session ? resolveActiveTenant(session) : null;

  const loadProducts = async (sessionOverride?: AuthSession) => {
    setLoading(true);
    setError(null);
    try {
      const currentSession = sessionOverride ?? (await apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" })).data;
      setSession(currentSession);
      const tenant = resolveActiveTenant(currentSession);
      if (!tenant) {
        setProducts([]);
        return;
      }

      const query = new URLSearchParams({ page: String(page) });
      if (searchTerm) {
        query.set("search", searchTerm);
      }
      const response = await apiRequest<ProductListResponse>(`${withTenantPath(tenant.id, "/products")}?${query.toString()}`, { cache: "no-store" });
      setProducts(response.data.items);
      setPagination({ total: response.data.total, total_pages: response.data.total_pages });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los productos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProducts();
  }, [page, searchTerm]);

  const openProduct = async (productId: number) => {
    if (!activeTenant) {
      return;
    }
    setEditorMode("edit");
    setPanelLoading(true);
    try {
      const response = await apiRequest<Product>(withTenantPath(activeTenant.id, `/products/${productId}`), { cache: "no-store" });
      setSelectedProduct(toEditorProduct(response.data));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo cargar el producto", "error");
    } finally {
      setPanelLoading(false);
    }
  };

  const openCreateProduct = () => {
    setEditorMode("create");
    setPanelLoading(false);
    setSelectedProduct(toEditorProduct());
  };

  const saveProduct = async () => {
    if (!selectedProduct || !activeTenant) {
      return;
    }

    if (!selectedProduct.name.trim()) {
      showToast("El nombre del producto es obligatorio", "error");
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload(selectedProduct);
      const response = editorMode === "create"
        ? await apiRequest<Product>(withTenantPath(activeTenant.id, "/products"), {
            method: "POST",
            body: JSON.stringify(payload)
          })
        : await apiRequest<Product>(withTenantPath(activeTenant.id, `/products/${selectedProduct.id}`), {
            method: "PUT",
            body: JSON.stringify(payload)
          });

      setSelectedProduct(toEditorProduct(response.data));
      setEditorMode("edit");
      showToast(editorMode === "create" ? "Producto creado" : "Producto actualizado");
      await loadProducts(session ?? undefined);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const copyValue = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    showToast(`${label} copiado`);
  };

  const handleMediaSelect = (item: MediaItem) => {
    if (!selectedProduct) {
      return;
    }

    const nextImage = { id: item.id, src: item.url, name: item.filename };
    if (showMediaPicker === "replace") {
      setSelectedProduct({
        ...selectedProduct,
        images: [nextImage, ...selectedProduct.images.filter((image) => image.id !== item.id)]
      });
    }
    if (showMediaPicker === "append") {
      if (selectedProduct.images.some((image) => image.id === item.id)) {
        showToast("Esa imagen ya está en la galería del producto", "error");
        return;
      }
      setSelectedProduct({
        ...selectedProduct,
        images: [...selectedProduct.images, nextImage]
      });
    }
    setShowMediaPicker(null);
  };

  const editorSummary = useMemo(() => {
    if (!selectedProduct) {
      return [] as string[];
    }

    return [
      selectedProduct.sku ? `SKU ${selectedProduct.sku}` : null,
      selectedProduct.slug ? `Slug ${selectedProduct.slug}` : null,
      selectedProduct.stock_status === "instock" ? "En stock" : selectedProduct.stock_status === "outofstock" ? "Sin stock" : "Sobre pedido",
      selectedProduct.categoryIds ? `Categorías ${selectedProduct.categoryIds}` : null
    ].filter(Boolean) as string[];
  }, [selectedProduct]);

  return (
    <div className="relative space-y-6 lg:space-y-8">
      <section className="rounded-3xl border border-border/80 bg-card/85 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Productos</div>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Catálogo y gestión unitaria</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              {activeTenant ? `Consulta, crea y edita productos unitarios de ${activeTenant.name} usando la información del backup.` : "Selecciona un cliente activo para explorar productos."}
            </p>
          </div>
          <div className="flex w-full max-w-3xl flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-12 rounded-xl pl-9" placeholder="Buscar por nombre, SKU o slug" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Button className="h-12 rounded-xl px-6 font-semibold" disabled={!activeTenant} onClick={() => { setPage(1); setSearchTerm(search.trim()); }}>
              Buscar
            </Button>
            <Button className="h-12 rounded-xl px-6 font-semibold" disabled={!activeTenant} onClick={openCreateProduct} variant="secondary">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo producto
            </Button>
          </div>
        </div>
      </section>

      <Card className="rounded-3xl border-border/80 shadow-sm">
        <CardHeader className="px-5 pt-6 sm:px-6">
          <CardTitle>Listado</CardTitle>
          <CardDescription>{pagination.total} productos encontrados.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-6 sm:px-6">
          {loading ? <div className="text-sm text-muted-foreground">Cargando productos...</div> : null}
          {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error}</div> : null}
          {!loading && !error && !activeTenant ? <div className="text-sm text-muted-foreground">No hay cliente activo seleccionado.</div> : null}
          {!loading && !error && activeTenant ? (
            <>
              <div className="grid gap-4 md:hidden">
                {products.map((product) => (
                  <button
                    key={product.id}
                    className="rounded-2xl border border-border bg-background/70 p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/20"
                    onClick={() => void openProduct(product.id)}
                    type="button"
                  >
                    <div className="flex gap-4">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-accent">
                        {product.images?.[0]?.src ? <img alt={product.name} className="h-full w-full object-cover" src={product.images[0].src} /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{product.name}</div>
                        <div className="mt-1 text-sm text-muted-foreground">SKU: {product.sku || "-"}</div>
                        <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{stripHtml(product.short_description || product.description) || "Sin descripción"}</div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full bg-accent px-2.5 py-1">Precio: {displayPrice(product)}</span>
                          <span className="rounded-full bg-accent px-2.5 py-1">Stock: {product.manage_stock ? product.stock_quantity ?? 0 : product.stock_status}</span>
                          <span className="rounded-full bg-accent px-2.5 py-1">{product.categories?.[0]?.name ?? product.type}</span>
                        </div>
                      </div>
                      <Badge>{product.status === "publish" ? "Activo" : "Borrador"}</Badge>
                    </div>
                  </button>
                ))}
                {products.length === 0 ? <div className="rounded-2xl border border-border bg-background/70 px-4 py-6 text-sm text-muted-foreground">No hay productos para esta búsqueda.</div> : null}
              </div>

              <div className="hidden overflow-hidden rounded-2xl border border-border md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-accent/70">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Imagen</th>
                      <th className="px-4 py-3 text-left font-medium">Nombre</th>
                      <th className="px-4 py-3 text-left font-medium">SKU</th>
                      <th className="px-4 py-3 text-left font-medium">Slug</th>
                      <th className="px-4 py-3 text-left font-medium">Precio</th>
                      <th className="px-4 py-3 text-left font-medium">Stock</th>
                      <th className="px-4 py-3 text-left font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {products.map((product) => (
                      <tr key={product.id} className="cursor-pointer hover:bg-accent/40" onClick={() => void openProduct(product.id)}>
                        <td className="px-4 py-3"><div className="relative h-12 w-12 overflow-hidden rounded-md bg-accent">{product.images?.[0]?.src ? <img alt={product.name} className="h-full w-full object-cover" src={product.images[0].src} /> : null}</div></td>
                        <td className="px-4 py-3"><div className="font-medium">{product.name}</div><div className="text-xs text-muted-foreground">{product.categories?.map((category) => category.name).join(", ") || "Sin categoría"}</div></td>
                        <td className="px-4 py-3">{product.sku || "-"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{product.slug || "-"}</td>
                        <td className="px-4 py-3">{displayPrice(product)}</td>
                        <td className="px-4 py-3">{product.manage_stock ? product.stock_quantity ?? 0 : product.stock_status}</td>
                        <td className="px-4 py-3"><Badge>{product.status === "publish" ? "Activo" : "Borrador"}</Badge></td>
                      </tr>
                    ))}
                    {products.length === 0 ? <tr><td className="px-4 py-6 text-muted-foreground" colSpan={7}>No hay productos para esta búsqueda.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">Página {page} de {pagination.total_pages}</div>
            <div className="flex gap-2">
              <Button className="flex-1 sm:flex-none" disabled={page <= 1 || !activeTenant} onClick={() => setPage((current) => current - 1)} variant="outline">Anterior</Button>
              <Button className="flex-1 sm:flex-none" disabled={page >= pagination.total_pages || !activeTenant} onClick={() => setPage((current) => current + 1)} variant="outline">Siguiente</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedProduct ? (
        <>
          <div className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm" onClick={() => setSelectedProduct(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-3xl overflow-y-auto border-l border-border bg-card p-5 shadow-2xl sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">{editorMode === "create" ? "Nuevo producto" : "Editor"}</div>
                <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">{editorMode === "create" ? "Crear producto unitario" : selectedProduct.name || "Producto sin nombre"}</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {editorSummary.map((item) => <Badge key={item} className="border border-border bg-background text-foreground">{item}</Badge>)}
                </div>
              </div>
              <button className="rounded-xl p-2 hover:bg-accent" onClick={() => setSelectedProduct(null)} type="button"><X className="h-5 w-5" /></button>
            </div>

            {panelLoading ? <div className="text-sm text-muted-foreground">Cargando producto...</div> : null}

            <div className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="rounded-2xl border border-border bg-background/70 p-4">
                  <div className="aspect-square overflow-hidden rounded-xl bg-accent">
                    {selectedProduct.images[0]?.src ? <img alt={selectedProduct.name || "Producto"} className="h-full w-full object-cover" src={selectedProduct.images[0].src} /> : null}
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                    {selectedProduct.id ? <div><span className="text-foreground">ID:</span> {selectedProduct.id}</div> : null}
                    <div><span className="text-foreground">Tipo:</span> {selectedProduct.type}</div>
                    <div><span className="text-foreground">Estado:</span> {selectedProduct.status === "publish" ? "Activo" : "Borrador"}</div>
                    <div><span className="text-foreground">Stock status:</span> {selectedProduct.stock_status}</div>
                    {selectedProduct.permalink ? (
                      <a className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline" href={selectedProduct.permalink} rel="noreferrer" target="_blank">
                        Ver producto
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2"><label className="text-sm font-medium">Nombre</label><Input className="h-12 rounded-xl" value={selectedProduct.name} onChange={(event) => setSelectedProduct({ ...selectedProduct, name: event.target.value })} /></div>
                  {editorMode === "edit" ? <div className="space-y-2"><label className="text-sm font-medium">SKU</label><Input className="h-12 rounded-xl" disabled value={selectedProduct.sku} /></div> : <div className="space-y-2"><label className="text-sm font-medium">SKU</label><Input className="h-12 rounded-xl" disabled placeholder="Se definirá automáticamente" value="" /></div>}
                  {editorMode === "edit" ? <div className="space-y-2"><label className="text-sm font-medium">Slug</label><Input className="h-12 rounded-xl" disabled value={selectedProduct.slug} /></div> : <div className="space-y-2"><label className="text-sm font-medium">Slug</label><Input className="h-12 rounded-xl" disabled placeholder="Se generará automáticamente" value="" /></div>}
                  <div className="space-y-2"><label className="text-sm font-medium">Estado</label><Select value={selectedProduct.status} onValueChange={(value) => setSelectedProduct({ ...selectedProduct, status: value as "publish" | "draft" })}><SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="publish">Activo</SelectItem><SelectItem value="draft">Borrador</SelectItem></SelectContent></Select></div>
                  <div className="space-y-2"><label className="text-sm font-medium">Stock status</label><Select value={selectedProduct.stock_status} onValueChange={(value) => setSelectedProduct({ ...selectedProduct, stock_status: value as "instock" | "outofstock" | "onbackorder" })}><SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="instock">En stock</SelectItem><SelectItem value="outofstock">Sin stock</SelectItem><SelectItem value="onbackorder">Sobre pedido</SelectItem></SelectContent></Select></div>
                  <div className="space-y-2"><label className="text-sm font-medium">Precio regular</label><Input className="h-12 rounded-xl" value={selectedProduct.regular_price} onChange={(event) => setSelectedProduct({ ...selectedProduct, regular_price: event.target.value })} /></div>
                  <div className="space-y-2"><label className="text-sm font-medium">Precio oferta</label><Input className="h-12 rounded-xl" value={selectedProduct.sale_price} onChange={(event) => setSelectedProduct({ ...selectedProduct, sale_price: event.target.value })} /></div>
                  <div className="space-y-2"><label className="text-sm font-medium">Peso</label><Input className="h-12 rounded-xl" value={selectedProduct.weight} onChange={(event) => setSelectedProduct({ ...selectedProduct, weight: event.target.value })} /></div>
                  <div className="space-y-2"><label className="text-sm font-medium">Stock</label><Input className="h-12 rounded-xl" disabled={!selectedProduct.manage_stock} type="number" value={selectedProduct.stock_quantity} onChange={(event) => setSelectedProduct({ ...selectedProduct, stock_quantity: event.target.value })} /></div>
                  <label className="flex items-center gap-3 rounded-xl border border-border bg-background/70 px-4 py-3 text-sm md:col-span-2">
                    <input checked={selectedProduct.manage_stock} onChange={(event) => setSelectedProduct({ ...selectedProduct, manage_stock: event.target.checked, stock_quantity: event.target.checked ? selectedProduct.stock_quantity : "" })} type="checkbox" />
                    Gestionar stock desde WooCommerce
                  </label>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2"><label className="text-sm font-medium">Largo</label><Input className="h-12 rounded-xl" value={selectedProduct.length} onChange={(event) => setSelectedProduct({ ...selectedProduct, length: event.target.value })} /></div>
                <div className="space-y-2"><label className="text-sm font-medium">Ancho</label><Input className="h-12 rounded-xl" value={selectedProduct.width} onChange={(event) => setSelectedProduct({ ...selectedProduct, width: event.target.value })} /></div>
                <div className="space-y-2"><label className="text-sm font-medium">Alto</label><Input className="h-12 rounded-xl" value={selectedProduct.height} onChange={(event) => setSelectedProduct({ ...selectedProduct, height: event.target.value })} /></div>
              </div>

              <div className="space-y-2"><label className="text-sm font-medium">Categorías por ID</label><Input className="h-12 rounded-xl" placeholder="77, 645, 812" value={selectedProduct.categoryIds} onChange={(event) => setSelectedProduct({ ...selectedProduct, categoryIds: event.target.value })} /></div>
              <div className="space-y-2"><label className="text-sm font-medium">Descripción corta</label><Textarea className="min-h-28 rounded-xl" value={selectedProduct.short_description} onChange={(event) => setSelectedProduct({ ...selectedProduct, short_description: event.target.value })} /></div>
              <div className="space-y-2"><label className="text-sm font-medium">Descripción completa</label><Textarea className="min-h-40 rounded-xl" value={selectedProduct.description} onChange={(event) => setSelectedProduct({ ...selectedProduct, description: event.target.value })} /></div>

              <div className="space-y-4 rounded-2xl border border-border bg-background/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-foreground">Imágenes</div>
                    <div className="text-sm text-muted-foreground">Administra la imagen principal y la galería del producto sin borrar archivos de la biblioteca.</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button className="rounded-xl" onClick={() => setShowMediaPicker("replace")} type="button" variant="outline">Cambiar imagen principal</Button>
                    <Button className="rounded-xl" onClick={() => setShowMediaPicker("append")} type="button"><ImagePlus className="mr-2 h-4 w-4" />Agregar imagen a galería</Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {selectedProduct.images.map((image, index) => (
                    <div key={`${image.id}-${index}`} className="overflow-hidden rounded-2xl border border-border bg-card">
                      <div className="aspect-square overflow-hidden bg-accent">
                        {image.src ? <img alt={image.name ?? `Imagen ${image.id}`} className="h-full w-full object-cover" src={image.src} /> : null}
                      </div>
                      <div className="space-y-2 p-3 text-sm">
                        <div className="line-clamp-2 font-medium">{index === 0 ? "Imagen principal" : image.name ?? `Imagen ${image.id}`}</div>
                        <div className="text-xs text-muted-foreground">Media ID: {image.id}</div>
                        <div className="flex gap-2">
                          {index !== 0 ? (
                            <Button className="flex-1 rounded-xl" onClick={() => setSelectedProduct({ ...selectedProduct, images: [image, ...selectedProduct.images.filter((item) => item.id !== image.id)] })} size="sm" variant="outline">
                              Hacer principal
                            </Button>
                          ) : null}
                          <Button className="rounded-xl" onClick={() => setSelectedProduct({ ...selectedProduct, images: selectedProduct.images.filter((item) => item.id !== image.id) })} size="sm" variant="outline">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {selectedProduct.images.length === 0 ? <div className="col-span-full rounded-2xl border border-border bg-card px-4 py-8 text-sm text-muted-foreground">Este producto no tiene imágenes asignadas todavía.</div> : null}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
                <div className="font-medium text-foreground">Información útil del backup</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>Slug: {selectedProduct.slug || "Se generará en WooCommerce"}</div>
                  <div>Permalink: {selectedProduct.permalink || "Se generará al guardar"}</div>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {selectedProduct.id ? <Button className="gap-2 rounded-xl" onClick={() => void copyValue(String(selectedProduct.id), "ID")} variant="outline"><Copy className="h-4 w-4" />Copiar ID</Button> : null}
                {selectedProduct.sku ? <Button className="gap-2 rounded-xl" onClick={() => void copyValue(selectedProduct.sku, "SKU")} variant="outline"><Copy className="h-4 w-4" />Copiar SKU</Button> : null}
                {selectedProduct.permalink ? <Button className="gap-2 rounded-xl" onClick={() => void copyValue(selectedProduct.permalink, "Enlace")} variant="outline"><Copy className="h-4 w-4" />Copiar enlace</Button> : null}
                <Button className="rounded-xl px-6 font-semibold" disabled={saving || !activeTenant} onClick={() => void saveProduct()}>{saving ? (editorMode === "create" ? "Creando..." : "Guardando...") : editorMode === "create" ? "Crear producto" : "Guardar cambios"}</Button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {showMediaPicker && selectedProduct && activeTenant ? (
        <>
          <div className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-sm" onClick={() => setShowMediaPicker(null)} />
          <div className="fixed inset-6 z-[80] overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-2xl sm:inset-10 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Galería</div>
                <h3 className="mt-2 text-2xl font-semibold">{showMediaPicker === "replace" ? "Cambiar imagen principal" : "Agregar imagen a galería"}</h3>
              </div>
              <button className="rounded-xl p-2 hover:bg-accent" onClick={() => setShowMediaPicker(null)} type="button"><X className="h-5 w-5" /></button>
            </div>
            <MediaLibraryBrowser mode="picker" onSelect={handleMediaSelect} selectedIds={selectedProduct.images.map((image) => image.id)} tenantId={activeTenant.id} />
          </div>
        </>
      ) : null}
    </div>
  );
}
