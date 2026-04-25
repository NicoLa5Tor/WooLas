"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest, type AuthSession, type Tenant } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

export default function AdminTenantsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", wc_url: "", wc_key: "", wc_secret: "" });

  const loadData = async () => {
    setLoading(true);
    try {
      const me = await apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" });
      setSession(me.data);
      if (me.data.user.role !== "admin") {
        router.replace("/backup");
        return;
      }
      const tenantsResponse = await apiRequest<Tenant[]>("/api/tenants", { cache: "no-store" });
      setTenants(tenantsResponse.data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudieron cargar los tenants", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const createTenant = async () => {
    setCreating(true);
    try {
      await apiRequest<Tenant>("/api/tenants", {
        method: "POST",
        body: JSON.stringify({ ...form, is_active: true })
      });
      setForm({ name: "", wc_url: "", wc_key: "", wc_secret: "" });
      showToast("Tenant creado");
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo crear el tenant", "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm uppercase tracking-[0.25em] text-muted-foreground">Admin</div>
        <h1 className="mt-2 text-3xl font-semibold">Tiendas WooCommerce</h1>
        <p className="mt-2 text-sm text-muted-foreground">Cada tienda representa un cliente independiente dentro de WooLas.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nuevo tenant</CardTitle>
          <CardDescription>El acceso WooCommerce se cifra en el backend y queda asociado a este tenant.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <Input placeholder="Nombre" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          <Input placeholder="WC URL" value={form.wc_url} onChange={(event) => setForm((current) => ({ ...current, wc_url: event.target.value }))} />
          <Input placeholder="WC Key" value={form.wc_key} onChange={(event) => setForm((current) => ({ ...current, wc_key: event.target.value }))} />
          <Input placeholder="WC Secret" value={form.wc_secret} onChange={(event) => setForm((current) => ({ ...current, wc_secret: event.target.value }))} />
          <Button className="lg:col-span-2" disabled={creating || Object.values(form).some((value) => !value)} onClick={() => void createTenant()}>
            {creating ? "Creando..." : "Crear tenant"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenants registrados</CardTitle>
          <CardDescription>{session?.user.role === "admin" ? "Cada tenant representa un cliente o tienda independiente." : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Cargando tenants...</div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-accent/70">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Nombre</th>
                    <th className="px-4 py-3 text-left font-medium">WC URL</th>
                    <th className="px-4 py-3 text-left font-medium">Estado</th>
                    <th className="px-4 py-3 text-left font-medium">Creado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {tenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td className="px-4 py-3">{tenant.name}</td>
                      <td className="px-4 py-3">{tenant.wc_url}</td>
                      <td className="px-4 py-3">{tenant.is_active ? "Activo" : "Inactivo"}</td>
                      <td className="px-4 py-3">{new Date(tenant.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
