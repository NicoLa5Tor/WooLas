"use client";

import { ImagePlus, LoaderCircle, Search, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { apiRequest, type MediaItem, type MediaListResponse, uploadFileWithProgress, withTenantPath } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

export function MediaLibraryBrowser({
  tenantId,
  mode = "page",
  selectedIds = [],
  onSelect
}: {
  tenantId: string;
  mode?: "page" | "picker";
  selectedIds?: number[];
  onSelect?: (item: MediaItem) => void;
}) {
  const { showToast } = useToast();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const loadMedia = async ({ nextPage, append }: { nextPage: number; append: boolean }) => {
    const setLoadingState = append ? setLoadingMore : setLoading;
    setLoadingState(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(nextPage) });
      if (searchTerm) {
        query.set("search", searchTerm);
      }
      const response = await apiRequest<MediaListResponse>(`${withTenantPath(tenantId, "/media")}?${query.toString()}`, { cache: "no-store" });
      setItems((current) => (append ? [...current, ...response.data.items] : response.data.items));
      setPage(response.data.page);
      setTotalPages(response.data.total_pages);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo cargar la biblioteca de imágenes";
      setError(message);
    } finally {
      setLoadingState(false);
    }
  };

  useEffect(() => {
    void loadMedia({ nextPage: 1, append: false });
  }, [tenantId, searchTerm]);

  const handleUpload = async (file: File | null) => {
    if (!file) {
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const response = await uploadFileWithProgress<MediaItem>(withTenantPath(tenantId, "/media"), file, setUploadProgress);
      setItems((current) => [response.data, ...current.filter((item) => item.id !== response.data.id)]);
      showToast("Imagen subida correctamente");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo subir la imagen", "error");
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 800);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-12 rounded-xl pl-9" placeholder="Buscar por nombre de archivo" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="flex gap-3">
          <Button className="rounded-xl" onClick={() => setSearchTerm(search.trim())} variant="outline">Buscar</Button>
          <Button className="rounded-xl" onClick={() => fileInputRef.current?.click()}>
            <ImagePlus className="mr-2 h-4 w-4" />
            Subir imagen
          </Button>
        </div>
      </div>

      <input ref={fileInputRef} accept="image/*" className="hidden" onChange={(event) => void handleUpload(event.target.files?.[0] ?? null)} type="file" />

      <button
        type="button"
        className={[
          "flex w-full flex-col items-center justify-center rounded-3xl border border-dashed px-6 py-8 text-center transition-colors",
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
          void handleUpload(event.dataTransfer.files?.[0] ?? null);
        }}
      >
        <UploadCloud className="h-8 w-8 text-muted-foreground" />
        <div className="mt-4 text-base font-medium">Arrastra una imagen aquí o haz click para seleccionarla</div>
        <div className="mt-2 text-sm text-muted-foreground">Formatos recomendados: JPG, PNG o WEBP.</div>
      </button>

      {uploading || uploadProgress > 0 ? (
        <div className="space-y-2 rounded-2xl border border-border bg-background/70 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Subiendo imagen...</span>
            <span className="font-medium">{uploadProgress}%</span>
          </div>
          <Progress className="h-3" value={uploadProgress} />
        </div>
      ) : null}

      {loading ? <div className="text-sm text-muted-foreground">Cargando biblioteca de imágenes...</div> : null}
      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error}</div> : null}

      {!loading && !error ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="overflow-hidden rounded-2xl border border-border bg-card/90">
              <button
                className="block w-full text-left"
                onClick={() => onSelect?.(item)}
                type="button"
              >
                <div className="aspect-square overflow-hidden bg-accent">
                  {item.thumbnail ? <img alt={item.filename} className="h-full w-full object-cover" src={item.thumbnail} /> : null}
                </div>
                <div className="space-y-2 p-3">
                  <div className="line-clamp-2 text-sm font-medium">{item.filename}</div>
                  <div className="text-xs text-muted-foreground">{new Date(item.uploaded_at).toLocaleString()}</div>
                </div>
              </button>
              {mode === "picker" ? (
                <div className="border-t border-border p-3">
                  <Button className="w-full rounded-xl" onClick={(event) => { event.stopPropagation(); onSelect?.(item); }} variant={selectedSet.has(item.id) ? "secondary" : "outline"}>
                    {selectedSet.has(item.id) ? "Ya seleccionada" : "Seleccionar"}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {items.length === 0 ? <div className="col-span-full rounded-2xl border border-border bg-background/70 px-4 py-8 text-sm text-muted-foreground">No hay imágenes para mostrar.</div> : null}
        </div>
      ) : null}

      {page < totalPages ? (
        <div className="flex justify-center">
          <Button className="rounded-xl" disabled={loadingMore} onClick={() => void loadMedia({ nextPage: page + 1, append: true })} variant="outline">
            {loadingMore ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            Cargar más
          </Button>
        </div>
      ) : null}
    </div>
  );
}
