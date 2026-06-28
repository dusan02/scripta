"use client";

import { useT } from "@/components/LanguageProvider";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

const STATUS_CONFIG: Record<string, { key: string; dotColor: string; badgeClass: string; glowVar?: string }> = {
  PENDING:    { key: "status.caka",       dotColor: "var(--text-muted)", badgeClass: "badge-pending" },
  PROCESSING: { key: "status.prebieha",   dotColor: "var(--info)",        badgeClass: "badge-processing", glowVar: "var(--glow-info)" },
  COMPLETED:  { key: "status.dokoncene",  dotColor: "var(--success)",     badgeClass: "badge-success",    glowVar: "var(--glow-success)" },
  PARTIAL:    { key: "status.ciastocne",  dotColor: "var(--warning)",     badgeClass: "badge-warning",    glowVar: "var(--glow-warning)" },
  FAILED:     { key: "status.zlyhalo",    dotColor: "var(--danger)",      badgeClass: "badge-error",      glowVar: "var(--glow-danger)" },
  SUCCESS:    { key: "status.ok",         dotColor: "var(--success)",     badgeClass: "badge-success",    glowVar: "var(--glow-success)" },
  UNAVAILABLE:{ key: "status.nedostupne", dotColor: "var(--warning)",     badgeClass: "badge-warning",    glowVar: "var(--glow-warning)" },
};

export default function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const t = useT();
  const config = STATUS_CONFIG[status] ?? {
    key: status,
    dotColor: "var(--text-muted)",
    badgeClass: "badge-pending",
  };

  const isAnimated = status === "PROCESSING";

  return (
    <span
      className={config.badgeClass}
      style={{
        ...(size === "sm" ? { fontSize: "10px", padding: "2px 6px" } : undefined),
        ...(config.glowVar ? { boxShadow: config.glowVar } : undefined),
      }}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full inline-block flex-shrink-0 ${isAnimated ? "animate-pulse" : ""}`}
        style={{ background: config.dotColor }}
      />
      {t(config.key)}
    </span>
  );
}
