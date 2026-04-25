"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export default function LoginPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "No se pudo iniciar sesión");
      }
      showToast("Sesión iniciada");
      router.replace(payload.data?.user?.role === "admin" ? "/admin/users" : "/backup");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error inesperado";
      setError(message);
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(180deg,_rgba(255,247,237,1),_rgba(245,241,234,1))] px-4 py-10 dark:bg-[linear-gradient(180deg,_rgba(15,23,42,1),_rgba(17,24,39,1))]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(184,115,51,0.32),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(15,23,42,0.14),_transparent_26%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.16),_transparent_25%),radial-gradient(circle_at_bottom_right,_rgba(148,163,184,0.08),_transparent_24%)]" />
      <Card className="relative w-full max-w-md rounded-3xl border-white/40 bg-card/92 shadow-2xl backdrop-blur xl:max-w-lg">
        <CardHeader className="space-y-3 px-6 pb-2 pt-7 sm:px-8">
          <div className="text-[11px] uppercase tracking-[0.35em] text-muted-foreground">WooLas</div>
          <CardTitle className="text-3xl sm:text-4xl">Acceso al panel</CardTitle>
          <CardDescription className="max-w-sm text-sm leading-6">
            Administra productos, backups y cargas masivas de cada cliente desde un solo lugar.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-7 sm:px-8">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Usuario</label>
              <Input className="h-12 rounded-xl" value={username} onChange={(event) => setUsername(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Contraseña</label>
              <Input className="h-12 rounded-xl" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </div>
            {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error}</div> : null}
            <Button className="h-12 w-full rounded-xl text-sm font-semibold" disabled={loading} type="submit">
              {loading ? "Ingresando..." : "Ingresar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
