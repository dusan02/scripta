"use client";

import { useT } from "@/components/LanguageProvider";
import Link from "next/link";
import { useSession } from "next-auth/react";
import NavBar from "@/components/NavBar";
import LandingNav from "@/components/landing/LandingNav";
import LandingFooter from "@/components/landing/LandingFooter";
import { FileIcon, DownloadIcon } from "@/components/icons";

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
      <div className="flex items-start gap-3 sm:gap-4">
        <div
          className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center"
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
      <DownloadIcon size={14} />
      {label}
    </a>
  );
}

function ViewButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:opacity-90"
      style={{
        background: "transparent",
        color: "var(--accent)",
        border: "1px solid var(--accent)",
      }}
    >
      {label} →
    </Link>
  );
}

export default function DocumentsPage() {
  const t = useT();
  const { data: session } = useSession();
  const isAnonymous = !session;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      {isAnonymous ? <LandingNav /> : <NavBar />}
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-8 sm:py-12" style={{ paddingTop: isAnonymous ? "140px" : "80px" }}>
      {/* Header */}
      <div className="mb-8 sm:mb-10">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2" style={{ color: "var(--text)" }}>{t("docs.title")}</h1>
        <p className="text-sm sm:text-base" style={{ color: "var(--text-secondary)" }}>{t("docs.subtitle")}</p>
      </div>

      {/* Sample Reports — first */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text)" }}>{t("docs.samplesTitle")}</h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>{t("docs.samplesDesc")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <DocCard
            icon={<FileIcon size={28} />}
            title="Mobis Slovakia s.r.o."
            description="Automobilový priemysel — kompletný report s finančnou analýzou, právnym posudkom a Verifa Score."
            status="available"
          >
            <ViewButton href="/samples/mobis-slovakia.pdf" label={t("docs.zobrazit")} />
            <DownloadButton href="/samples/mobis-slovakia.pdf" label="PDF" />
          </DocCard>
          <DocCard
            icon={<FileIcon size={28} />}
            title="KAMAX Fasteners s.r.o."
            description="Výroba spojovacieho materiálu — ukážka reportu s preverením registrov a forenznou analýzou."
            status="available"
          >
            <ViewButton href="/samples/kamax-fasteners.pdf" label={t("docs.zobrazit")} />
            <DownloadButton href="/samples/kamax-fasteners.pdf" label="PDF" />
          </DocCard>
          <DocCard
            icon={<FileIcon size={28} />}
            title="Continental Tires Slovakia s.r.o."
            description="Gumárenský priemysel — vzor reportu s Altman Z-Score, auditným verdiktom a semaformi nálezov."
            status="available"
          >
            <ViewButton href="/samples/continental-tires.pdf" label={t("docs.zobrazit")} />
            <DownloadButton href="/samples/continental-tires.pdf" label="PDF" />
          </DocCard>
          <DocCard
            icon={<FileIcon size={28} />}
            title="Bardejovské kúpele a.s."
            description="Zdravotníctvo a cestovný ruch — ukážka reportu pre akciovú spoločnosť s kompletnou analýzou."
            status="available"
          >
            <ViewButton href="/samples/bardejovske-kupele.pdf" label={t("docs.zobrazit")} />
            <DownloadButton href="/samples/bardejovske-kupele.pdf" label="PDF" />
          </DocCard>
        </div>
      </div>

      {/* User Manual */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text)" }}>{t("docs.manualTitle")}</h2>
        <DocCard
          icon={<FileIcon size={28} />}
          title={t("docs.manualTitle")}
          description={t("docs.manualDesc")}
          status="available"
        >
          <DownloadButton href="/documents/verifa-manual-sk.pdf" label={t("docs.downloadSK")} />
          <DownloadButton href="/documents/verifa-manual-en.pdf" label={t("docs.downloadEN")} />
          <DownloadButton href="/documents/verifa-manual-de.pdf" label={t("docs.downloadDE")} />
        </DocCard>
      </div>

      {/* Legal Documents */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text)" }}>{t("docs.termsTitle")}</h2>
        <div className="space-y-4">
          <DocCard
            icon={<FileIcon size={28} />}
            title={t("docs.termsTitle")}
            description={t("docs.termsDesc")}
            status="available"
          >
            <ViewButton href="/terms" label={t("docs.zobrazit")} />
          </DocCard>
          <DocCard
            icon={<FileIcon size={28} />}
            title={t("docs.gdprTitle")}
            description={t("docs.gdprDesc")}
            status="available"
          >
            <ViewButton href="/privacy" label={t("docs.zobrazit")} />
          </DocCard>
          <DocCard
            icon={<FileIcon size={28} />}
            title={t("docs.dpaTitle")}
            description={t("docs.dpaDesc")}
            status="available"
          >
            <ViewButton href="/dpa" label={t("docs.zobrazit")} />
          </DocCard>
        </div>
      </div>

      {/* Back link */}
      <div className="mt-12">
        <Link
          href="/"
          className="text-sm font-medium hover:underline"
          style={{ color: "var(--accent)" }}
        >
          ← {t("docs.spatDomov")}
        </Link>
      </div>
      </div>
      {isAnonymous && <LandingFooter />}
    </div>
  );
}
