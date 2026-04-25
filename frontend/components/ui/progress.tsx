import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2.5 w-full overflow-hidden rounded-full bg-accent", className)}>
      <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${value}%` }} />
    </div>
  );
}
