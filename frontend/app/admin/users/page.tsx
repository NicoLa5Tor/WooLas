"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest, setStoredTenantId, type AdminClient, type AuthSession } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

export default function AdminUsersPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [wpCredentials, setWpCredentials] = useState<Record<string, { wp_user: string; wp_app_password: string }>>({});
  const [form, setForm] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
    wc_url: "",
    wc_key: "",
    wc_secret: "",
    wp_user: "",
    wp_app_password: ""
  });

  const syncWpCredentials = (items: AdminClient[]) => {
    setWpCredentials((current) => {
      const next = { ...current };
      for (const client of items) {
        next[client.id] = next[client.id] ?? {
          wp_user: client.wp_user ?? "",
          wp_app_password: ""
        };
      }
      return next;
    });
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const meResponse = await apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" });
      setSession(meResponse.data);
      if (meResponse.data.user.role !== "admin") {
        router.replace("/backup");
        return;
      }
      const clientsResponse = await apiRequest<AdminClient[]>("/api/admin/clients", { cache: "no-store" });
      setClients(clientsResponse.data);
      syncWpCredentials(clientsResponse.data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudieron cargar los clientes", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const createClient = async () => {
    setCreating(true);
    try {
      const response = await apiRequest<AdminClient>("/api/admin/clients", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setForm({
        name: "",
        email: "",
        username: "",
        password: "",
        wc_url: "",
        wc_key: "",
        wc_secret: "",
        wp_user: "",
        wp_app_password: ""
      });
      setStoredTenantId(response.data.tenant_id);
      showToast("Cliente creado correctamente");
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo crear el cliente", "error");
    } finally {
      setCreating(false);
    }
  };

  const updateClient = async (userId: string, payload: Record<string, unknown>) => {
    try {
      await apiRequest<AdminClient>(`/api/admin/clients/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      if (typeof payload.password === "string") {
        setResetPasswords((current) => ({ ...current, [userId]: "" }));
      }
      if (typeof payload.wp_app_password === "string") {
        setWpCredentials((current) => ({
          ...current,
          [userId]: {
            wp_user: current[userId]?.wp_user ?? "",
            wp_app_password: ""
          }
        }));
      }
      showToast("Cliente actualizado");
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo actualizar el cliente", "error");
    }
  };

  const saveWpCredentials = async (clientId: string) => {
    const values = wpCredentials[clientId];
    if (!values) {
      return;
    }
    await updateClient(clientId, {
      wp_user: values.wp_user,
      wp_app_password: values.wp_app_password
    });
  };

  const openTenant = (tenantId: string) => {
    setStoredTenantId(tenantId);
    router.push("/backup");
  };

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="rounded-3xl border border-border/80 bg-card/85 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-8">
        <div className="max-w-3xl">
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Admin</div>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Clientes y accesos</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            Crea cada cliente con su usuario, credenciales de WooCommerce y acceso opcional a la galería de imágenes de WordPress.
          </p>
        </div>
      </section>

      <Card className="rounded-3xl border-border/80 shadow-sm">
        <CardHeader className="px-5 pt-6 sm:px-6">
          <CardTitle>Nuevo cliente</CardTitle>
          <CardDescription>WooLas crea la cuenta y enlaza su tienda WooCommerce al mismo tiempo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-5 pb-6 sm:px-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <Input className="h-12 rounded-xl" placeholder="Nombre del cliente o tienda" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            <Input className="h-12 rounded-xl" placeholder="Correo" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
            <Input className="h-12 rounded-xl" placeholder="Usuario" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} />
            <Input className="h-12 rounded-xl" placeholder="Contraseña" type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
            <Input className="h-12 rounded-xl lg:col-span-2" placeholder="WC URL" value={form.wc_url} onChange={(event) => setForm((current) => ({ ...current, wc_url: event.target.value }))} />
            <Input className="h-12 rounded-xl" placeholder="WC Key" value={form.wc_key} onChange={(event) => setForm((current) => ({ ...current, wc_key: event.target.value }))} />
            <Input className="h-12 rounded-xl" placeholder="WC Secret" value={form.wc_secret} onChange={(event) => setForm((current) => ({ ...current, wc_secret: event.target.value }))} />
            <Input className="h-12 rounded-xl" placeholder="Usuario de WordPress" value={form.wp_user} onChange={(event) => setForm((current) => ({ ...current, wp_user: event.target.value }))} />
            <Input className="h-12 rounded-xl" placeholder="Application Password de WordPress" type="password" value={form.wp_app_password} onChange={(event) => setForm((current) => ({ ...current, wp_app_password: event.target.value }))} />
          </div>

          <div className="rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">Nota sobre imágenes</div>
            <div className="mt-2">Para habilitar la galería de imágenes, ve a WordPress Admin → Usuarios → Tu perfil → Contraseñas de aplicación, genera una nueva y pégala aquí junto con tu usuario de WordPress.</div>
          </div>

          <Button
            className="h-12 rounded-xl text-sm font-semibold"
            disabled={creating || !form.name || !form.email || !form.username || !form.password || !form.wc_url || !form.wc_key || !form.wc_secret}
            onClick={() => void createClient()}
          >
            {creating ? "Creando..." : "Crear cliente"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-border/80 shadow-sm">
        <CardHeader className="px-5 pt-6 sm:px-6">
          <CardTitle>Clientes registrados</CardTitle>
          <CardDescription>{session?.user.role === "admin" ? "Cada cliente opera únicamente sobre su propia tienda WooCommerce." : ""}</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-6 sm:px-6">
          {loading ? (
            <div className="text-sm text-muted-foreground">Cargando clientes...</div>
          ) : (
            <>
              <div className="grid gap-4 md:hidden">
                {clients.map((client) => (
                  <div key={client.id} className="rounded-2xl border border-border bg-background/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{client.tenant_name}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{client.username}</div>
                      </div>
                      <Button onClick={() => openTenant(client.tenant_id)} size="sm" variant="secondary">Entrar</Button>
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                      <div><span className="text-foreground">Correo:</span> {client.email ?? "-"}</div>
                      <div className="break-all"><span className="text-foreground">WooCommerce:</span> {client.wc_url}</div>
                      <div><span className="text-foreground">WP User:</span> {client.wp_user ?? "No configurado"}</div>
                      <div><span className="text-foreground">Galería:</span> {client.has_wp_media_credentials ? "Habilitada" : "Sin configurar"}</div>
                      <div><span className="text-foreground">Último acceso:</span> {client.last_login ? new Date(client.last_login).toLocaleString() : "Nunca"}</div>
                    </div>
                    <div className="mt-4 grid gap-2">
                      <Input className="h-11 rounded-xl" placeholder="Usuario de WordPress" value={wpCredentials[client.id]?.wp_user ?? ""} onChange={(event) => setWpCredentials((current) => ({ ...current, [client.id]: { wp_user: event.target.value, wp_app_password: current[client.id]?.wp_app_password ?? "" } }))} />
                      <Input className="h-11 rounded-xl" placeholder="Nueva Application Password" type="password" value={wpCredentials[client.id]?.wp_app_password ?? ""} onChange={(event) => setWpCredentials((current) => ({ ...current, [client.id]: { wp_user: current[client.id]?.wp_user ?? "", wp_app_password: event.target.value } }))} />
                      <Button onClick={() => void saveWpCredentials(client.id)} variant="outline">Guardar credenciales WP</Button>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button onClick={() => void updateClient(client.id, { is_active: !client.is_active })} size="sm" variant={client.is_active ? "outline" : "secondary"}>
                        {client.is_active ? "Desactivar" : "Reactivar"}
                      </Button>
                    </div>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <Input
                        className="h-11 rounded-xl"
                        placeholder="Nueva contraseña"
                        type="password"
                        value={resetPasswords[client.id] ?? ""}
                        onChange={(event) =>
                          setResetPasswords((current) => ({
                            ...current,
                            [client.id]: event.target.value
                          }))
                        }
                      />
                      <Button disabled={!(resetPasswords[client.id] ?? "")} onClick={() => void updateClient(client.id, { password: resetPasswords[client.id] })}>
                        Resetear
                      </Button>
                    </div>
                  </div>
                ))}
                {clients.length === 0 ? <div className="rounded-2xl border border-border bg-background/70 px-4 py-6 text-sm text-muted-foreground">No hay clientes registrados.</div> : null}
              </div>

              <div className="hidden overflow-hidden rounded-2xl border border-border md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-accent/70">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Cliente</th>
                      <th className="px-4 py-3 text-left font-medium">Correo</th>
                      <th className="px-4 py-3 text-left font-medium">Usuario</th>
                      <th className="px-4 py-3 text-left font-medium">WooCommerce</th>
                      <th className="px-4 py-3 text-left font-medium">WordPress</th>
                      <th className="px-4 py-3 text-left font-medium">Último acceso</th>
                      <th className="px-4 py-3 text-left font-medium">Estado</th>
                      <th className="px-4 py-3 text-left font-medium">Reset contraseña</th>
                      <th className="px-4 py-3 text-left font-medium">Abrir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {clients.map((client) => (
                      <tr key={client.id}>
                        <td className="px-4 py-3 align-top">{client.tenant_name}</td>
                        <td className="px-4 py-3 align-top">{client.email ?? "-"}</td>
                        <td className="px-4 py-3 align-top">{client.username}</td>
                        <td className="px-4 py-3 align-top break-all">{client.wc_url}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="space-y-2 min-w-[240px]">
                            <div className="text-xs text-muted-foreground">Actual: {client.wp_user ? `${client.wp_user} (${client.has_wp_media_credentials ? "ok" : "sin pass"})` : "No configurado"}</div>
                            <Input placeholder="Usuario de WordPress" value={wpCredentials[client.id]?.wp_user ?? ""} onChange={(event) => setWpCredentials((current) => ({ ...current, [client.id]: { wp_user: event.target.value, wp_app_password: current[client.id]?.wp_app_password ?? "" } }))} />
                            <Input placeholder="Nueva Application Password" type="password" value={wpCredentials[client.id]?.wp_app_password ?? ""} onChange={(event) => setWpCredentials((current) => ({ ...current, [client.id]: { wp_user: current[client.id]?.wp_user ?? "", wp_app_password: event.target.value } }))} />
                            <Button onClick={() => void saveWpCredentials(client.id)} size="sm" variant="outline">Guardar WP</Button>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">{client.last_login ? new Date(client.last_login).toLocaleString() : "Nunca"}</td>
                        <td className="px-4 py-3 align-top">
                          <Button
                            onClick={() => void updateClient(client.id, { is_active: !client.is_active })}
                            size="sm"
                            variant={client.is_active ? "outline" : "secondary"}
                          >
                            {client.is_active ? "Desactivar" : "Reactivar"}
                          </Button>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex gap-2 min-w-[240px]">
                            <Input
                              placeholder="Nueva contraseña"
                              type="password"
                              value={resetPasswords[client.id] ?? ""}
                              onChange={(event) =>
                                setResetPasswords((current) => ({
                                  ...current,
                                  [client.id]: event.target.value
                                }))
                              }
                            />
                            <Button
                              disabled={!(resetPasswords[client.id] ?? "")}
                              onClick={() => void updateClient(client.id, { password: resetPasswords[client.id] })}
                              size="sm"
                            >
                              Resetear
                            </Button>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Button onClick={() => openTenant(client.tenant_id)} size="sm" variant="secondary">
                            Entrar
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {clients.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-muted-foreground" colSpan={9}>
                          No hay clientes registrados.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
