"use client";

import { ReportStatus, SourceStatus } from "@prisma/client";

interface StatusBadgeProps {
  status: ReportStatus | SourceStatus | string;
  size?: "sm" | "md";
}

const STATUS_CONFIG: Record<
  string,
  { label: string; dotClass: string; badgeClass: string }
> = {
  // Report statuses
  PENDING: {
    label: "Čaká",
    dotClass: "bg-slate-400",
    badgeClass: "badge-pending",
  },
  PROCESSING: {
    label: "Spracúva sa",
    dotClass: "bg-blue-400 animate-pulse",
    badgeClass: "badge-processing",
  },
  COMPLETED: {
    label: "Dokončené",
    dotClass: "bg-emerald-400",
    badgeClass: "badge-success",
  },
  PARTIAL: {
    label: "Čiastočné",
    dotClass: "bg-amber-400",
    badgeClass: "badge-warning",
  },
  FAILED: {
    label: "Zlyhalo",
    dotClass: "bg-red-400",
    badgeClass: "badge-error",
  },
  // Source statuses
  SUCCESS: {
    label: "✓ OK",
    dotClass: "bg-emerald-400",
    badgeClass: "badge-success",
  },
  UNAVAILABLE: {
    label: "Nedostupné",
    dotClass: "bg-amber-400",
    badgeClass: "badge-warning",
  },
};

export default function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    dotClass: "bg-slate-400",
    badgeClass: "badge-pending",
  };

  return (
    <span className={`${config.badgeClass} ${size === "sm" ? "text-[10px] px-2 py-0.5" : ""}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      {config.label}
    </span>
  );
}
