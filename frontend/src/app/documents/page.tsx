"use client";

import { useT } from "@/components/LanguageProvider";
import Link from "next/link";

function FileIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h6M9 9h2" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function DocCard({
  icon,
  title,
  description,
  status,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  status?: "available" | "soon";
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-5 border transition-all duration-200 hover:shadow-md"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center"
          style={{
            background: status === "soon" ? "var(--bg-muted)" : "var(--accent-light)",
            color: status === "soon" ? "var(--text-muted)" : "var(--accent)",
          }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>{title}</h3>
            {status === "soon" && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}
              >
                SOON
              </span>
            )}
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{description}</p>
          {children && <div className="mt-4 flex flex-wrap gap-2">{children}</div>}
        </div>
      </div>
    </div>
  );
}

function DownloadButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:opacity-90"
      style={{
        background: "var(--accent)",
        color: "var(--accent-button-text)",
      }}
    >
      <DownloadIcon />
      {label}
    </a>
  );
}

export default function DocumentsPage() {
  const t = useT();

  return (
    <div className="max-w-[900px] mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--text)" }}>{t("docs.title")}</h1>
        <p className="text-base" style={{ color: "var(--text-secondary)" }}>{t("docs.subtitle")}</p>
      </div>

      {/* User Manual */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text)" }}>{t("docs.manualTitle")}</h2>
        <DocCard
          icon={<FileIcon />}
          title={t("docs.manualTitle")}
          description={t("docs.manualDesc")}
          status="available"
        >
          <DownloadButton href="/documents/verifa-manual-sk.pdf" label={t("docs.downloadSK")} />
          <DownloadButton href="/documents/verifa-manual-en.pdf" label={t("docs.downloadEN")} />
          <DownloadButton href="/documents/verifa-manual-de.pdf" label={t("docs.downloadDE")} />
        </DocCard>
      </div>

      {/* Sample Reports */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text)" }}>{t("docs.samplesTitle")}</h2>
        <DocCard
          icon={<ClockIcon />}
          title={t("docs.samplesTitle")}
          description={t("docs.samplesDesc")}
          status="soon"
        />
      </div>

      {/* Legal Documents */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text)" }}>{t("docs.termsTitle")}</h2>
        <div className="space-y-4">
          <DocCard
            icon={<ClockIcon />}
            title={t("docs.termsTitle")}
            description={t("docs.termsDesc")}
            status="soon"
          />
          <DocCard
            icon={<ClockIcon />}
            title={t("docs.gdprTitle")}
            description={t("docs.gdprDesc")}
            status="soon"
          />
        </div>
      </div>

      {/* Back link */}
      <div className="mt-12">
        <Link
          href="/"
          className="text-sm font-medium hover:underline"
          style={{ color: "var(--accent)" }}
        >
          ← {t("nav.dokumenty")}
        </Link>
      </div>
    </div>
  );
}
