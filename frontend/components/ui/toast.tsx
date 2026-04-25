"use client";

import { createContext, useContext, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type ToastItem = {
  id: number;
  title: string;
  variant: "success" | "error";
};

type ToastContextValue = {
  showToast: (title: string, variant?: "success" | "error") => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const value = useMemo(
    () => ({
      showToast(title: string, variant: "success" | "error" = "success") {
        const item = { id: Date.now() + Math.random(), title, variant };
        setItems((current) => [...current, item]);
        window.setTimeout(() => {
          setItems((current) => current.filter((entry) => entry.id !== item.id));
        }, 3500);
      }
    }),
    []
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-[60] space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "min-w-[220px] rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur",
              item.variant === "success"
                ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                : "border-rose-400/40 bg-rose-500/15 text-rose-100"
            )}
          >
            {item.title}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
