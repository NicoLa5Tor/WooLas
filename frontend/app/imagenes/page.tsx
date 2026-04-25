"use client";

import { useEffect, useState } from "react";

import { MediaLibraryBrowser } from "@/components/MediaLibraryBrowser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, resolveActiveTenant, type AuthSession } from "@/lib/api";

export default function ImagesPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" })
      .then((response) => setSession(response.data))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar la sesión"))
      .finally(() => setLoading(false));
  }, []);

  const activeTenant = session ? resolveActiveTenant(session) : null;

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="rounded-3xl border border-border/80 bg-card/85 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-8">
        <div className="max-w-3xl">
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Imágenes</div>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Biblioteca de medios</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            {activeTenant ? `Gestiona las imágenes de WordPress para ${activeTenant.name} y reutilízalas en los productos.` : "Selecciona un cliente activo para administrar su biblioteca de medios."}
          </p>
        </div>
      </section>

      <Card className="rounded-3xl border-border/80 shadow-sm">
        <CardHeader className="px-5 pt-6 sm:px-6">
          <CardTitle>Galería</CardTitle>
          <CardDescription>Consulta, busca y sube imágenes a la biblioteca de WordPress.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-6 sm:px-6">
          {loading ? <div className="text-sm text-muted-foreground">Cargando biblioteca...</div> : null}
          {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error}</div> : null}
          {!loading && !error && !activeTenant ? <div className="text-sm text-muted-foreground">No hay cliente activo seleccionado.</div> : null}
          {!loading && !error && activeTenant ? <MediaLibraryBrowser tenantId={activeTenant.id} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
