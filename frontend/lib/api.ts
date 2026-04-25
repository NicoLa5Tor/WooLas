export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? API_URL;
export const FRONTEND_API_PREFIX = "/api/backend";

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const API_RETRY_ATTEMPTS = readPositiveInt(process.env.NEXT_PUBLIC_API_RETRY_ATTEMPTS, 3);
export const API_RETRY_DELAY_MS = readPositiveInt(process.env.NEXT_PUBLIC_API_RETRY_DELAY_MS, 1200);

export type ApiResponse<T> = {
  success: boolean;
  data: T;
  error: string | null;
};

export type Role = "admin" | "client";

export type Tenant = {
  id: string;
  name: string;
  wc_url: string;
  wp_user: string | null;
  has_wp_media_credentials: boolean;
  is_active: boolean;
  created_at: string;
};

export type User = {
  id: string;
  email: string | null;
  username: string;
  role: Role | null;
  is_superadmin: boolean;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
  memberships: Array<{
    tenant_id: string;
    tenant_name: string;
    role: Role;
  }>;
};

export type AuthSession = {
  user: User;
  tenants: Tenant[];
};

export type AdminClient = {
  id: string;
  email: string | null;
  username: string;
  role: "client";
  is_active: boolean;
  created_at: string;
  last_login: string | null;
  tenant_id: string;
  tenant_name: string;
  wc_url: string;
  wp_user: string | null;
  has_wp_media_credentials: boolean;
};

export type MediaItem = {
  id: number;
  url: string;
  thumbnail: string;
  filename: string;
  uploaded_at: string;
};

export type MediaListResponse = {
  items: MediaItem[];
  page: number;
  total_pages: number;
  total: number;
};

type RetryCallback = (details: { attempt: number; maxAttempts: number; delayMs: number; error: Error }) => void | Promise<void>;

type RequestOptions = RequestInit & {
  skipJson?: boolean;
  retryAttempts?: number;
  retryDelayMs?: number;
  onRetry?: RetryCallback;
};

function sleep(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    error.name === "AbortError" ||
    message.includes("networkerror") ||
    message.includes("failed to fetch") ||
    message.includes("network request failed") ||
    message.includes("load failed")
  );
}

async function parseResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Respuesta inesperada del servidor");
  }

  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "La solicitud falló");
  }
  return payload;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}) {
  const maxAttempts = Math.max(1, options.retryAttempts ?? API_RETRY_ATTEMPTS);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? API_RETRY_DELAY_MS);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${FRONTEND_API_PREFIX}${path}`, {
        credentials: "include",
        ...options,
        headers: {
          ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...(options.headers ?? {})
        }
      });

      if (options.skipJson) {
        return response as unknown as ApiResponse<T>;
      }

      return await parseResponse<T>(response);
    } catch (error) {
      const retryable = isRetryableNetworkError(error);
      if (!retryable || attempt >= maxAttempts) {
        if (retryable) {
          throw new Error(`No se pudo completar la solicitud después de ${maxAttempts} intentos. Revisa la conexión e inténtalo de nuevo.`);
        }
        throw error;
      }

      const normalizedError = error instanceof Error ? error : new Error("Error de red");
      if (options.onRetry) {
        await options.onRetry({
          attempt: attempt + 1,
          maxAttempts,
          delayMs: retryDelayMs,
          error: normalizedError
        });
      }
      await sleep(retryDelayMs);
    }
  }

  throw new Error("La solicitud no pudo completarse");
}

export async function uploadFileWithProgress<T>(path: string, file: File, onProgress?: (percent: number) => void) {
  return new Promise<ApiResponse<T>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${FRONTEND_API_PREFIX}${path}`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) {
        return;
      }
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText) as ApiResponse<T>;
        if (xhr.status < 200 || xhr.status >= 300 || !payload.success) {
          reject(new Error(payload.error ?? "La subida falló"));
          return;
        }
        resolve(payload);
      } catch {
        reject(new Error("Respuesta inesperada del servidor"));
      }
    };

    xhr.onerror = () => reject(new Error("Error de red durante la subida"));

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}

export async function getCurrentUser(cookieHeader?: string) {
  const response = await fetch(`${cookieHeader ? INTERNAL_API_URL : FRONTEND_API_PREFIX}/api/auth/me`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as ApiResponse<AuthSession>;
  return payload.success ? payload.data : null;
}

const ACTIVE_TENANT_KEY = "activeTenantId";

export function getStoredTenantId() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(ACTIVE_TENANT_KEY);
}

export function setStoredTenantId(tenantId: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
}

export function clearStoredTenantId() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ACTIVE_TENANT_KEY);
}

export function resolveActiveTenant(session: AuthSession) {
  const storedTenantId = getStoredTenantId();
  return session.tenants.find((tenant) => tenant.id === storedTenantId) ?? session.tenants[0] ?? null;
}

export function withTenantPath(tenantId: string | null, path: string) {
  if (!tenantId) {
    throw new Error("No hay tenant seleccionado");
  }
  return `/api/tenants/${tenantId}${path}`;
}
