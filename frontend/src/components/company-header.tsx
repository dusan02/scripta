"use client";

import Link from "next/link";
import { fmtYear, fmtEUR } from "@/lib/format";
import { useT } from "@/components/LanguageProvider";

type CompanyInfo = {
  ico: string;
  name: string | null;
  legalForm: string | null;
  city: string | null;
  street: string | null;
  zipCode: string | null;
  establishedAt: Date | null;
  naceText: string | null;
  naceCode: string | null;
  kraj: string | null;
  okres: string | null;
  shareCapital: number | string | null;
  legalStatus: string | null;
  ruzDissolutionDate: Date | null;
  ruzReportingStatus: string | null;
};

const KRAJ_NAMES: Record<string, string> = {
  SK010: "Bratislavský kraj",
  SK021: "Trnavský kraj",
  SK022: "Nitriansky kraj",
  SK023: "Trenčiansky kraj",
  SK031: "Žilinský kraj",
  SK032: "Banskobystrický kraj",
  SK041: "Prešovský kraj",
  SK042: "Košický kraj",
};

const OKRES_NAMES: Record<string, string> = {
  SK0101: "Bratislava I", SK0102: "Bratislava II", SK0103: "Bratislava III",
  SK0104: "Bratislava IV", SK0105: "Bratislava V", SK0106: "Malacky",
  SK0107: "Pezinok", SK0108: "Senec",
  SK0201: "Dunajská Streda", SK0202: "Galanta", SK0203: "Hlohovec",
  SK0204: "Piešťany", SK0205: "Senica", SK0206: "Skalica", SK0207: "Trnava",
  SK0301: "Komárno", SK0302: "Levice", SK0303: "Nitra", SK0304: "Nové Zámky",
  SK0305: "Topoľčany", SK0306: "Zlaté Moravce", SK0307: "Šaľa",
  SK0401: "Bánovce nad Bebravou", SK0402: "Ilava", SK0403: "Myjava",
  SK0404: "Partizánske", SK0405: "Považská Bystrica", SK0406: "Prievidza",
  SK0407: "Púchov", SK0408: "Trenčín", SK0409: "Nové Mesto nad Váhom",
  SK0501: "Bytča", SK0502: "Čadca", SK0503: "Dolný Kubín", SK0504: "Kysucké Nové Mesto",
  SK0505: "Liptovský Mikuláš", SK0506: "Martin", SK0507: "Namestovo",
  SK0508: "Ružomberok", SK0509: "Turčianske Teplice", SK0510: "Tvrdošín",
  SK0511: "Žilina",
  SK0601: "Banská Štiavnica", SK0602: "Banská Bystrica", SK0603: "Brezno",
  SK0604: "Detva", SK0605: "Krupina", SK0606: "Lučenec", SK0607: "Poltár",
  SK0608: "Revúca", SK0609: "Rimavská Sobota", SK0610: "Veľký Krtíš",
  SK0611: "Zvolen", SK0612: "Žarnovica", SK0613: "Žiar nad Hronom",
  SK0701: "Bardejov", SK0702: "Humenné", SK0703: "Kežmarok", SK0704: "Levoča",
  SK0705: "Medzilaborce", SK0706: "Poprad", SK0707: "Prešov", SK0708: "Sabinov",
  SK0709: "Snina", SK0710: "Stará Ľubovňa", SK0711: "Stropkov", SK0712: "Svidník",
  SK0713: "Vranov nad Topľou",
  SK0801: "Gelnica", SK0802: "Košice I", SK0803: "Košice II", SK0804: "Košice III",
  SK0805: "Košice IV", SK0806: "Košice-okolie", SK0807: "Michalovce", SK0808: "Rožňava",
  SK0809: "Sobrance", SK0810: "Spišská Nová Ves", SK0811: "Trebišov",
};

function slugifyCity(city: string): string {
  return city
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
}

function getNaceSection(code: string | null): string | null {
  if (!code || code.length < 1) return null;
  return code[0];
}

