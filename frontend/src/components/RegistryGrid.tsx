"use client";

import { SOURCE_CATEGORIES, SOURCES, ENABLED_SOURCES, SOURCE_MAP } from "@/lib/sources";

// ── Types ────────────────────────────────────────────────────────

interface SourceStatus {
  sourceType: string;
  status: string;
  statusMessage?: string | null;
}

type Mode = "selection" | "status";

interface RegistryGridProps {
  mode: Mode;
  // selection mode
  selected?: string[];
  onToggle?: (id: string) => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
  // status mode
  sources?: SourceStatus[];
}

// ── Status icon (for status mode) ────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === "PENDING" || status === "PROCESSING") {
    return (
      <svg className="animate-spin w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: "var(--info)" }}>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "SUCCESS") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: "var(--success)" }}>
        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "FAILED") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: "var(--danger)" }}>
        <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "UNAVAILABLE") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: "var(--warning)" }}>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" />
        <path d="M12 8v4M12 15.5v.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--border-strong)" }} />
  );
}

// ── Info icon (shared) ───────────────────────────────────────────

function InfoIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

// ── Check icon (for selection mode) ──────────────────────────────

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Lock icon (for disabled sources) ─────────────────────────────

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

// ── Main component ───────────────────────────────────────────────

export default function RegistryGrid({
  mode,
  selected = [],
  onToggle,
  onSelectAll,
  onSelectNone,
  sources = [],
}: RegistryGridProps) {
  const isSelection = mode === "selection";

  // Build a lookup for status mode
  const statusMap: Record<string, SourceStatus> = Object.fromEntries(
    sources.map(s => [s.sourceType, s])
  );

  return (
    <div>
      {/* ── Toolbar (selection mode only) ── */}
      {isSelection && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            {selected.length} z {ENABLED_SOURCES.length} registrov
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onSelectAll}
              className="text-[11px] font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--accent)" }}
            >
              Označiť všetko
            </button>
            <span style={{ color: "var(--border)" }}>·</span>
            <button
              type="button"
              onClick={onSelectNone}
              className="text-[11px] font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--text-muted)" }}
            >
              Odznačiť všetko
            </button>
          </div>
        </div>
      )}

      {/* ── Masonry grid ── */}
      <div className="columns-1 md:columns-2 xl:columns-3 gap-6">
        {SOURCE_CATEGORIES.map((cat) => {
          const catSources = SOURCES.filter((s) => s.category === cat.id);
          if (catSources.length === 0) return null;

          // Selection mode
          const catEnabled = catSources.filter(s => s.enabled);
          const catSelected = catEnabled.filter(s => selected.includes(s.id));
          const allCatSelected = catEnabled.length > 0 && catSelected.length === catEnabled.length;
          const someCatSelected = catSelected.length > 0 && !allCatSelected;

          // Status mode
          const catStatusSources = catSources
            .map(s => statusMap[s.id])
            .filter(Boolean);
          const allSuccess = catStatusSources.length > 0 && catStatusSources.every(s => s.status === "SUCCESS");
          const allFailed = catStatusSources.length > 0 && catStatusSources.every(s => s.status === "FAILED");
          const allUnavailable = catStatusSources.length > 0 && catStatusSources.every(s => s.status === "UNAVAILABLE");

          const catBorder = !isSelection
            ? allSuccess ? "var(--success)" : allFailed ? "var(--danger)" : allUnavailable ? "var(--warning)" : "var(--border-strong)"
            : "var(--border)";
          const catHeaderBg = !isSelection
            ? allSuccess ? "var(--success-bg)" : allFailed ? "var(--danger-bg)" : allUnavailable ? "var(--warning-bg)" : "var(--bg-muted)"
            : "var(--bg-muted)";
          const catHeaderColor = !isSelection
            ? allSuccess ? "var(--success-text)" : allFailed ? "var(--danger-text)" : allUnavailable ? "var(--warning-text)" : "var(--text-secondary)"
            : "var(--text-secondary)";

          const counterText = isSelection
            ? `${catSelected.length}/${catSources.length}`
            : `${catStatusSources.length}/${catSources.length}`;

          return (
            <div
              key={cat.id}
              className="rounded-xl overflow-hidden break-inside-avoid mb-6 transition-all duration-300"
              style={{
                border: `1.5px solid ${catBorder}`,
                background: "var(--surface)",
              }}
            >
              {/* Category header */}
              <div
                className={`flex items-center justify-between px-3 py-2 select-none ${isSelection ? "cursor-pointer transition-colors hover:bg-opacity-50" : ""}`}
                style={{ background: catHeaderBg, borderBottom: `1px solid ${catBorder}`, minHeight: "44px" }}
                onClick={isSelection ? () => {
                  if (allCatSelected) {
                    onSelectAll?.();
                  } else {
                    // Select all enabled in this category
                    catEnabled.forEach(s => {
                      if (!selected.includes(s.id)) onToggle?.(s.id);
                    });
                  }
                } : undefined}
              >
                <div className="flex items-center gap-2">
                  {isSelection && (
                    <span
                      className="inline-flex items-center justify-center w-4 h-4 rounded border transition-all flex-shrink-0"
                      style={{
                        background: allCatSelected ? "var(--accent)" : someCatSelected ? "var(--accent-light)" : "var(--surface)",
                        borderColor: allCatSelected || someCatSelected ? "var(--accent)" : "var(--border)",
                      }}
                    >
                      {allCatSelected && <CheckIcon />}
                      {someCatSelected && (
                        <span style={{ background: "var(--accent)", width: "6px", height: "2px", borderRadius: "1px" }} />
                      )}
                    </span>
                  )}
                  <span className="text-[11px] font-semibold transition-colors duration-300" style={{ color: catHeaderColor }}>
                    {cat.label}
                  </span>
                </div>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {counterText}
                </span>
              </div>

              {/* Source pills */}
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                {catSources.map((source) => {
                  const meta = SOURCE_MAP[source.id];
                  if (!meta) return null;

                  if (isSelection) {
                    const active = selected.includes(source.id);
                    const disabled = !source.enabled;
                    return (
                      <button
                        key={source.id}
                        type="button"
                        onClick={() => !disabled && onToggle?.(source.id)}
                        disabled={disabled}
                        title={source.description}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-150 max-w-full"
                        style={{
                          background: disabled ? "var(--bg-subtle)" : active ? "var(--accent-light)" : "var(--bg-muted)",
                          color: disabled ? "var(--text-muted)" : active ? "var(--accent)" : "var(--text-muted)",
                          border: `1px solid ${disabled ? "var(--border)" : active ? "var(--accent-border)" : "var(--border)"}`,
                          opacity: disabled ? 0.5 : 1,
                          cursor: disabled ? "not-allowed" : "pointer",
                        }}
                      >
                        {disabled && <LockIcon />}
                        {active && !disabled && <CheckIcon />}
                        <span className="truncate whitespace-nowrap">{source.label}</span>
                        <InfoIcon />
                      </button>
                    );
                  } else {
                    const s = statusMap[source.id];
                    if (!s) return null;
                    const isSuccess = s.status === "SUCCESS";
                    const isFailed = s.status === "FAILED";
                    const isUnavailable = s.status === "UNAVAILABLE";
                    const isPending = s.status === "PENDING" || s.status === "PROCESSING";

                    return (
                      <div
                        key={source.id}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-500 max-w-full"
                        style={{
                          background: isSuccess ? "var(--success-bg)" : isFailed ? "var(--danger-bg)" : isUnavailable ? "var(--warning-bg)" : "var(--bg-muted)",
                          border: `1px solid ${isSuccess ? "var(--success)" : isFailed ? "var(--danger)" : isUnavailable ? "var(--warning)" : "var(--border)"}`,
                          color: isSuccess ? "var(--success-text)" : isFailed ? "var(--danger-text)" : isUnavailable ? "var(--warning-text)" : "var(--text-secondary)",
                          opacity: isPending ? 0.5 : 1,
                        }}
                        title={meta.description ?? s.statusMessage ?? undefined}
                      >
                        <span className="truncate whitespace-nowrap">{meta.label}</span>
                        <InfoIcon />
                        <StatusIcon status={s.status} />
                      </div>
                    );
                  }
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
