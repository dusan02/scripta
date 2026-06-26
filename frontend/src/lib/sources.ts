export interface SourceInfo {
  id: string;
  name: string;
  short: string;
  description: string;
  label: string;
  sublabel: string;
  category: string;
  enabled: boolean;
}

export const SOURCE_CATEGORIES: { id: string; label: string }[] = [
  { id: "basic",    label: "Základné firemné a podnikateľské registre" },
  { id: "asset",    label: "Insolvenčný a majetkový register" },
  { id: "fs_dph",   label: "Finančná správa SR — DPH" },
  { id: "fs_dan",   label: "Finančná správa SR — Daň z príjmov" },
  { id: "fs_ost",   label: "Finančná správa SR — Ostatné" },
  { id: "inst",     label: "Poisťovne a inštitúcie" },
  { id: "acct",     label: "Ostatné" },
];

export const SOURCES: SourceInfo[] = [
  // ── Základné firemné a podnikateľské registre ──
  { id: "ORSR",       name: "ORSR",              short: "ORSR", description: "Obchodný register SR",     label: "ORSR",            sublabel: "Obchodný register",     category: "basic",   enabled: true },
  { id: "ZRSR",       name: "ŽRSR",              short: "ZRSR", description: "Živnostenský register SR",  label: "ŽRSR",            sublabel: "Živnostenský register", category: "basic",   enabled: true },
  { id: "RPVS",       name: "RPVS",              short: "RPVS", description: "Register partnerov verejného sektora", label: "RPVS", sublabel: "Register part. ver. sektora", category: "basic", enabled: true },
  { id: "REGISTER_UZ",  name: "Register účtovných závierok", short: "RUZ", description: "Súvaha, výkaz ziskov a strát, kľúčové finančné ukazovatele", label: "Účtovné závierky", sublabel: "Register účtovných závierok (RUZ)", category: "acct", enabled: true },
  { id: "CRZ",          name: "Centrálny register zmlúv", short: "CRZ", description: "Zmluvy, objednávky a faktúry zverejnené podľa zákona o VFPO", label: "Register zmlúv", sublabel: "Centrálny register zmlúv (CRZ)", category: "acct", enabled: true },

  // ── Insolvenčný a majetkový register ──
  { id: "INSOLVENCY", name: "Register úpadcov",  short: "INS",  description: "Insolvenčný register",      label: "Insolvenčný reg.", sublabel: "Register úpadcov",     category: "asset",   enabled: true },
  { id: "NCRZP",      name: "NCRZP",             short: "NCRZP",  description: "Notársky centrálny register záložných práv", label: "NCRZP", sublabel: "Register záložných práv", category: "asset", enabled: true },
  { id: "NCRD",       name: "NCRD",              short: "NCRD",   description: "Notársky centrálny register dražieb", label: "NCRD", sublabel: "Register dražieb", category: "asset", enabled: true },
  { id: "DISQUAL",    name: "Register diskvalifikácií", short: "DIS", description: "Zoznam osôb so zákazom výkonu funkcie štatutára", label: "Diskvalifikácie", sublabel: "Zákaz výkonu funkcie štatutára", category: "asset", enabled: false },

  // ── Finančná správa SR ──
  { id: "FINANCNA_SPRAVA",        name: "Daň. dlžníci",         short: "FS",   description: "Zoznam daňových dlžníkov — Finančná správa SR", label: "Daň. dlžníci", sublabel: "Zoznam daňových dlžníkov", category: "fs_ost", enabled: true },
  { id: "FS_DPH_RUSENIE",         name: "DPH rušenie",          short: "DPH",  description: "Zoznam platiteľov DPH s dôvodmi na zrušenie registrácie", label: "DPH rušenie", sublabel: "Zoznam platiteľov DPH — dôvody na zrušenie", category: "fs_dph", enabled: true },
  { id: "FS_DPH_VYMAZANI",        name: "DPH vymazaní",         short: "VYM",  description: "Vymazaní platitelia DPH podľa §52 ods.8", label: "DPH vymazaní", sublabel: "Vymazaní platitelia DPH §52 ods.8", category: "fs_dph", enabled: true },
  { id: "FS_DANOVE_SUBJEKTY",     name: "Daň. spoľahlivosť",    short: "IDS",  description: "Index daňovej spoľahlivosti subjektov", label: "Daň. spoľahlivost", sublabel: "Index daňovej spoľahlivosti subjektov", category: "fs_ost", enabled: true },
  { id: "FS_DAN_Z_PRIJMOV",       name: "Daň z príjmov",        short: "DAP",  description: "Zoznam subjektov s výškou dane z príjmov PO", label: "Daň z príjmov", sublabel: "Zoznam subjektov s výškou dane z príjmov PO", category: "fs_dan", enabled: true },
  { id: "FS_DPH_NADMERNY_ODPOCET", name: "DPH nadmerný odpočet", short: "NOP", description: "Zoznam DPH subjektov s nadmerným odpočtom a vlastnou daňovou povinnosťou", label: "DPH nadm. odpočet", sublabel: "DPH subjekty s nadmerným odpočtom", category: "fs_dph", enabled: true },
  { id: "FS_DPH_REGISTROVANI", name: "DPH registrovaní", short: "REG", description: "Zoznam daňových subjektov registrovaných pre DPH", label: "DPH registrovaní", sublabel: "Daňové subjekty registrované pre DPH", category: "fs_dph", enabled: true },
  { id: "FS_DAN_PRIJMOV_REG", name: "Daň z príjmov (reg.)", short: "DPR", description: "Zoznam daňových subjektov registrovaných na daň z príjmov", label: "Daň z príjmov (reg.)", sublabel: "Daňové subjekty registrované na daň z príjmov", category: "fs_dan", enabled: true },

  // ── Poisťovne a inštitúcie ──
  { id: "SP_DLZNICI",  name: "Sociálna poisťovňa", short: "SP",  description: "Zoznam dlžníkov na sociálnom poistení", label: "Soc. poisťovňa", sublabel: "Dlžníci na sociálnom poistení", category: "inst", enabled: true },
  { id: "VSZP_DLZNICI", name: "VšZP", short: "VšZP", description: "Zoznam dlžníkov na zdravotnom poistení — Všeobecná zdravotná poisťovňa", label: "VšZP", sublabel: "Dlžníci na zdravotnom poistení (VšZP)", category: "inst", enabled: true },
  { id: "DOVERA_DLZNICI", name: "Dôvera", short: "Dôvera", description: "Zoznam dlžníkov na zdravotnom poistení — Dôvera zdravotná poisťovňa", label: "Dôvera", sublabel: "Dlžníci na zdravotnom poistení (Dôvera)", category: "inst", enabled: true },
  { id: "UNION_DLZNICI", name: "UNION", short: "UNION", description: "Zoznam dlžníkov na zdravotnom poistení — UNION zdravotná poisťovňa", label: "UNION", sublabel: "Dlžníci na zdravotnom poistení (UNION)", category: "inst", enabled: true },
];

export const ENABLED_SOURCES = SOURCES.filter(s => s.enabled);
export const SOURCE_IDS = ENABLED_SOURCES.map(s => s.id) as [string, ...string[]];

export const SOURCE_MAP: Record<string, SourceInfo> = Object.fromEntries(
  SOURCES.map(s => [s.id, s])
);

export function getSourceName(id: string): string {
  return SOURCE_MAP[id]?.name ?? id;
}

export function getSourceShort(id: string): string {
  return SOURCE_MAP[id]?.short ?? id;
}

export function getSourceDescription(id: string): string {
  return SOURCE_MAP[id]?.description ?? id;
}

export const DEFAULT_SELECTED_SOURCES = ENABLED_SOURCES.map(s => s.id);

export const SOURCE_DOT_COLOR: Record<string, string> = {
  SUCCESS:     "var(--success)",
  UNAVAILABLE: "var(--warning)",
  FAILED:      "var(--danger)",
  PENDING:     "var(--border-strong)",
  PROCESSING:  "var(--info)",
};