export function CompanyHeader({ company, latestYear, riskCount }: { company: CompanyInfo; latestYear?: number; riskCount?: number })  {
  const t = useT();
  const name = company.name || `${t("company.ico")} ${company.ico}`;

  const cityPart = company.city ? t("company.descCity", { city: company.city }) : "";
  const legalFormPart = company.legalForm ? t("company.descLegalForm", { legalForm: company.legalForm }) : "";
  const establishedPart = company.establishedAt ? t("company.descEstablished", { year: fmtYear(company.establishedAt) }) : "";
  const nacePart = company.naceText ? t("company.descNace", { nace: company.naceText }) : "";
  const latestYearPart = latestYear ? t("company.descLatestYear", { year: String(latestYear) }) : "";

  const krajLabel = company.kraj ? KRAJ_NAMES[company.kraj] || company.kraj : null;
  const okresLabel = company.okres ? OKRES_NAMES[company.okres] || company.okres : null;
  const naceSection = getNaceSection(company.naceCode);

  const legalStatusLabel: Record<string, string> = {
    ACTIVE: t("firma.statusActive"),
    LIQUIDATION: t("firma.statusLiquidation"),
    BANKRUPT: t("firma.statusBankrupt"),
    RESTRUCTURING: t("firma.statusRestructuring"),
    DISSOLVED: t("firma.statusDissolved"),
  };
  const showLegalStatus = company.legalStatus && company.legalStatus !== "UNKNOWN" && company.legalStatus !== "ACTIVE";

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h1 className="text-xl sm:text-2xl font-black" style={{ color: "var(--text)" }}>{name}</h1>
        {riskCount != null && riskCount > 0 && (
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{
              background: "var(--danger-bg, #fef2f2)",
              border: "1px solid var(--danger-border, #fecaca)",
              color: "var(--danger, #dc2626)",
            }}
          >
            ⚠ {riskCount} {riskCount === 1 ? t("firma.rizikovySignal") : t("firma.rizikoveSignalyMnozne")}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs sm:text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
        <span><strong>{t("company.ico")}:</strong> {company.ico}</span>
        {company.legalForm && <span><strong>{t("company.pravnaForma")}:</strong> {company.legalForm}</span>}
        {company.city && (
          <span>
            <strong>{t("firma.sidlo")}:</strong> {company.street ? `${company.street}, ` : ""}
            {company.city ? (
              <Link href={`/mesto/${slugifyCity(company.city)}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                {company.city}
              </Link>
            ) : null}
            {company.zipCode ? `, ${company.zipCode}` : ""}
          </span>
        )}
        {company.establishedAt && <span><strong>{t("firma.zalozena")}:</strong> {fmtYear(company.establishedAt)}</span>}
        {company.naceText && (
          <span>
            <strong>{t("firma.predmetCinnosti")}:</strong>{" "}
            {naceSection && (
              <Link href={`/odvetvie/${naceSection}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                {company.naceText}
              </Link>
            ) || company.naceText}
          </span>
        )}
        {company.shareCapital != null && Number(company.shareCapital) > 0 && (
          <span><strong>{t("firma.zakladneImanie")}:</strong> {fmtEUR(Number(company.shareCapital))}</span>
        )}
        {showLegalStatus && company.legalStatus && (
          <span style={{ color: "var(--danger, #dc2626)" }}>
            <strong>{t("firma.stavFirmy")}:</strong> {legalStatusLabel[company.legalStatus] || company.legalStatus}
          </span>
        )}
        {company.ruzDissolutionDate && (
          <span style={{ color: "var(--text-muted)" }}>
            <strong>{t("firma.datumZaniku")}:</strong> {fmtYear(company.ruzDissolutionDate)}
          </span>
        )}
      </div>
      {/* Internal linking: kraj + okres */}
      {(krajLabel || okresLabel) && (
        <div className="flex flex-wrap gap-1.5 mt-1.5 no-print">
          {krajLabel && (
            <Link
              href={`/kraj/${company.kraj}`}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full hover:opacity-80"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              {krajLabel}
            </Link>
          )}
          {okresLabel && (
            <Link
              href={`/okres/${company.okres}`}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full hover:opacity-80"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              {okresLabel}
            </Link>
          )}
          {company.ruzReportingStatus === "VERIFIED" && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
              RÚZ: overené
            </span>
          )}
          {company.ruzReportingStatus === "NOT_FOUND" && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
              RÚZ: nenájdené
            </span>
          )}
        </div>
      )}
      <p className="sr-only">
        {t("company.desc", { name, ico: company.ico, city: cityPart, legalForm: legalFormPart, established: establishedPart, nace: nacePart })}{latestYearPart}
      </p>
    </div>
  );
}
