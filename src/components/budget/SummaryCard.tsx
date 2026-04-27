import { cn } from "@/lib/utils";

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  variant: "success" | "destructive" | "warning";
}

export function SummaryCard({ icon, label, value, variant }: SummaryCardProps) {
  const colors = {
    success: "bg-[hsl(var(--success))]/5 border-[hsl(var(--success))]/20 text-[hsl(var(--success))]",
    destructive: "bg-destructive/5 border-destructive/20 text-destructive",
    warning: "bg-[hsl(var(--warning))]/5 border-[hsl(var(--warning))]/20 text-[hsl(var(--warning))]",
  };
  return (
    <div className={cn("rounded-xl border p-3", colors[variant])}>
      <div className="flex items-center gap-1.5 mb-1 opacity-70">{icon}<span className="text-[11px] font-medium">{label}</span></div>
      <p className="text-xl font-bold font-display">{value}</p>
    </div>
  );
}
