"use client";

import { useSearchParams } from "next/navigation";
import { Copy, Download, ExternalLink, ImagePlus, LoaderCircle, PackageSearch, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { MediaLibraryBrowser } from "@/components/MediaLibraryBrowser";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { apiRequest, FRONTEND_API_PREFIX, type AuthSession, type MediaItem, resolveActiveTenant, withTenantPath } from "@/lib/api";

type ProductStatus = "publish" | "draft" | "pending" | "private";
type ProductType = "simple" | "variable" | "grouped" | "external";
type StockStatus = "instock" | "outofstock" | "onbackorder";
type CatalogVisibility = "visible" | "catalog" | "search" | "hidden";
type BackordersStatus = "no" | "notify" | "yes";
type TabKey = "general" | "prices" | "description" | "inventory" | "shipping" | "images" | "attributes" | "related" | "meta" | "variations";

type TaxonomyItem = { id: number; name: string; slug: string };
type ProductImage = { id: number; src: string; name?: string; alt?: string };
type ProductAttribute = { id?: number; name?: string; position: number; visible: boolean; variation: boolean; options: string[] };
type ProductDownload = { name: string; file: string };
type ProductMetaData = { key: string; value: string };
type VariationAttribute = { id?: number; option: string };

type Product = {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  sku: string;
  type: ProductType | string;
  status: ProductStatus;
  featured: boolean;
  catalog_visibility: CatalogVisibility;
  regular_price: string;
  sale_price: string;
  date_on_sale_from: string | null;
  date_on_sale_to: string | null;
  price: string;
  description: string;
  short_description: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: StockStatus | string;
  backorders: BackordersStatus;
  sold_individually: boolean;
  low_stock_amount: number | null;
  weight: string;
  dimensions: { length: string; width: string; height: string };
  shipping_class: string;
  virtual: boolean;
  downloadable: boolean;
  images: ProductImage[];
  categories: TaxonomyItem[];
  tags: TaxonomyItem[];
  attributes: ProductAttribute[];
  upsell_ids: number[];
  cross_sell_ids: number[];
  downloads: ProductDownload[];
  download_limit: number | null;
  download_expiry: number | null;
  meta_data: Array<{ key: string; value: unknown }>;
};

type ProductVariation = {
  id?: number;
  sku: string;
  regular_price: string;
  sale_price: string;
  manage_stock: boolean;
  stock_quantity: string;
  stock_status: StockStatus;
  weight: string;
  length: string;
  width: string;
  height: string;
  image?: { id: number };
  image_src?: string;
  attributes: VariationAttribute[];
  virtual: boolean;
  downloadable: boolean;
  downloads: ProductDownload[];
  download_limit: string;
  download_expiry: string;
  meta_data: ProductMetaData[];
};

type ProductListResponse = { items: Product[]; page: number; page_size: number; total: number; total_pages: number };
type GlobalAttribute = { id: number; name: string; slug: string };
type AttributeTerm = { id: number; name: string; slug: string };
type EditorProduct = {
  id?: number;
  name: string;
  slug: string;
  permalink: string;
  sku: string;
  type: ProductType;
  status: ProductStatus;
  featured: boolean;
  catalog_visibility: CatalogVisibility;
  regular_price: string;
  sale_price: string;
  date_on_sale_from: string;
  date_on_sale_to: string;
  description: string;
  short_description: string;
  manage_stock: boolean;
  stock_quantity: string;
  stock_status: StockStatus;
  backorders: BackordersStatus;
  sold_individually: boolean;
  low_stock_amount: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  shipping_class: string;
  virtual: boolean;
  downloadable: boolean;
  images: ProductImage[];
  categories: number[];
  tags: number[];
  attributes: ProductAttribute[];
  upsell_ids: number[];
  cross_sell_ids: number[];
  downloads: ProductDownload[];
  download_limit: string;
  download_expiry: string;
  meta_data: ProductMetaData[];
};

type MediaPickerTarget =
  | { kind: "replace-main" }
  | { kind: "append-gallery" }
  | { kind: "variation-image"; variationIndex: number };

type ResolvedMediaResult = {
  requested: string;
  matched: boolean;
  item: MediaItem | null;
};

type PrefillImageResolution = {
  images: ProductImage[];
  unresolved: string[];
};

const tabs: Array<{ id: TabKey; label: string }> = [
  { id: "general", label: "General" },
  { id: "prices", label: "Precios" },
  { id: "description", label: "Descripción" },
  { id: "inventory", label: "Inventario" },
  { id: "shipping", label: "Envío" },
  { id: "images", label: "Imágenes" },
  { id: "attributes", label: "Atributos y variaciones" },
  { id: "related", label: "Relacionados" },
  { id: "meta", label: "Meta data" },
  { id: "variations", label: "Variaciones" }
];

function stripHtml(value: string | null | undefined) {
  return (value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function displayPrice(product: Product) {
  return product.sale_price || product.regular_price || product.price || "-";
}

function asText(value: unknown) {
  if (value == null) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const offset = parsed.getTimezoneOffset();
  const normalized = new Date(parsed.getTime() - offset * 60_000);
  return normalized.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function asImportBool(value: string | undefined) {
  return ["1", "true", "yes", "si", "sí"].includes((value ?? "").trim().toLowerCase());
}

function splitImportValues(value: string | undefined) {
  return (value ?? "").split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean);
}

function splitImportIds(value: string | undefined) {
  return splitImportValues(value).map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function importRowToEditorProduct(row: Record<string, string>): EditorProduct {
  const product = emptyProduct();
  product.sku = row.sku?.trim() ?? "";
  product.name = row.name?.trim() ?? "";
  product.slug = row.slug?.trim() ?? "";
  product.type = (["simple", "variable", "grouped", "external"].includes(row.type) ? row.type : "simple") as ProductType;
  product.status = (["publish", "draft", "pending", "private"].includes(row.status) ? row.status : "publish") as ProductStatus;
  product.featured = asImportBool(row.featured);
  product.catalog_visibility = (["visible", "catalog", "search", "hidden"].includes(row.catalog_visibility) ? row.catalog_visibility : "visible") as CatalogVisibility;
  product.regular_price = row.regular_price?.trim() ?? "";
  product.sale_price = row.sale_price?.trim() ?? "";
  product.description = row.description?.trim() ?? "";
  product.short_description = row.short_description?.trim() ?? "";
  product.manage_stock = asImportBool(row.manage_stock);
  product.stock_quantity = row.stock_quantity?.trim() ?? "";
  product.stock_status = (["instock", "outofstock", "onbackorder"].includes(row.stock_status) ? row.stock_status : "instock") as StockStatus;
  product.backorders = (["no", "notify", "yes"].includes(row.backorders) ? row.backorders : "no") as BackordersStatus;
  product.sold_individually = asImportBool(row.sold_individually);
  product.low_stock_amount = row.low_stock_amount?.trim() ?? "";
  product.weight = row.weight?.trim() ?? "";
  product.length = row.length?.trim() ?? "";
  product.width = row.width?.trim() ?? "";
  product.height = row.height?.trim() ?? "";
  product.shipping_class = row.shipping_class?.trim() ?? "";
  product.virtual = asImportBool(row.virtual);
  product.downloadable = asImportBool(row.downloadable);
  product.download_limit = row.download_limit?.trim() ?? "";
  product.download_expiry = row.download_expiry?.trim() ?? "";
  product.categories = splitImportIds(row.category_ids);
  product.tags = splitImportIds(row.tag_ids);
  product.upsell_ids = splitImportIds(row.upsell_ids);
  product.cross_sell_ids = splitImportIds(row.cross_sell_ids);

  const imageIds = [...splitImportIds(row.image_principal_id), ...splitImportIds(row.image_galeria_ids)];
  const imageNames = splitImportValues(row.image_nombres);
  product.images = imageIds.map((id, index) => ({ id, src: "", name: imageNames[index] ?? `Media ${id}` }));

  if (row.attr1_nombre?.trim() && splitImportValues(row.attr1_valores).length > 0) {
    product.attributes.push({
      name: row.attr1_nombre.trim(),
      position: 0,
      visible: true,
      variation: true,
      options: splitImportValues(row.attr1_valores)
    });
  }
  if (row.attr2_nombre?.trim() && splitImportValues(row.attr2_valores).length > 0) {
    product.attributes.push({
      name: row.attr2_nombre.trim(),
      position: 1,
      visible: true,
      variation: true,
      options: splitImportValues(row.attr2_valores)
    });
  }
  if (row.meta_key?.trim()) {
    product.meta_data = [{ key: row.meta_key.trim(), value: row.meta_value?.trim() ?? "" }];
  }
  return product;
}

async function resolvePrefillImages(tenantId: string, row: Record<string, string>): Promise<PrefillImageResolution> {
  const names = splitImportValues(row.image_nombres);
  const principalIds = splitImportIds(row.image_principal_id);
  const galleryIds = splitImportIds(row.image_galeria_ids);
  const orderedIds = [...principalIds, ...galleryIds];

  if (names.length === 0) {
    return {
      images: orderedIds.map((id, index) => ({
      id,
      src: "",
      name: index === 0 ? "Imagen principal" : `Galeria ${index}`,
      })),
      unresolved: []
    };
  }

  const response = await apiRequest<ResolvedMediaResult[]>(withTenantPath(tenantId, "/media/resolve"), {
    method: "POST",
    body: JSON.stringify({ names }),
  });

  const resolvedImages = response.data
    .filter((entry) => entry.matched && entry.item)
    .map((entry) => ({
      id: entry.item!.id,
      src: entry.item!.url,
      name: entry.item!.filename,
      alt: entry.item!.filename,
    }));

  const unresolved = response.data.filter((entry) => !entry.matched).map((entry) => entry.requested);
  if (resolvedImages.length > 0) {
    return { images: resolvedImages, unresolved };
  }

  return {
    images: orderedIds.map((id, index) => ({
      id,
      src: "",
      name: names[index] ?? (index === 0 ? "Imagen principal" : `Galeria ${index}`),
    })),
    unresolved
  };
}

async function resolveSelectedProductImages(tenantId: string, product: EditorProduct): Promise<PrefillImageResolution> {
  const names = product.images.map((image) => image.name).filter((name): name is string => Boolean(name?.trim()));
  if (names.length === 0) {
    return { images: product.images, unresolved: [] };
  }
  return resolvePrefillImages(tenantId, {
    image_nombres: names.join(", "),
    image_principal_id: product.images[0]?.id ? String(product.images[0].id) : "",
    image_galeria_ids: product.images.slice(1).map((image) => image.id).join(";")
  });
}

function emptyProduct(): EditorProduct {
  return {
    name: "",
    slug: "",
    permalink: "",
    sku: "",
    type: "simple",
    status: "publish",
    featured: false,
    catalog_visibility: "visible",
    regular_price: "",
    sale_price: "",
    date_on_sale_from: "",
    date_on_sale_to: "",
    description: "",
    short_description: "",
    manage_stock: false,
    stock_quantity: "",
    stock_status: "instock",
    backorders: "no",
    sold_individually: false,
    low_stock_amount: "",
    weight: "",
    length: "",
    width: "",
    height: "",
    shipping_class: "",
    virtual: false,
    downloadable: false,
    images: [],
    categories: [],
    tags: [],
    attributes: [],
    upsell_ids: [],
    cross_sell_ids: [],
    downloads: [],
    download_limit: "",
    download_expiry: "",
    meta_data: []
  };
}

function toEditorProduct(product?: Product): EditorProduct {
  if (!product) {
    return emptyProduct();
  }
  return {
    id: product.id,
    name: product.name ?? "",
    slug: product.slug ?? "",
    permalink: product.permalink ?? "",
    sku: product.sku ?? "",
    type: (["simple", "variable", "grouped", "external"].includes(product.type) ? product.type : "simple") as ProductType,
    status: product.status ?? "publish",
    featured: Boolean(product.featured),
    catalog_visibility: product.catalog_visibility ?? "visible",
    regular_price: product.regular_price ?? "",
    sale_price: product.sale_price ?? "",
    date_on_sale_from: toDateTimeLocal(product.date_on_sale_from),
    date_on_sale_to: toDateTimeLocal(product.date_on_sale_to),
    description: product.description ?? "",
    short_description: product.short_description ?? "",
    manage_stock: Boolean(product.manage_stock),
    stock_quantity: product.stock_quantity == null ? "" : String(product.stock_quantity),
    stock_status: (["instock", "outofstock", "onbackorder"].includes(product.stock_status) ? product.stock_status : "instock") as StockStatus,
    backorders: product.backorders ?? "no",
    sold_individually: Boolean(product.sold_individually),
    low_stock_amount: product.low_stock_amount == null ? "" : String(product.low_stock_amount),
    weight: product.weight ?? "",
    length: product.dimensions?.length ?? "",
    width: product.dimensions?.width ?? "",
    height: product.dimensions?.height ?? "",
    shipping_class: product.shipping_class ?? "",
    virtual: Boolean(product.virtual),
    downloadable: Boolean(product.downloadable),
    images: product.images ?? [],
    categories: (product.categories ?? []).map((item) => item.id),
    tags: (product.tags ?? []).map((item) => item.id),
    attributes: (product.attributes ?? []).map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      position: attribute.position ?? 0,
      visible: Boolean(attribute.visible),
      variation: Boolean(attribute.variation),
      options: attribute.options ?? []
    })),
    upsell_ids: product.upsell_ids ?? [],
    cross_sell_ids: product.cross_sell_ids ?? [],
    downloads: (product.downloads ?? []).map((download) => ({ name: download.name ?? "", file: download.file ?? "" })),
    download_limit: product.download_limit == null ? "" : String(product.download_limit),
    download_expiry: product.download_expiry == null ? "" : String(product.download_expiry),
    meta_data: (product.meta_data ?? []).map((item) => ({ key: item.key ?? "", value: asText(item.value) }))
  };
}

function emptyVariation(): ProductVariation {
  return {
    sku: "",
    regular_price: "",
    sale_price: "",
    manage_stock: false,
    stock_quantity: "",
    stock_status: "instock",
    weight: "",
    length: "",
    width: "",
    height: "",
    attributes: [],
    virtual: false,
    downloadable: false,
    downloads: [],
    download_limit: "",
    download_expiry: "",
    meta_data: []
  };
}

function toEditorVariation(variation: any): ProductVariation {
  return {
    id: variation.id,
    sku: variation.sku ?? "",
    regular_price: variation.regular_price ?? "",
    sale_price: variation.sale_price ?? "",
    manage_stock: Boolean(variation.manage_stock),
    stock_quantity: variation.stock_quantity == null ? "" : String(variation.stock_quantity),
    stock_status: (["instock", "outofstock", "onbackorder"].includes(variation.stock_status) ? variation.stock_status : "instock") as StockStatus,
    weight: variation.weight ?? "",
    length: variation.dimensions?.length ?? "",
    width: variation.dimensions?.width ?? "",
    height: variation.dimensions?.height ?? "",
    image: variation.image?.id ? { id: variation.image.id } : undefined,
    image_src: variation.image?.src ?? variation.image?.source ?? variation.image?.url ?? undefined,
    attributes: (variation.attributes ?? []).map((attribute: any) => ({ id: attribute.id, option: attribute.option ?? "" })),
    virtual: Boolean(variation.virtual),
    downloadable: Boolean(variation.downloadable),
    downloads: (variation.downloads ?? []).map((item: any) => ({ name: item.name ?? "", file: item.file ?? "" })),
    download_limit: variation.download_limit == null ? "" : String(variation.download_limit),
    download_expiry: variation.download_expiry == null ? "" : String(variation.download_expiry),
    meta_data: (variation.meta_data ?? []).map((item: any) => ({ key: item.key ?? "", value: asText(item.value) }))
  };
}

function buildPayload(product: EditorProduct) {
  return {
    name: product.name.trim(),
    slug: product.slug.trim() || null,
    sku: product.sku.trim() || null,
    type: product.type,
    status: product.status,
    featured: product.featured,
    catalog_visibility: product.catalog_visibility,
    regular_price: product.regular_price.trim() || null,
    sale_price: product.sale_price.trim() || null,
    date_on_sale_from: fromDateTimeLocal(product.date_on_sale_from),
    date_on_sale_to: fromDateTimeLocal(product.date_on_sale_to),
    description: product.description,
    short_description: product.short_description,
    manage_stock: product.manage_stock,
    stock_quantity: product.manage_stock && product.stock_quantity !== "" ? Number(product.stock_quantity) : null,
    stock_status: product.stock_status,
    backorders: product.backorders,
    sold_individually: product.sold_individually,
    low_stock_amount: product.low_stock_amount.trim() ? Number(product.low_stock_amount) : null,
    weight: product.weight.trim() || null,
    dimensions: {
      length: product.length.trim(),
      width: product.width.trim(),
      height: product.height.trim()
    },
    shipping_class: product.shipping_class.trim() || null,
    virtual: product.virtual,
    downloadable: product.downloadable,
    images: product.images.map((image) => ({ id: image.id })),
    categories: product.categories.map((id) => ({ id })),
    tags: product.tags.map((id) => ({ id })),
    attributes: product.attributes.map((attribute) => ({
      id: attribute.id ?? null,
      name: attribute.name ?? null,
      position: attribute.position,
      visible: attribute.visible,
      variation: attribute.variation,
      options: attribute.options.filter(Boolean)
    })),
    upsell_ids: product.upsell_ids,
    cross_sell_ids: product.cross_sell_ids,
    downloads: product.downloads.filter((item) => item.name.trim() && item.file.trim()),
    download_limit: product.download_limit.trim() ? Number(product.download_limit) : null,
    download_expiry: product.download_expiry.trim() ? Number(product.download_expiry) : null,
    meta_data: product.meta_data.filter((item) => item.key.trim()).map((item) => ({ key: item.key.trim(), value: item.value }))
  };
}

function buildVariationPayload(variation: ProductVariation) {
  return {
    sku: variation.sku.trim() || null,
    regular_price: variation.regular_price.trim() || null,
    sale_price: variation.sale_price.trim() || null,
    manage_stock: variation.manage_stock,
    stock_quantity: variation.manage_stock && variation.stock_quantity !== "" ? Number(variation.stock_quantity) : null,
    stock_status: variation.stock_status,
    weight: variation.weight.trim() || null,
    dimensions: {
      length: variation.length.trim(),
      width: variation.width.trim(),
      height: variation.height.trim()
    },
    image: variation.image?.id ? { id: variation.image.id } : null,
    attributes: variation.attributes.filter((item) => item.option.trim()).map((item) => ({ id: item.id, option: item.option.trim() })),
    virtual: variation.virtual,
    downloadable: variation.downloadable,
    downloads: variation.downloads.filter((item) => item.name.trim() && item.file.trim()),
    download_limit: variation.download_limit.trim() ? Number(variation.download_limit) : null,
    download_expiry: variation.download_expiry.trim() ? Number(variation.download_expiry) : null,
    meta_data: variation.meta_data.filter((item) => item.key.trim()).map((item) => ({ key: item.key.trim(), value: item.value }))
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-background/60 p-4 sm:p-5">
      <div className="mb-4">
        <div className="font-medium text-foreground">{title}</div>
        {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

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

export default function ProductsPage() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<TaxonomyItem[]>([]);
  const [tags, setTags] = useState<TaxonomyItem[]>([]);
  const [globalAttributes, setGlobalAttributes] = useState<GlobalAttribute[]>([]);
  const [attributeTerms, setAttributeTerms] = useState<Record<number, AttributeTerm[]>>({});
  const [relatedResults, setRelatedResults] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<EditorProduct | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("edit");
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [panelLoading, setPanelLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingReferences, setLoadingReferences] = useState(false);
  const [mediaPickerTarget, setMediaPickerTarget] = useState<MediaPickerTarget | null>(null);
  const [variations, setVariations] = useState<ProductVariation[]>([]);
  const [variationsLoading, setVariationsLoading] = useState(false);
  const [variationSavingIndex, setVariationSavingIndex] = useState<number | null>(null);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 1 });
  const [relatedSearch, setRelatedSearch] = useState("");
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [importPrefillConsumed, setImportPrefillConsumed] = useState(false);
  const [importPrefillStatus, setImportPrefillStatus] = useState<string | null>(null);
  const [saveOperationStatus, setSaveOperationStatus] = useState<string | null>(null);
  const [saveOperationError, setSaveOperationError] = useState<string | null>(null);
  const [saveOperationProgress, setSaveOperationProgress] = useState(0);
  const [saveOperationMode, setSaveOperationMode] = useState<"create" | "edit" | "images" | null>(null);
  const saveOperationIntervalRef = useRef<number | null>(null);

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

  const loadReferenceData = async (tenantId: string) => {
    setLoadingReferences(true);
    try {
      const [categoriesResponse, tagsResponse, attributesResponse] = await Promise.all([
        apiRequest<TaxonomyItem[]>(withTenantPath(tenantId, "/categories"), { cache: "no-store" }),
        apiRequest<TaxonomyItem[]>(withTenantPath(tenantId, "/tags"), { cache: "no-store" }),
        apiRequest<GlobalAttribute[]>(withTenantPath(tenantId, "/attributes"), { cache: "no-store" })
      ]);
      setCategories(categoriesResponse.data);
      setTags(tagsResponse.data);
      setGlobalAttributes(attributesResponse.data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudieron cargar categorías, etiquetas y atributos", "error");
    } finally {
      setLoadingReferences(false);
    }
  };

  const ensureAttributeTerms = async (attributeId: number) => {
    if (!activeTenant || attributeTerms[attributeId]) {
      return;
    }
    try {
      const response = await apiRequest<AttributeTerm[]>(withTenantPath(activeTenant.id, `/attributes/${attributeId}/terms`), { cache: "no-store" });
      setAttributeTerms((current) => ({ ...current, [attributeId]: response.data }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudieron cargar los términos del atributo", "error");
    }
  };

  const loadVariations = async (productId: number) => {
    if (!activeTenant) {
      return;
    }
    setVariationsLoading(true);
    try {
      const response = await apiRequest<any[]>(withTenantPath(activeTenant.id, `/products/${productId}/variations`), { cache: "no-store" });
      setVariations(response.data.map(toEditorVariation));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudieron cargar las variaciones", "error");
    } finally {
      setVariationsLoading(false);
    }
  };

  useEffect(() => {
    void loadProducts();
  }, [page, searchTerm]);

  useEffect(() => {
    if (activeTenant) {
      void loadReferenceData(activeTenant.id);
    }
  }, [activeTenant?.id]);

  useEffect(() => {
    if (!activeTenant || importPrefillConsumed || searchParams.get("create") !== "import") {
      return;
    }

    const consumePrefill = async () => {
      const raw = window.sessionStorage.getItem("woolas.import.prefill");
      if (!raw) {
        setImportPrefillConsumed(true);
        return;
      }
      try {
        const payload = JSON.parse(raw) as { tenantId?: string; row?: Record<string, string> };
        if (payload.tenantId !== activeTenant.id || !payload.row) {
          setImportPrefillConsumed(true);
          return;
        }
        setImportPrefillStatus("Preparando producto desde el Excel importado...");
        const nextProduct = importRowToEditorProduct(payload.row);
        setImportPrefillStatus("Resolviendo imágenes del producto en la media library...");
        const imageResolution = await resolvePrefillImages(activeTenant.id, payload.row);
        nextProduct.images = imageResolution.images;
        if (imageResolution.unresolved.length > 0) {
          setImportPrefillStatus(`No se encontraron estas imágenes: ${imageResolution.unresolved.join(", ")}`);
        } else if (imageResolution.images.length === 0) {
          setImportPrefillStatus("No se encontraron imágenes para este producto en la media library.");
        } else {
          setImportPrefillStatus(`Se resolvieron ${imageResolution.images.length} imágenes. Abriendo el editor...`);
        }
        setEditorMode("create");
        setActiveTab("general");
        setPanelLoading(false);
        setVariations([]);
        setSelectedProduct(nextProduct);
        window.sessionStorage.removeItem("woolas.import.prefill");
      } catch {
        setImportPrefillStatus("No se pudo preparar el producto desde el Excel importado.");
        window.sessionStorage.removeItem("woolas.import.prefill");
      } finally {
        setImportPrefillConsumed(true);
        window.setTimeout(() => setImportPrefillStatus(null), 2500);
      }
    };

    void consumePrefill();
  }, [activeTenant, importPrefillConsumed, searchParams]);

  useEffect(() => {
    if (!selectedProduct) {
      return;
    }
    selectedProduct.attributes.forEach((attribute) => {
      if (attribute.id) {
        void ensureAttributeTerms(attribute.id);
      }
    });
  }, [selectedProduct, activeTenant?.id]);

  const openProduct = async (productId: number, preserveTab = false) => {
    if (!activeTenant) {
      return;
    }
    setEditorMode("edit");
    if (!preserveTab) {
      setActiveTab("general");
    }
    setPanelLoading(true);
    setVariations([]);
    try {
      const response = await apiRequest<Product>(withTenantPath(activeTenant.id, `/products/${productId}`), { cache: "no-store" });
      const product = toEditorProduct(response.data);
      setSelectedProduct(product);
      if (product.type === "variable") {
        await loadVariations(productId);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo cargar el producto", "error");
    } finally {
      setPanelLoading(false);
    }
  };

  const openCreateProduct = () => {
    setEditorMode("create");
    setActiveTab("general");
    setPanelLoading(false);
    setVariations([]);
    setSelectedProduct(emptyProduct());
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
    setSaveOperationError(null);
    setSaveOperationProgress(10);
    setSaveOperationMode(selectedProduct.images.length > 0 ? "images" : editorMode);
    setSaveOperationStatus(
      selectedProduct.images.length > 0
        ? `Editando imágenes de ${selectedProduct.name.trim()}...`
        : `${editorMode === "create" ? "Creando" : "Guardando"} producto ${selectedProduct.name.trim()}...`
    );
    if (saveOperationIntervalRef.current) {
      window.clearInterval(saveOperationIntervalRef.current);
    }
    saveOperationIntervalRef.current = window.setInterval(() => {
      setSaveOperationProgress((current) => (current >= 90 ? current : current + 6));
    }, 350);
    try {
      let productToSave = selectedProduct;
      if (selectedProduct.images.length > 0) {
        setSaveOperationStatus(`Validando imágenes de ${selectedProduct.name.trim()} en la media library...`);
        const imageResolution = await resolveSelectedProductImages(activeTenant.id, selectedProduct);
        if (imageResolution.images.length > 0) {
          productToSave = { ...selectedProduct, images: imageResolution.images };
          setSelectedProduct(productToSave);
        }
        if (imageResolution.unresolved.length > 0) {
          setSaveOperationError(`No se encontraron estas imágenes: ${imageResolution.unresolved.join(", ")}`);
          setSaveOperationStatus(`Imágenes no resueltas para ${selectedProduct.name.trim()}`);
        } else {
          setSaveOperationStatus(`Imágenes validadas para ${selectedProduct.name.trim()}`);
        }
      }
      const response = editorMode === "create"
        ? await apiRequest<Product>(withTenantPath(activeTenant.id, "/products"), { method: "POST", body: JSON.stringify(buildPayload(productToSave)) })
        : await apiRequest<Product>(withTenantPath(activeTenant.id, `/products/${selectedProduct.id}`), { method: "PUT", body: JSON.stringify(buildPayload(productToSave)) });

      const product = toEditorProduct(response.data);
      setSelectedProduct(product);
      setEditorMode("edit");
      if (product.type === "variable" && response.data.id) {
        await loadVariations(response.data.id);
      }
      setSaveOperationProgress(100);
      setSaveOperationStatus(editorMode === "create" ? `Producto ${selectedProduct.name.trim()} creado` : `Producto ${selectedProduct.name.trim()} actualizado`);
      showToast(editorMode === "create" ? "Producto creado" : "Producto actualizado");
      await loadProducts(session ?? undefined);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo guardar", "error");
      setSaveOperationError(err instanceof Error ? err.message : "No se pudo guardar");
      setSaveOperationStatus(`Error al guardar ${selectedProduct.name.trim()}`);
      setSaveOperationProgress(100);
    } finally {
      setSaving(false);
      if (saveOperationIntervalRef.current) {
        window.clearInterval(saveOperationIntervalRef.current);
      }
      window.setTimeout(() => {
        setSaveOperationStatus(null);
        setSaveOperationError(null);
        setSaveOperationProgress(0);
      }, 1600);
    }
  };

  const copyValue = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    showToast(`${label} copiado`);
  };

  const handleMediaSelect = (item: MediaItem) => {
    if (!selectedProduct || !mediaPickerTarget) {
      return;
    }
    const nextImage = { id: item.id, src: item.url, name: item.filename };
    if (mediaPickerTarget.kind === "replace-main") {
      setSelectedProduct({ ...selectedProduct, images: [nextImage, ...selectedProduct.images.filter((image) => image.id !== item.id)] });
    }
    if (mediaPickerTarget.kind === "append-gallery") {
      if (selectedProduct.images.some((image) => image.id === item.id)) {
        showToast("Esa imagen ya está asignada al producto", "error");
        return;
      }
      setSelectedProduct({ ...selectedProduct, images: [...selectedProduct.images, nextImage] });
    }
    if (mediaPickerTarget.kind === "variation-image") {
      setVariations((current) => current.map((variation, index) => index === mediaPickerTarget.variationIndex ? { ...variation, image: { id: item.id }, image_src: item.url } : variation));
    }
    setMediaPickerTarget(null);
  };

  const editorSummary = useMemo(() => {
    if (!selectedProduct) {
      return [] as string[];
    }
    return [
      selectedProduct.sku ? `SKU ${selectedProduct.sku}` : null,
      selectedProduct.slug ? `Slug ${selectedProduct.slug}` : null,
      selectedProduct.type === "variable" ? "Producto variable" : selectedProduct.type,
      selectedProduct.manage_stock ? `Stock ${selectedProduct.stock_quantity || 0}` : `Estado ${selectedProduct.stock_status}`
    ].filter(Boolean) as string[];
  }, [selectedProduct]);

  const variationAttributes = selectedProduct?.attributes.filter((attribute) => attribute.variation) ?? [];

  const updateSelectedProduct = (next: EditorProduct) => {
    setSelectedProduct(next);
  };

  const toggleTaxonomy = (field: "categories" | "tags", id: number) => {
    if (!selectedProduct) {
      return;
    }
    const values = selectedProduct[field];
    updateSelectedProduct({ ...selectedProduct, [field]: values.includes(id) ? values.filter((item) => item !== id) : [...values, id] });
  };

  const addGlobalAttributeToProduct = (attributeId: string) => {
    if (!selectedProduct) {
      return;
    }
    const found = globalAttributes.find((item) => String(item.id) === attributeId);
    if (!found || selectedProduct.attributes.some((item) => item.id === found.id)) {
      return;
    }
    updateSelectedProduct({
      ...selectedProduct,
      attributes: [...selectedProduct.attributes, { id: found.id, name: found.name, position: selectedProduct.attributes.length, visible: true, variation: false, options: [] }]
    });
    void ensureAttributeTerms(found.id);
  };

  const searchRelatedProducts = async () => {
    if (!activeTenant || !relatedSearch.trim()) {
      setRelatedResults([]);
      return;
    }
    setRelatedLoading(true);
    try {
      const query = new URLSearchParams({ page: "1", search: relatedSearch.trim() });
      const response = await apiRequest<ProductListResponse>(`${withTenantPath(activeTenant.id, "/products")}?${query.toString()}`, { cache: "no-store" });
      setRelatedResults(response.data.items.slice(0, 12));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo buscar productos relacionados", "error");
    } finally {
      setRelatedLoading(false);
    }
  };

  const handleExportProducts = async () => {
    if (!activeTenant) {
      return;
    }
    try {
      await downloadFile(withTenantPath(activeTenant.id, "/products/export"), "productos_woocommerce.xlsx");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo descargar el Excel", "error");
    }
  };

  const toggleRelatedProduct = (field: "upsell_ids" | "cross_sell_ids", productId: number) => {
    if (!selectedProduct || selectedProduct.id === productId) {
      return;
    }
    const values = selectedProduct[field];
    updateSelectedProduct({ ...selectedProduct, [field]: values.includes(productId) ? values.filter((item) => item !== productId) : [...values, productId] });
  };

  const addVariation = () => {
    setVariations((current) => [...current, emptyVariation()]);
  };

  const saveVariation = async (variation: ProductVariation, index: number) => {
    if (!activeTenant || !selectedProduct?.id) {
      return;
    }
    setVariationSavingIndex(index);
    try {
      const response = variation.id
        ? await apiRequest<any>(withTenantPath(activeTenant.id, `/products/${selectedProduct.id}/variations/${variation.id}`), { method: "PUT", body: JSON.stringify(buildVariationPayload(variation)) })
        : await apiRequest<any>(withTenantPath(activeTenant.id, `/products/${selectedProduct.id}/variations`), { method: "POST", body: JSON.stringify(buildVariationPayload(variation)) });
      setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? toEditorVariation(response.data) : item));
      await openProduct(selectedProduct.id, true);
      showToast(variation.id ? "Variación actualizada" : "Variación creada");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo guardar la variación", "error");
    } finally {
      setVariationSavingIndex(null);
    }
  };

  const deleteVariation = async (variation: ProductVariation, index: number) => {
    if (!activeTenant || !selectedProduct?.id) {
      return;
    }
    if (!variation.id) {
      setVariations((current) => current.filter((_, itemIndex) => itemIndex !== index));
      return;
    }
    setVariationSavingIndex(index);
    try {
      await apiRequest(withTenantPath(activeTenant.id, `/products/${selectedProduct.id}/variations/${variation.id}`), { method: "DELETE" });
      setVariations((current) => current.filter((_, itemIndex) => itemIndex !== index));
      await openProduct(selectedProduct.id, true);
      showToast("Variación eliminada");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo eliminar la variación", "error");
    } finally {
      setVariationSavingIndex(null);
    }
  };

  return (
    <div className="relative space-y-6 lg:space-y-8">
      <section className="rounded-3xl border border-border/80 bg-card/85 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Productos</div>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Catálogo WooCommerce completo</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              {activeTenant ? `Gestiona productos, atributos, imágenes y variaciones de ${activeTenant.name} usando el backup como base del módulo.` : "Selecciona un cliente activo para explorar productos."}
            </p>
          </div>
          <div className="flex w-full max-w-4xl flex-col gap-3 sm:flex-row sm:flex-wrap">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-12 rounded-xl pl-9" placeholder="Buscar por nombre, SKU o slug" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Button className="h-12 rounded-xl px-6 font-semibold" disabled={!activeTenant} onClick={() => { setPage(1); setSearchTerm(search.trim()); }}>
              Buscar
            </Button>
            <Button className="h-12 rounded-xl px-6 font-semibold" disabled={!activeTenant} onClick={() => void handleExportProducts()} variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Descargar Excel
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
                  <button key={product.id} className="rounded-2xl border border-border bg-background/70 p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/20" onClick={() => void openProduct(product.id)} type="button">
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
                          <span className="rounded-full bg-accent px-2.5 py-1">{product.type}</span>
                        </div>
                      </div>
                      <Badge>{product.status}</Badge>
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
                      <th className="px-4 py-3 text-left font-medium">Tipo</th>
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
                        <td className="px-4 py-3">{product.type}</td>
                        <td className="px-4 py-3">{displayPrice(product)}</td>
                        <td className="px-4 py-3">{product.manage_stock ? product.stock_quantity ?? 0 : product.stock_status}</td>
                        <td className="px-4 py-3"><Badge>{product.status}</Badge></td>
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
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-6xl overflow-y-auto border-l border-border bg-card p-5 shadow-2xl sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">{editorMode === "create" ? "Nuevo producto" : "Editor completo"}</div>
                <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">{editorMode === "create" ? "Crear producto WooCommerce" : selectedProduct.name || "Producto sin nombre"}</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {editorSummary.map((item) => <Badge key={item} className="border border-border bg-background text-foreground">{item}</Badge>)}
                  {loadingReferences ? <Badge className="border border-border bg-background text-foreground">Cargando referencias...</Badge> : null}
                </div>
              </div>
              <button className="rounded-xl p-2 hover:bg-accent" onClick={() => setSelectedProduct(null)} type="button"><X className="h-5 w-5" /></button>
            </div>

            {panelLoading ? <div className="text-sm text-muted-foreground">Cargando producto...</div> : null}

            {!panelLoading ? (
              <div className="space-y-6">
                <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="rounded-2xl border border-border bg-background/70 p-4">
                    <div className="aspect-square overflow-hidden rounded-xl bg-accent">
                      {selectedProduct.images[0]?.src ? <img alt={selectedProduct.name || "Producto"} className="h-full w-full object-cover" src={selectedProduct.images[0].src} /> : null}
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                      {selectedProduct.id ? <div><span className="text-foreground">ID:</span> {selectedProduct.id}</div> : null}
                      <div><span className="text-foreground">Tipo:</span> {selectedProduct.type}</div>
                      <div><span className="text-foreground">Estado:</span> {selectedProduct.status}</div>
                      <div><span className="text-foreground">Visibilidad:</span> {selectedProduct.catalog_visibility}</div>
                      {selectedProduct.permalink ? <a className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline" href={selectedProduct.permalink} rel="noreferrer" target="_blank">Ver producto<ExternalLink className="h-3.5 w-3.5" /></a> : null}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {tabs.filter((tab) => tab.id !== "variations" || selectedProduct.type === "variable").map((tab) => (
                        <button key={tab.id} type="button" className={["rounded-full border px-4 py-2 text-sm transition-colors", activeTab === tab.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent"].join(" ")} onClick={() => setActiveTab(tab.id)}>
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {activeTab === "general" ? (
                      <Section title="General" description="Campos principales del producto base en WooCommerce.">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2 md:col-span-2"><label className="text-sm font-medium">Nombre</label><Input className="h-12 rounded-xl" value={selectedProduct.name} onChange={(event) => updateSelectedProduct({ ...selectedProduct, name: event.target.value })} /></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Slug</label><Input className="h-12 rounded-xl" value={selectedProduct.slug} onChange={(event) => updateSelectedProduct({ ...selectedProduct, slug: event.target.value })} /></div>
                          <div className="space-y-2"><label className="text-sm font-medium">SKU</label><Input className="h-12 rounded-xl" disabled value={selectedProduct.sku} /></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Tipo</label><Select value={selectedProduct.type} onValueChange={(value) => updateSelectedProduct({ ...selectedProduct, type: value as ProductType })}><SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="simple">Simple</SelectItem><SelectItem value="variable">Variable</SelectItem><SelectItem value="grouped">Grouped</SelectItem><SelectItem value="external">External</SelectItem></SelectContent></Select></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Estado</label><Select value={selectedProduct.status} onValueChange={(value) => updateSelectedProduct({ ...selectedProduct, status: value as ProductStatus })}><SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="publish">Publish</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="private">Private</SelectItem></SelectContent></Select></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Visibilidad catálogo</label><Select value={selectedProduct.catalog_visibility} onValueChange={(value) => updateSelectedProduct({ ...selectedProduct, catalog_visibility: value as CatalogVisibility })}><SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="visible">Visible</SelectItem><SelectItem value="catalog">Catalog</SelectItem><SelectItem value="search">Search</SelectItem><SelectItem value="hidden">Hidden</SelectItem></SelectContent></Select></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Clase de envío</label><Input className="h-12 rounded-xl" value={selectedProduct.shipping_class} onChange={(event) => updateSelectedProduct({ ...selectedProduct, shipping_class: event.target.value })} /></div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <label className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm"><input checked={selectedProduct.featured} onChange={(event) => updateSelectedProduct({ ...selectedProduct, featured: event.target.checked })} type="checkbox" />Destacado</label>
                          <label className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm"><input checked={selectedProduct.virtual} onChange={(event) => updateSelectedProduct({ ...selectedProduct, virtual: event.target.checked })} type="checkbox" />Virtual</label>
                          <label className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm"><input checked={selectedProduct.downloadable} onChange={(event) => updateSelectedProduct({ ...selectedProduct, downloadable: event.target.checked })} type="checkbox" />Descargable</label>
                          <label className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm"><input checked={selectedProduct.sold_individually} onChange={(event) => updateSelectedProduct({ ...selectedProduct, sold_individually: event.target.checked })} type="checkbox" />Vender individualmente</label>
                        </div>
                      </Section>
                    ) : null}

                    {activeTab === "prices" ? (
                      <Section title="Precios" description="Precios regulares, oferta y ventana de promoción.">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2"><label className="text-sm font-medium">Precio regular</label><Input className="h-12 rounded-xl" value={selectedProduct.regular_price} onChange={(event) => updateSelectedProduct({ ...selectedProduct, regular_price: event.target.value })} /></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Precio oferta</label><Input className="h-12 rounded-xl" value={selectedProduct.sale_price} onChange={(event) => updateSelectedProduct({ ...selectedProduct, sale_price: event.target.value })} /></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Oferta desde</label><Input className="h-12 rounded-xl" type="datetime-local" value={selectedProduct.date_on_sale_from} onChange={(event) => updateSelectedProduct({ ...selectedProduct, date_on_sale_from: event.target.value })} /></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Oferta hasta</label><Input className="h-12 rounded-xl" type="datetime-local" value={selectedProduct.date_on_sale_to} onChange={(event) => updateSelectedProduct({ ...selectedProduct, date_on_sale_to: event.target.value })} /></div>
                        </div>
                      </Section>
                    ) : null}

                    {activeTab === "description" ? (
                      <Section title="Descripción" description="Contenido corto y largo enviado a WooCommerce.">
                        <div className="space-y-2"><label className="text-sm font-medium">Descripción corta</label><Textarea className="min-h-28 rounded-xl" value={selectedProduct.short_description} onChange={(event) => updateSelectedProduct({ ...selectedProduct, short_description: event.target.value })} /></div>
                        <div className="space-y-2"><label className="text-sm font-medium">Descripción completa</label><Textarea className="min-h-44 rounded-xl" value={selectedProduct.description} onChange={(event) => updateSelectedProduct({ ...selectedProduct, description: event.target.value })} /></div>
                      </Section>
                    ) : null}

                    {activeTab === "inventory" ? (
                      <Section title="Inventario" description="Control de stock, backorders y alertas.">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2"><label className="text-sm font-medium">Estado de stock</label><Select value={selectedProduct.stock_status} onValueChange={(value) => updateSelectedProduct({ ...selectedProduct, stock_status: value as StockStatus })}><SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="instock">In stock</SelectItem><SelectItem value="outofstock">Out of stock</SelectItem><SelectItem value="onbackorder">On backorder</SelectItem></SelectContent></Select></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Backorders</label><Select value={selectedProduct.backorders} onValueChange={(value) => updateSelectedProduct({ ...selectedProduct, backorders: value as BackordersStatus })}><SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="no">No</SelectItem><SelectItem value="notify">Notify</SelectItem><SelectItem value="yes">Yes</SelectItem></SelectContent></Select></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Cantidad</label><Input className="h-12 rounded-xl" disabled={!selectedProduct.manage_stock} type="number" value={selectedProduct.stock_quantity} onChange={(event) => updateSelectedProduct({ ...selectedProduct, stock_quantity: event.target.value })} /></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Low stock amount</label><Input className="h-12 rounded-xl" type="number" value={selectedProduct.low_stock_amount} onChange={(event) => updateSelectedProduct({ ...selectedProduct, low_stock_amount: event.target.value })} /></div>
                        </div>
                        <label className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm"><input checked={selectedProduct.manage_stock} onChange={(event) => updateSelectedProduct({ ...selectedProduct, manage_stock: event.target.checked, stock_quantity: event.target.checked ? selectedProduct.stock_quantity : "" })} type="checkbox" />Gestionar stock desde WooCommerce</label>
                      </Section>
                    ) : null}

                    {activeTab === "shipping" ? (
                      <Section title="Envío" description="Peso y dimensiones del producto.">
                        <div className="grid gap-4 md:grid-cols-4">
                          <div className="space-y-2"><label className="text-sm font-medium">Peso</label><Input className="h-12 rounded-xl" value={selectedProduct.weight} onChange={(event) => updateSelectedProduct({ ...selectedProduct, weight: event.target.value })} /></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Largo</label><Input className="h-12 rounded-xl" value={selectedProduct.length} onChange={(event) => updateSelectedProduct({ ...selectedProduct, length: event.target.value })} /></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Ancho</label><Input className="h-12 rounded-xl" value={selectedProduct.width} onChange={(event) => updateSelectedProduct({ ...selectedProduct, width: event.target.value })} /></div>
                          <div className="space-y-2"><label className="text-sm font-medium">Alto</label><Input className="h-12 rounded-xl" value={selectedProduct.height} onChange={(event) => updateSelectedProduct({ ...selectedProduct, height: event.target.value })} /></div>
                        </div>
                      </Section>
                    ) : null}

                    {activeTab === "images" ? (
                      <Section title="Imágenes" description="Imagen principal grande, galería y selección desde la media library existente.">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-sm text-muted-foreground">Al guardar se envían únicamente los IDs de imágenes existentes en WordPress.</div>
                          <div className="flex flex-wrap gap-2">
                            <Button className="rounded-xl" onClick={() => setMediaPickerTarget({ kind: "replace-main" })} type="button" variant="outline">Cambiar principal</Button>
                            <Button className="rounded-xl" onClick={() => setMediaPickerTarget({ kind: "append-gallery" })} type="button"><ImagePlus className="mr-2 h-4 w-4" />Agregar a galería</Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                          {selectedProduct.images.map((image, index) => (
                            <div key={`${image.id}-${index}`} className="overflow-hidden rounded-2xl border border-border bg-card">
                              <div className="aspect-square overflow-hidden bg-accent">{image.src ? <img alt={image.name ?? `Imagen ${image.id}`} className="h-full w-full object-cover" src={image.src} /> : null}</div>
                              <div className="space-y-2 p-3 text-sm">
                                <div className="line-clamp-2 font-medium">{index === 0 ? "Imagen principal" : image.name ?? `Imagen ${image.id}`}</div>
                                <div className="text-xs text-muted-foreground">Media ID: {image.id}</div>
                                <div className="flex gap-2">
                                  {index !== 0 ? <Button className="flex-1 rounded-xl" onClick={() => updateSelectedProduct({ ...selectedProduct, images: [image, ...selectedProduct.images.filter((item) => item.id !== image.id)] })} size="sm" variant="outline">Hacer principal</Button> : null}
                                  <Button className="rounded-xl" onClick={() => updateSelectedProduct({ ...selectedProduct, images: selectedProduct.images.filter((item) => item.id !== image.id) })} size="sm" variant="outline"><Trash2 className="h-4 w-4" /></Button>
                                </div>
                              </div>
                            </div>
                          ))}
                          {selectedProduct.images.length === 0 ? <div className="col-span-full rounded-2xl border border-border bg-card px-4 py-8 text-sm text-muted-foreground">Este producto no tiene imágenes asignadas todavía.</div> : null}
                        </div>
                      </Section>
                    ) : null}

                    {activeTab === "attributes" ? (
                      <Section title="Atributos y variaciones" description="Atributos globales, términos y configuración para producto variable.">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                          <Select onValueChange={addGlobalAttributeToProduct}><SelectTrigger className="h-12 rounded-xl lg:max-w-sm"><SelectValue placeholder="Agregar atributo global" /></SelectTrigger><SelectContent>{globalAttributes.map((attribute) => <SelectItem key={attribute.id} value={String(attribute.id)}>{attribute.name}</SelectItem>)}</SelectContent></Select>
                          <div className="text-sm text-muted-foreground">Puedes combinar atributos globales y editar qué opciones estarán disponibles para el producto.</div>
                        </div>
                        <div className="space-y-4">
                          {selectedProduct.attributes.map((attribute, index) => {
                            const terms = attribute.id ? attributeTerms[attribute.id] ?? [] : [];
                            return (
                              <div key={`${attribute.id ?? "custom"}-${index}`} className="rounded-2xl border border-border bg-card p-4">
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                  <div className="space-y-2"><label className="text-sm font-medium">Nombre</label><Input className="h-12 rounded-xl" value={attribute.name ?? ""} onChange={(event) => updateSelectedProduct({ ...selectedProduct, attributes: selectedProduct.attributes.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /></div>
                                  <div className="space-y-2"><label className="text-sm font-medium">Posición</label><Input className="h-12 rounded-xl" type="number" value={String(attribute.position)} onChange={(event) => updateSelectedProduct({ ...selectedProduct, attributes: selectedProduct.attributes.map((item, itemIndex) => itemIndex === index ? { ...item, position: Number(event.target.value) || 0 } : item) })} /></div>
                                  <label className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm"><input checked={attribute.visible} onChange={(event) => updateSelectedProduct({ ...selectedProduct, attributes: selectedProduct.attributes.map((item, itemIndex) => itemIndex === index ? { ...item, visible: event.target.checked } : item) })} type="checkbox" />Visible</label>
                                  <label className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm"><input checked={attribute.variation} onChange={(event) => updateSelectedProduct({ ...selectedProduct, attributes: selectedProduct.attributes.map((item, itemIndex) => itemIndex === index ? { ...item, variation: event.target.checked } : item) })} type="checkbox" />Usar para variaciones</label>
                                </div>
                                <div className="mt-4 space-y-2">
                                  <label className="text-sm font-medium">Opciones</label>
                                  <Input className="h-12 rounded-xl" value={attribute.options.join(", ")} onChange={(event) => updateSelectedProduct({ ...selectedProduct, attributes: selectedProduct.attributes.map((item, itemIndex) => itemIndex === index ? { ...item, options: event.target.value.split(",").map((term) => term.trim()).filter(Boolean) } : item) })} />
                                  {terms.length > 0 ? <div className="flex flex-wrap gap-2">{terms.map((term) => <button key={term.id} type="button" className="rounded-full border border-border bg-background px-3 py-1 text-xs hover:bg-accent" onClick={() => updateSelectedProduct({ ...selectedProduct, attributes: selectedProduct.attributes.map((item, itemIndex) => itemIndex === index ? { ...item, options: item.options.includes(term.name) ? item.options : [...item.options, term.name] } : item) })}>{term.name}</button>)}</div> : null}
                                </div>
                                <div className="mt-4 flex justify-end"><Button className="rounded-xl" onClick={() => updateSelectedProduct({ ...selectedProduct, attributes: selectedProduct.attributes.filter((_, itemIndex) => itemIndex !== index) })} size="sm" variant="outline">Eliminar atributo</Button></div>
                              </div>
                            );
                          })}
                          {selectedProduct.attributes.length === 0 ? <div className="rounded-2xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">Aún no has agregado atributos al producto.</div> : null}
                        </div>
                      </Section>
                    ) : null}

                    {activeTab === "related" ? (
                      <Section title="Relacionados" description="Categorías, etiquetas, upsells y cross-sells.">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="rounded-2xl border border-border bg-card p-4">
                            <div className="font-medium">Categorías</div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {categories.map((category) => <label key={category.id} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm"><input checked={selectedProduct.categories.includes(category.id)} onChange={() => toggleTaxonomy("categories", category.id)} type="checkbox" />{category.name}</label>)}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-border bg-card p-4">
                            <div className="font-medium">Etiquetas</div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {tags.map((tag) => <label key={tag.id} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm"><input checked={selectedProduct.tags.includes(tag.id)} onChange={() => toggleTaxonomy("tags", tag.id)} type="checkbox" />{tag.name}</label>)}
                            </div>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-border bg-card p-4">
                          <div className="flex flex-col gap-3 lg:flex-row">
                            <div className="relative min-w-0 flex-1">
                              <PackageSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                              <Input className="h-12 rounded-xl pl-9" placeholder="Buscar producto por nombre o SKU" value={relatedSearch} onChange={(event) => setRelatedSearch(event.target.value)} />
                            </div>
                            <Button className="h-12 rounded-xl" onClick={() => void searchRelatedProducts()} variant="outline">{relatedLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}Buscar</Button>
                          </div>
                          <div className="mt-4 grid gap-3">
                            {relatedResults.map((product) => (
                              <div key={product.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-3 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                  <div className="font-medium">{product.name}</div>
                                  <div className="text-sm text-muted-foreground">SKU {product.sku || "-"} · ID {product.id}</div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Button className="rounded-xl" onClick={() => toggleRelatedProduct("upsell_ids", product.id)} size="sm" variant={selectedProduct.upsell_ids.includes(product.id) ? "secondary" : "outline"}>{selectedProduct.upsell_ids.includes(product.id) ? "Quitar upsell" : "Agregar upsell"}</Button>
                                  <Button className="rounded-xl" onClick={() => toggleRelatedProduct("cross_sell_ids", product.id)} size="sm" variant={selectedProduct.cross_sell_ids.includes(product.id) ? "secondary" : "outline"}>{selectedProduct.cross_sell_ids.includes(product.id) ? "Quitar cross-sell" : "Agregar cross-sell"}</Button>
                                </div>
                              </div>
                            ))}
                            {relatedResults.length === 0 ? <div className="text-sm text-muted-foreground">Busca productos para asignarlos como relacionados.</div> : null}
                          </div>
                          <div className="mt-4 grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-border bg-background p-4">
                              <div className="font-medium">Upsell IDs</div>
                              <div className="mt-3 flex flex-wrap gap-2">{selectedProduct.upsell_ids.map((id) => <Badge key={id} className="border border-border bg-card text-foreground">#{id}</Badge>)}</div>
                            </div>
                            <div className="rounded-2xl border border-border bg-background p-4">
                              <div className="font-medium">Cross-sell IDs</div>
                              <div className="mt-3 flex flex-wrap gap-2">{selectedProduct.cross_sell_ids.map((id) => <Badge key={id} className="border border-border bg-card text-foreground">#{id}</Badge>)}</div>
                            </div>
                          </div>
                        </div>
                      </Section>
                    ) : null}

                    {activeTab === "meta" ? (
                      <div className="space-y-4">
                        <Section title="Descargas" description="Archivos descargables del producto.">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2"><label className="text-sm font-medium">Límite de descarga</label><Input className="h-12 rounded-xl" type="number" value={selectedProduct.download_limit} onChange={(event) => updateSelectedProduct({ ...selectedProduct, download_limit: event.target.value })} /></div>
                            <div className="space-y-2"><label className="text-sm font-medium">Expiración de descarga</label><Input className="h-12 rounded-xl" type="number" value={selectedProduct.download_expiry} onChange={(event) => updateSelectedProduct({ ...selectedProduct, download_expiry: event.target.value })} /></div>
                          </div>
                          <div className="space-y-3">
                            {selectedProduct.downloads.map((download, index) => (
                              <div key={index} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                                <Input className="h-12 rounded-xl" placeholder="Nombre" value={download.name} onChange={(event) => updateSelectedProduct({ ...selectedProduct, downloads: selectedProduct.downloads.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
                                <Input className="h-12 rounded-xl" placeholder="URL del archivo" value={download.file} onChange={(event) => updateSelectedProduct({ ...selectedProduct, downloads: selectedProduct.downloads.map((item, itemIndex) => itemIndex === index ? { ...item, file: event.target.value } : item) })} />
                                <Button className="rounded-xl" onClick={() => updateSelectedProduct({ ...selectedProduct, downloads: selectedProduct.downloads.filter((_, itemIndex) => itemIndex !== index) })} type="button" variant="outline"><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            ))}
                            <Button className="rounded-xl" onClick={() => updateSelectedProduct({ ...selectedProduct, downloads: [...selectedProduct.downloads, { name: "", file: "" }] })} type="button" variant="outline">Agregar descarga</Button>
                          </div>
                        </Section>

                        <Section title="Meta data" description="Editor dinámico de pares key/value.">
                          <div className="space-y-3">
                            {selectedProduct.meta_data.map((item, index) => (
                              <div key={index} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                                <Input className="h-12 rounded-xl" placeholder="Key" value={item.key} onChange={(event) => updateSelectedProduct({ ...selectedProduct, meta_data: selectedProduct.meta_data.map((entry, itemIndex) => itemIndex === index ? { ...entry, key: event.target.value } : entry) })} />
                                <Input className="h-12 rounded-xl" placeholder="Value" value={item.value} onChange={(event) => updateSelectedProduct({ ...selectedProduct, meta_data: selectedProduct.meta_data.map((entry, itemIndex) => itemIndex === index ? { ...entry, value: event.target.value } : entry) })} />
                                <Button className="rounded-xl" onClick={() => updateSelectedProduct({ ...selectedProduct, meta_data: selectedProduct.meta_data.filter((_, itemIndex) => itemIndex !== index) })} type="button" variant="outline"><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            ))}
                            <Button className="rounded-xl" onClick={() => updateSelectedProduct({ ...selectedProduct, meta_data: [...selectedProduct.meta_data, { key: "", value: "" }] })} type="button" variant="outline">Agregar meta data</Button>
                          </div>
                        </Section>
                      </div>
                    ) : null}

                    {activeTab === "variations" && selectedProduct.type === "variable" ? (
                      <Section title="Variaciones" description="CRUD completo de variaciones del producto variable.">
                        {!selectedProduct.id ? <div className="rounded-2xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">Guarda primero el producto para poder crear variaciones.</div> : null}
                        {selectedProduct.id ? (
                          <>
                            <div className="flex justify-between">
                              <div className="text-sm text-muted-foreground">Usa los atributos marcados para variación para configurar cada combinación.</div>
                              <Button className="rounded-xl" onClick={addVariation} type="button"><Plus className="mr-2 h-4 w-4" />Nueva variación</Button>
                            </div>
                            {variationsLoading ? <div className="text-sm text-muted-foreground">Cargando variaciones...</div> : null}
                            <div className="space-y-4">
                              {variations.map((variation, index) => (
                                <div key={variation.id ?? `new-${index}`} className="rounded-2xl border border-border bg-card p-4">
                                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    <div className="space-y-2"><label className="text-sm font-medium">SKU</label><Input className="h-12 rounded-xl" value={variation.sku} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, sku: event.target.value } : item))} /></div>
                                    <div className="space-y-2"><label className="text-sm font-medium">Precio regular</label><Input className="h-12 rounded-xl" value={variation.regular_price} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, regular_price: event.target.value } : item))} /></div>
                                    <div className="space-y-2"><label className="text-sm font-medium">Precio oferta</label><Input className="h-12 rounded-xl" value={variation.sale_price} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, sale_price: event.target.value } : item))} /></div>
                                    <div className="space-y-2"><label className="text-sm font-medium">Estado stock</label><Select value={variation.stock_status} onValueChange={(value) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, stock_status: value as StockStatus } : item))}><SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="instock">In stock</SelectItem><SelectItem value="outofstock">Out of stock</SelectItem><SelectItem value="onbackorder">On backorder</SelectItem></SelectContent></Select></div>
                                    <div className="space-y-2"><label className="text-sm font-medium">Cantidad</label><Input className="h-12 rounded-xl" disabled={!variation.manage_stock} type="number" value={variation.stock_quantity} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, stock_quantity: event.target.value } : item))} /></div>
                                    <div className="space-y-2"><label className="text-sm font-medium">Peso</label><Input className="h-12 rounded-xl" value={variation.weight} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, weight: event.target.value } : item))} /></div>
                                    <div className="space-y-2"><label className="text-sm font-medium">Largo</label><Input className="h-12 rounded-xl" value={variation.length} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, length: event.target.value } : item))} /></div>
                                    <div className="space-y-2"><label className="text-sm font-medium">Ancho</label><Input className="h-12 rounded-xl" value={variation.width} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, width: event.target.value } : item))} /></div>
                                  </div>
                                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                                    <label className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm"><input checked={variation.manage_stock} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, manage_stock: event.target.checked, stock_quantity: event.target.checked ? item.stock_quantity : "" } : item))} type="checkbox" />Gestionar stock</label>
                                    <label className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm"><input checked={variation.virtual} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, virtual: event.target.checked } : item))} type="checkbox" />Virtual</label>
                                    <label className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm"><input checked={variation.downloadable} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, downloadable: event.target.checked } : item))} type="checkbox" />Descargable</label>
                                  </div>
                                  <div className="mt-4 rounded-2xl border border-border bg-background p-4">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                      <div>
                                        <div className="font-medium">Imagen de la variación</div>
                                        <div className="text-sm text-muted-foreground">Selecciona una imagen existente desde la media library.</div>
                                      </div>
                                      <Button className="rounded-xl" onClick={() => setMediaPickerTarget({ kind: "variation-image", variationIndex: index })} type="button" variant="outline">Elegir imagen</Button>
                                    </div>
                                    {variation.image?.id ? <div className="mt-3 text-sm text-muted-foreground">Media ID {variation.image.id}</div> : null}
                                    {variation.image_src ? <img alt="Imagen variación" className="mt-3 h-24 w-24 rounded-xl object-cover" src={variation.image_src} /> : null}
                                  </div>
                                  {variationAttributes.length > 0 ? (
                                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                      {variationAttributes.map((attribute) => (
                                        <div key={`${attribute.id}-${attribute.name}`} className="space-y-2">
                                          <label className="text-sm font-medium">{attribute.name}</label>
                                          <Select value={variation.attributes.find((item) => item.id === attribute.id)?.option ?? ""} onValueChange={(value) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, attributes: [...item.attributes.filter((entry) => entry.id !== attribute.id), { id: attribute.id, option: value }] } : item))}>
                                            <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Seleccionar opción" /></SelectTrigger>
                                            <SelectContent>{attribute.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
                                          </Select>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2"><label className="text-sm font-medium">Download limit</label><Input className="h-12 rounded-xl" type="number" value={variation.download_limit} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, download_limit: event.target.value } : item))} /></div>
                                    <div className="space-y-2"><label className="text-sm font-medium">Download expiry</label><Input className="h-12 rounded-xl" type="number" value={variation.download_expiry} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, download_expiry: event.target.value } : item))} /></div>
                                  </div>
                                  <div className="mt-4 space-y-3">
                                    {(variation.downloads ?? []).map((download, downloadIndex) => (
                                      <div key={downloadIndex} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                                        <Input className="h-12 rounded-xl" placeholder="Nombre" value={download.name} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, downloads: item.downloads.map((entry, entryIndex) => entryIndex === downloadIndex ? { ...entry, name: event.target.value } : entry) } : item))} />
                                        <Input className="h-12 rounded-xl" placeholder="Archivo" value={download.file} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, downloads: item.downloads.map((entry, entryIndex) => entryIndex === downloadIndex ? { ...entry, file: event.target.value } : entry) } : item))} />
                                        <Button className="rounded-xl" onClick={() => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, downloads: item.downloads.filter((_, entryIndex) => entryIndex !== downloadIndex) } : item))} type="button" variant="outline"><Trash2 className="h-4 w-4" /></Button>
                                      </div>
                                    ))}
                                    <Button className="rounded-xl" onClick={() => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, downloads: [...item.downloads, { name: "", file: "" }] } : item))} type="button" variant="outline">Agregar descarga</Button>
                                  </div>
                                  <div className="mt-4 space-y-3">
                                    {(variation.meta_data ?? []).map((meta, metaIndex) => (
                                      <div key={metaIndex} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                                        <Input className="h-12 rounded-xl" placeholder="Key" value={meta.key} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, meta_data: item.meta_data.map((entry, entryIndex) => entryIndex === metaIndex ? { ...entry, key: event.target.value } : entry) } : item))} />
                                        <Input className="h-12 rounded-xl" placeholder="Value" value={meta.value} onChange={(event) => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, meta_data: item.meta_data.map((entry, entryIndex) => entryIndex === metaIndex ? { ...entry, value: event.target.value } : entry) } : item))} />
                                        <Button className="rounded-xl" onClick={() => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, meta_data: item.meta_data.filter((_, entryIndex) => entryIndex !== metaIndex) } : item))} type="button" variant="outline"><Trash2 className="h-4 w-4" /></Button>
                                      </div>
                                    ))}
                                    <Button className="rounded-xl" onClick={() => setVariations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, meta_data: [...item.meta_data, { key: "", value: "" }] } : item))} type="button" variant="outline">Agregar meta data</Button>
                                  </div>
                                  <div className="mt-4 flex flex-wrap gap-2">
                                    <Button className="rounded-xl px-6" disabled={variationSavingIndex === index} onClick={() => void saveVariation(variation, index)}>{variationSavingIndex === index ? "Guardando..." : variation.id ? "Guardar variación" : "Crear variación"}</Button>
                                    <Button className="rounded-xl" disabled={variationSavingIndex === index} onClick={() => void deleteVariation(variation, index)} variant="outline">Eliminar</Button>
                                  </div>
                                </div>
                              ))}
                              {variations.length === 0 && !variationsLoading ? <div className="rounded-2xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">No hay variaciones creadas todavía.</div> : null}
                            </div>
                          </>
                        ) : null}
                      </Section>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">Información del backup actual</div>
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
            ) : null}
          </div>
        </>
      ) : null}

      {importPrefillStatus ? (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <LoaderCircle className="mt-1 h-6 w-6 animate-spin text-primary" />
              <div>
                <div className="text-lg font-semibold text-foreground">Preparando producto</div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">{importPrefillStatus}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {saveOperationStatus ? (
        <div className="fixed inset-0 z-[86] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-border bg-card p-5 shadow-2xl">
            <div className="flex items-start gap-4">
              <LoaderCircle className="mt-0.5 h-6 w-6 animate-spin text-primary" />
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-foreground">
                  {saveOperationMode === "images" ? "Proceso de imágenes" : "Proceso de producto"}
                </div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">{saveOperationStatus}</div>
                {saveOperationError ? <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{saveOperationError}</div> : null}
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Progreso</span>
                    <span>{saveOperationProgress}%</span>
                  </div>
                  <Progress className="h-3" value={saveOperationProgress} />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {mediaPickerTarget && selectedProduct && activeTenant ? (
        <>
          <div className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-sm" onClick={() => setMediaPickerTarget(null)} />
          <div className="fixed inset-6 z-[80] overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-2xl sm:inset-10 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Galería</div>
                <h3 className="mt-2 text-2xl font-semibold">{mediaPickerTarget.kind === "replace-main" ? "Cambiar imagen principal" : mediaPickerTarget.kind === "append-gallery" ? "Agregar imagen a galería" : "Imagen de la variación"}</h3>
              </div>
              <button className="rounded-xl p-2 hover:bg-accent" onClick={() => setMediaPickerTarget(null)} type="button"><X className="h-5 w-5" /></button>
            </div>
            <MediaLibraryBrowser mode="picker" onSelect={handleMediaSelect} selectedIds={selectedProduct.images.map((image) => image.id)} tenantId={activeTenant.id} />
          </div>
        </>
      ) : null}

    </div>
  );
}
