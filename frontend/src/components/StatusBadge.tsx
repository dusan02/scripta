"use client";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

const STATUS_CONFIG: Record<string, { label: string; dotColor: string; badgeClass: string }> = {
  PENDING:    { label: "Čaká",       dotColor: "var(--text-muted)", badgeClass: "badge-pending" },
  PROCESSING: { label: "Prebieha",   dotColor: "#3b82f6",           badgeClass: "badge-processing" },
  COMPLETED:  { label: "Dokončené",  dotColor: "#10b981",           badgeClass: "badge-success" },
  PARTIAL:    { label: "Čiastočné",  dotColor: "#f59e0b",           badgeClass: "badge-warning" },
  FAILED:     { label: "Zlyhalo",    dotColor: "#ef4444",           badgeClass: "badge-error" },
  SUCCESS:    { label: "OK",         dotColor: "#10b981",           badgeClass: "badge-success" },
  UNAVAILABLE:{ label: "Nedostupné", dotColor: "#f59e0b",           badgeClass: "badge-warning" },
};

export default function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    dotColor: "var(--text-muted)",
    badgeClass: "badge-pending",
  };

  const isAnimated = status === "PROCESSING";

  return (
    <span
      className={config.badgeClass}
      style={size === "sm" ? { fontSize: "10px", padding: "2px 6px" } : undefined}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full inline-block flex-shrink-0 ${isAnimated ? "animate-pulse" : ""}`}
        style={{ background: config.dotColor }}
      />
      {config.label}
    </span>
  );
}
