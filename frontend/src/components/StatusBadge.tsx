"use client";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

const STATUS_CONFIG: Record<string, { label: string; dotColor: string; badgeClass: string }> = {
  PENDING:    { label: "Čaká",       dotColor: "var(--text-muted)", badgeClass: "badge-pending" },
  PROCESSING: { label: "Prebieha",   dotColor: "var(--info)",        badgeClass: "badge-processing" },
  COMPLETED:  { label: "Dokončené",  dotColor: "var(--success)",     badgeClass: "badge-success" },
  PARTIAL:    { label: "Čiastočné",  dotColor: "var(--warning)",     badgeClass: "badge-warning" },
  FAILED:     { label: "Zlyhalo",    dotColor: "var(--danger)",      badgeClass: "badge-error" },
  SUCCESS:    { label: "OK",         dotColor: "var(--success)",     badgeClass: "badge-success" },
  UNAVAILABLE:{ label: "Nedostupné", dotColor: "var(--warning)",     badgeClass: "badge-warning" },
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
