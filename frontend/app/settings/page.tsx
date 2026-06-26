"use client";

import { Check, LoaderCircle, Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiRequest, resolveActiveTenant, withTenantPath, type AuthSession } from "@/lib/api";

type SettingField = {
  key: string;
  label: string;
  description?: string | null;
  type: "boolean" | "number" | "select" | string;
  value: boolean | number | string | null;
  options?: Array<{ value: string; label: string }>;
  error?: string;
};

type SettingSection = {
  key: string;
  label: string;
  description?: string;
  fields: SettingField[];
};

type SettingsResponse = {
  sections: SettingSection[];
};

export default function SettingsPage() {
  const { showToast } = useToast();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sections, setSections] = useState<SettingSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [recentSaved, setRecentSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<AuthSession>("/api/auth/me", { cache: "no-store" })
      .then((r) => setSession(r.data))
      .catch(() => null);
  }, []);

  const activeTenant = session ? resolveActiveTenant(session) : null;

  const load = useCallback(async () => {
    if (!activeTenant) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<SettingsResponse>(
        withTenantPath(activeTenant.id, "/settings"),
        { cache: "no-store" }
      );
      setSections(response.data.sections);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo cargar la configuración";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeTenant]);

  useEffect(() => {
    if (activeTenant) void load();
  }, [activeTenant, load]);

  const saveField = async (sectionKey: string, field: SettingField, newValue: boolean | number | string) => {
    if (!activeTenant) return;
    const fullKey = `${sectionKey}.${field.key}`;
    setSavingKey(fullKey);
    try {
      const response = await apiRequest<SettingField>(
        withTenantPath(activeTenant.id, `/settings/${sectionKey}/${field.key}`),
        {
          method: "PUT",
          body: JSON.stringify({ value: newValue }),
          headers: { "Content-Type": "application/json" },
        }
      );
      setSections((prev) =>
        prev.map((s) =>
          s.key === sectionKey
            ? { ...s, fields: s.fields.map((f) => (f.key === field.key ? { ...f, value: response.data.value } : f)) }
            : s
        )
      );
      setRecentSaved(fullKey);
      window.setTimeout(() => setRecentSaved((cur) => (cur === fullKey ? null : cur)), 1800);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo guardar";
      showToast(message, "error");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="rounded-3xl border border-border/80 bg-card/85 p-5 shadow-sm backdrop-blur sm:p-6 lg:p-8">
        <div className="flex items-end justify-between gap-4">
          <div className="max-w-2xl">
            <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Configuración</div>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Ajustes del cliente</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              {activeTenant
                ? `Configuración de WooCommerce para ${activeTenant.name}. Cambios se aplican directo a la tienda.`
                : "Selecciona un cliente activo para configurar."}
            </p>
          </div>
        </div>
      </section>

      {!activeTenant ? null : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />Cargando configuración...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {sections.map((section) => (
            <Card key={section.key} className="rounded-3xl border-border/80 shadow-sm">
              <CardHeader className="px-5 pt-6 sm:px-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-primary/10 p-2 text-primary"><SettingsIcon className="h-4 w-4" /></div>
                  <div>
                    <CardTitle>{section.label}</CardTitle>
                    {section.description ? <CardDescription className="mt-1">{section.description}</CardDescription> : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 px-5 pb-6 sm:px-6">
                {section.fields.map((field) => {
                  const fullKey = `${section.key}.${field.key}`;
                  const isSaving = savingKey === fullKey;
                  const wasSaved = recentSaved === fullKey;
                  return (
                    <div key={field.key} className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <label className="text-sm font-medium">{field.label}</label>
                          {field.description ? (
                            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{field.description}</p>
                          ) : null}
                          {field.error ? (
                            <p className="mt-1 text-xs text-destructive">⚠ {field.error}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {isSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
                          {wasSaved ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : null}
                        </div>
                      </div>
                      <div>
                        {field.type === "boolean" ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={Boolean(field.value)}
                            disabled={isSaving || Boolean(field.error)}
                            onClick={() => void saveField(section.key, field, !field.value)}
                            className={[
                              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                              field.value ? "bg-primary" : "bg-muted",
                              isSaving ? "opacity-60" : "",
                            ].join(" ")}
                          >
                            <span
                              className={[
                                "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition",
                                field.value ? "translate-x-5" : "translate-x-0",
                              ].join(" ")}
                            />
                          </button>
                        ) : field.type === "number" ? (
                          <Input
                            className="h-9 w-32 rounded-xl tabular-nums"
                            inputMode="numeric"
                            disabled={isSaving || Boolean(field.error)}
                            value={String(field.value ?? "")}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D+/g, "");
                              setSections((prev) =>
                                prev.map((s) =>
                                  s.key === section.key
                                    ? { ...s, fields: s.fields.map((f) => (f.key === field.key ? { ...f, value: v } : f)) }
                                    : s
                                )
                              );
                            }}
                            onBlur={() => void saveField(section.key, field, Number(field.value || 0))}
                          />
                        ) : field.type === "select" && field.options ? (
                          (() => {
                            const SENTINEL = "__default__";
                            const toSentinel = (v: string) => v === "" ? SENTINEL : v;
                            const fromSentinel = (v: string) => v === SENTINEL ? "" : v;
                            return (
                              <Select
                                value={toSentinel(String(field.value ?? ""))}
                                disabled={isSaving || Boolean(field.error)}
                                onValueChange={(v) => void saveField(section.key, field, fromSentinel(v))}
                              >
                                <SelectTrigger className="h-9 w-full max-w-md rounded-xl">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {field.options!.map((opt) => (
                                    <SelectItem key={opt.value || SENTINEL} value={toSentinel(opt.value)}>{opt.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            );
                          })()
                        ) : (
                          <Input
                            className="h-9 rounded-xl"
                            disabled={isSaving || Boolean(field.error)}
                            value={String(field.value ?? "")}
                            onChange={(e) =>
                              setSections((prev) =>
                                prev.map((s) =>
                                  s.key === section.key
                                    ? { ...s, fields: s.fields.map((f) => (f.key === field.key ? { ...f, value: e.target.value } : f)) }
                                    : s
                                )
                              )
                            }
                            onBlur={() => void saveField(section.key, field, String(field.value ?? ""))}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
