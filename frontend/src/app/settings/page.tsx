"use client";

import { useEffect, useState, useRef } from "react";
import RegistryGrid from "@/components/RegistryGrid";
import { DEFAULT_SELECTED_SOURCES, ENABLED_SOURCES } from "@/lib/sources";
import { useT } from "@/components/LanguageProvider";
import toast from "react-hot-toast";

export default function SettingsPage() {
  const t = useT();
  const [orsrExtractType, setOrsrExtractType] = useState<"CURRENT" | "FULL">("CURRENT");
  const [crzDateFrom, setCrzDateFrom] = useState<string>("");
  const [rozhodnutiaYearFrom, setRozhodnutiaYearFrom] = useState<string>(String(new Date().getFullYear() - 1));
  const [vestnikDateFrom, setVestnikDateFrom] = useState<string>("");
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 10 }, (_, i) => String(currentYear - i));
  const [defaultSources, setDefaultSources] = useState<string[]>(DEFAULT_SELECTED_SOURCES);
  const [reportLanguage, setReportLanguage] = useState<string>("sk");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const initialRef = useRef({ orsrExtractType: "CURRENT", crzDateFrom: "", rozhodnutiaYearFrom: String(currentYear - 1), vestnikDateFrom: "", defaultSources: DEFAULT_SELECTED_SOURCES, reportLanguage: "sk" });

  const hasUnsavedChanges =
    orsrExtractType !== initialRef.current.orsrExtractType ||
    crzDateFrom !== initialRef.current.crzDateFrom ||
    rozhodnutiaYearFrom !== initialRef.current.rozhodnutiaYearFrom ||
    JSON.stringify(defaultSources) !== JSON.stringify(initialRef.current.defaultSources) ||
    reportLanguage !== initialRef.current.reportLanguage ||
    vestnikDateFrom !== initialRef.current.vestnikDateFrom;

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => {
        if (!r.ok) throw new Error("Not authorized");
        return r.json();
      })
      .then((data) => {
        if (data.orsrExtractType) setOrsrExtractType(data.orsrExtractType);
        if (data.crzDateFrom) setCrzDateFrom(data.crzDateFrom);
        if (data.rozhodnutiaDateFrom) {
          const parsedYear = new Date(data.rozhodnutiaDateFrom).getFullYear().toString();
          setRozhodnutiaYearFrom(parsedYear);
        }
        if (data.defaultSources && Array.isArray(data.defaultSources) && data.defaultSources.length > 0) {
          setDefaultSources(data.defaultSources);
        }
        if (data.reportLanguage) setReportLanguage(data.reportLanguage);
        if (data.vestnikDateFrom) setVestnikDateFrom(data.vestnikDateFrom);
        initialRef.current = {
          orsrExtractType: data.orsrExtractType || "CURRENT",
          crzDateFrom: data.crzDateFrom || "",
          rozhodnutiaYearFrom: data.rozhodnutiaDateFrom ? new Date(data.rozhodnutiaDateFrom).getFullYear().toString() : String(currentYear - 1),
          vestnikDateFrom: data.vestnikDateFrom || "",
          defaultSources: data.defaultSources?.length > 0 ? data.defaultSources : DEFAULT_SELECTED_SOURCES,
          reportLanguage: data.reportLanguage || "sk",
        };
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleSource = (id: string) =>
    setDefaultSources((p) => (p.includes(id) ? p.filter((s) => s !== id) : [...p, id]));

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orsrExtractType, crzDateFrom: crzDateFrom || null, rozhodnutiaDateFrom: rozhodnutiaYearFrom ? `${rozhodnutiaYearFrom}-01-01` : null, vestnikDateFrom: vestnikDateFrom || null, defaultSources, reportLanguage }),
      });
      initialRef.current = {
        orsrExtractType,
        crzDateFrom,
        rozhodnutiaYearFrom,
        vestnikDateFrom,
        defaultSources,
        reportLanguage,
      };
      setSaved(true);
      toast.success(t("settings.ulozene"));
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error(t("settings.chyba"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-[600px] mx-auto px-4 sm:px-6 pt-8 pb-8 animate-fade-in">
      <div className="text-center mb-8">
        <h1
          className="text-2xl font-bold tracking-tight mb-1"
          style={{ color: "var(--text)", letterSpacing: "-0.02em" }}
        >
          {t("settings.nastavenia")}
        </h1>
      <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
        {t("settings.prisposobte")}
      </p>
      </div>

      {/* ORSR Extract Type */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--text)" }}
            >
              {t("settings.typVypisu")}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("settings.vyberteTyp")}
            </p>
          </div>
        </div>

        {loading ? (
          <div
            className="h-10 rounded-lg animate-pulse"
            style={{ background: "var(--bg-muted)" }}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <label
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
              style={{
                background: orsrExtractType === "CURRENT" ? "var(--bg-muted)" : "transparent",
                border: `1px solid ${orsrExtractType === "CURRENT" ? "var(--accent)" : "var(--border)"}`,
              }}
            >
              <input
                type="radio"
                name="orsrExtractType"
                value="CURRENT"
                checked={orsrExtractType === "CURRENT"}
                onChange={() => setOrsrExtractType("CURRENT")}
                className="accent-emerald-500"
              />
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  {t("settings.aktualny")}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("settings.aktualnyPopis")}
                </div>
              </div>
            </label>

            <label
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
              style={{
                background: orsrExtractType === "FULL" ? "var(--bg-muted)" : "transparent",
                border: `1px solid ${orsrExtractType === "FULL" ? "var(--accent)" : "var(--border)"}`,
              }}
            >
              <input
                type="radio"
                name="orsrExtractType"
                value="FULL"
                checked={orsrExtractType === "FULL"}
                onChange={() => setOrsrExtractType("FULL")}
                className="accent-emerald-500"
              />
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  {t("settings.uplny")}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("settings.uplnyPopis")}
                </div>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* CRZ Date From */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--text)" }}
            >
              {t("settings.crzDatum")}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("settings.crzPopis")}
            </p>
          </div>
        </div>

        {loading ? (
          <div
            className="h-10 rounded-lg animate-pulse"
            style={{ background: "var(--bg-muted)" }}
          />
        ) : (
          <div>
            <input
              type="date"
              value={crzDateFrom}
              onChange={(e) => setCrzDateFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            />
            {crzDateFrom && (
              <button
                onClick={() => setCrzDateFrom("")}
                className="text-xs mt-2"
                style={{ color: "var(--text-muted)" }}
              >
                ↺ {t("settings.zrusitDefault").replace("↺ ", "")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Rozhodnutia Year Range */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--text)" }}
            >
              {t("settings.rozhodnutia")}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("settings.rozhodnutiaPopis")}
            </p>
          </div>
        </div>

        {loading ? (
          <div
            className="h-10 rounded-lg animate-pulse"
            style={{ background: "var(--bg-muted)" }}
          />
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>{t("settings.odRoku")}</label>
              <select
                value={rozhodnutiaYearFrom}
                onChange={(e) => setRozhodnutiaYearFrom(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>{t("settings.doRoku")}</label>
              <select
                value={String(currentYear)}
                disabled
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{
                  background: "var(--bg-muted)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                <option value={String(currentYear)}>{currentYear}</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Vestník Date From */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--text)" }}
            >
              {t("settings.vestnik")}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("settings.vestnikPopis")}
            </p>
          </div>
        </div>

        {loading ? (
          <div
            className="h-10 rounded-lg animate-pulse"
            style={{ background: "var(--bg-muted)" }}
          />
        ) : (
          <div>
            <input
              type="date"
              value={vestnikDateFrom}
              onChange={(e) => setVestnikDateFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            />
            {vestnikDateFrom && (
              <button
                onClick={() => setVestnikDateFrom("")}
                className="text-xs mt-2"
                style={{ color: "var(--text-muted)" }}
              >
                ↺ {t("settings.zrusitDefault").replace("↺ ", "")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Default Registries */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--text)" }}
            >
              {t("settings.predvoleneRegistre")}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("settings.predvolenePopis")}
            </p>
          </div>
        </div>

        {loading ? (
          <div
            className="h-32 rounded-lg animate-pulse"
            style={{ background: "var(--bg-muted)" }}
          />
        ) : (
          <RegistryGrid
            mode="selection"
            selected={defaultSources}
            onToggle={toggleSource}
            onSelectAll={() => setDefaultSources(ENABLED_SOURCES.map(s => s.id))}
            onSelectNone={() => setDefaultSources([])}
          />
        )}
      </div>

      {/* Report Language */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--text)" }}
            >
              {t("settings.jazykReportu")}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("settings.jazykReportuPopis")}
            </p>
          </div>
        </div>

        {loading ? (
          <div
            className="h-10 rounded-lg animate-pulse"
            style={{ background: "var(--bg-muted)" }}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {[
              { code: "sk", label: "Slovenčina", flag: "🇸🇰" },
              { code: "en", label: "English", flag: "🇬🇧" },
              { code: "de", label: "Deutsch", flag: "🇩🇪" },
            ].map((lang) => (
              <label
                key={lang.code}
                className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
                style={{
                  background: reportLanguage === lang.code ? "var(--bg-muted)" : "transparent",
                  border: `1px solid ${reportLanguage === lang.code ? "var(--accent)" : "var(--border)"}`,
                }}
              >
                <input
                  type="radio"
                  name="reportLanguage"
                  value={lang.code}
                  checked={reportLanguage === lang.code}
                  onChange={() => setReportLanguage(lang.code)}
                  className="accent-emerald-500"
                />
                <span style={{ fontSize: "16px" }}>{lang.flag}</span>
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  {lang.label}
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="btn-primary"
          style={{
            background: "var(--accent)",
            color: "var(--accent-button-text)",
            border: "none",
            height: "40px",
            padding: "0 24px",
            fontSize: "13.5px",
            fontWeight: 600,
            borderRadius: "8px",
            cursor: saving || loading ? "not-allowed" : "pointer",
            opacity: saving || loading ? 0.6 : 1,
          }}
        >
          {saving ? t("settings.ukladam") : t("settings.ulozit")}
        </button>
        {hasUnsavedChanges && !saved && (
          <span className="text-xs flex items-center gap-1.5 fade-in" style={{ color: "var(--text-muted)" }}>
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--warning)" }} />
            {t("settings.neulozeneZmeny")}
          </span>
        )}
        {saved && (
          <span
            className="text-xs font-medium fade-in"
            style={{ color: "var(--accent)" }}
          >
            {t("settings.ulozene")}
          </span>
        )}
      </div>
    </div>
  );
}
