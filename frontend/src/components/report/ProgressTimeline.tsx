"use client";

import { useT } from "@/components/LanguageProvider";
import type { ReportSource } from "@/lib/reportConstants";

export default function ProgressTimeline({ status, sources }: { status: string; sources: ReportSource[] }) {
  const t = useT();
  const steps = [
    { key: "PENDING", label: t("report.prijaty") },
    { key: "PROCESSING", label: t("report.spracovanie") },
    { key: "COMPLETED", label: t("report.hotovo") },
  ];
  const statusOrder: Record<string, number> = {
    PENDING: 0,
    PROCESSING: 1,
    COMPLETED: 2,
    PARTIAL: 2,
    FAILED: 2,
  };
  const current = statusOrder[status] ?? 0;

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-0">
        {steps.map((step, i) => {
          const done = current > i || (status === "COMPLETED" && i === steps.length - 1);
          const active = current === i && status !== "COMPLETED";
          const isFailed = status === "FAILED" && i === 2;
          const isPartial = status === "PARTIAL" && i === 2;

          let bg = "var(--bg-muted)";
          let color = "var(--text-muted)";
          let border = "var(--border)";

          if (isFailed) { bg = "var(--danger-bg)"; color = "var(--danger)"; border = "var(--danger)"; }
          else if (isPartial) { bg = "var(--warning-bg)"; color = "var(--warning)"; border = "var(--warning)"; }
          else if (done) { bg = "var(--success-bg)"; color = "var(--success)"; border = "var(--success)"; }
          else if (active) { bg = "var(--info-bg)"; color = "var(--info)"; border = "var(--info)"; }

          return (
            <div key={step.key} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${active ? "animate-pulse" : ""}`}
                  style={{ background: bg, color, border: `1px solid ${border}` }}
                >
                  {done && !isFailed ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : active && !isFailed ? (
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
                      <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : isFailed ? "✗" : isPartial ? "~" : i + 1}
                </div>
                <span
                  className="text-[10px] mt-1.5 font-medium whitespace-nowrap"
                  style={{ color: isFailed || isPartial || done || active ? "var(--text)" : "var(--text-muted)" }}
                >
                  {isFailed ? t("report.zlyhalo") : isPartial ? t("report.ciastocne") : step.label}
                </span>
              </div>

              {i < steps.length - 1 && (
                <div
                  className="h-[2px] w-10 sm:w-16 md:w-28 mx-1 transition-all duration-700"
                  style={{ background: current > i ? "var(--accent)" : "var(--border)" }}
                />
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
