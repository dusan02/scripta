export interface SourceInfo {
  id: string;
  name: string;
  short: string;
  description: string;
  label: string;
  sublabel: string;
  cost: number;
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
];

export const SOURCES: SourceInfo[] = [
  // ── Základné firemné a podnikateľské registre ──
  { id: "ORSR",       name: "ORSR",              short: "ORSR", description: "Obchodný register SR",     label: "ORSR",            sublabel: "Obchodný register",     cost: 0, category: "basic",   enabled: true },
  { id: "ZRSR",       name: "ŽRSR",              short: "ZRSR", description: "Živnostenský register SR",  label: "ŽRSR",            sublabel: "Živnostenský register", cost: 0, category: "basic",   enabled: true },
  { id: "RPVS",       name: "RPVS",              short: "RPVS", description: "Register partnerov verejného sektora", label: "RPVS", sublabel: "Register part. ver. sektora", cost: 0, category: "basic", enabled: true },
  { id: "RUZ",        name: "Register účtovných závierok", short: "RUZ", description: "Súvaha, výkaz ziskov a strát, kľúčové finančné ukazovatele", label: "Účtovné závierky", sublabel: "Register účtovných závierok (RUZ)", cost: 0, category: "basic", enabled: false },

  // ── Insolvenčný a majetkový register ──
  { id: "INSOLVENCY", name: "Register úpadcov",  short: "INS",  description: "Insolvenčný register",      label: "Insolvenčný reg.", sublabel: "Register úpadcov",     cost: 0, category: "asset",   enabled: true },
  { id: "NCRZP",      name: "NCRZP",             short: "NCR",  description: "Notársky centrálny register záložných práv", label: "NCRZP", sublabel: "Register záložných práv", cost: 0, category: "asset", enabled: false },
  { id: "DISQUAL",    name: "Register diskvalifikácií", short: "DIS", description: "Zoznam osôb so zákazom výkonu funkcie štatutára", label: "Diskvalifikácie", sublabel: "Zákaz výkonu funkcie štatutára", cost: 0, category: "asset", enabled: false },

  // ── Finančná správa SR ──
  { id: "FINANCNA_SPRAVA",        name: "Daň. dlžníci",         short: "FS",   description: "Zoznam daňových dlžníkov — Finančná správa SR", label: "Daň. dlžníci", sublabel: "Zoznam daňových dlžníkov", cost: 0, category: "fs_ost", enabled: true },
  { id: "FS_DPH_RUSENIE",         name: "DPH rušenie",          short: "DPH",  description: "Zoznam platiteľov DPH s dôvodmi na zrušenie registrácie", label: "DPH rušenie", sublabel: "Zoznam platiteľov DPH — dôvody na zrušenie", cost: 0, category: "fs_dph", enabled: true },
  { id: "FS_DPH_VYMAZANI",        name: "DPH vymazaní",         short: "VYM",  description: "Vymazaní platitelia DPH podľa §52 ods.8", label: "DPH vymazaní", sublabel: "Vymazaní platitelia DPH §52 ods.8", cost: 0, category: "fs_dph", enabled: true },
  { id: "FS_DANOVE_SUBJEKTY",     name: "Daň. spoľahlivosť",    short: "IDS",  description: "Index daňovej spoľahlivosti subjektov", label: "Daň. spoľahlivost", sublabel: "Index daňovej spoľahlivosti subjektov", cost: 0, category: "fs_ost", enabled: true },
  { id: "FS_DAN_Z_PRIJMOV",       name: "Daň z príjmov",        short: "DAP",  description: "Zoznam subjektov s výškou dane z príjmov PO", label: "Daň z príjmov", sublabel: "Zoznam subjektov s výškou dane z príjmov PO", cost: 0, category: "fs_dan", enabled: true },
  { id: "FS_DPH_NADMERNY_ODPOCET", name: "DPH nadmerný odpočet", short: "NOP", description: "Zoznam DPH subjektov s nadmerným odpočtom a vlastnou daňovou povinnosťou", label: "DPH nadm. odpočet", sublabel: "DPH subjekty s nadmerným odpočtom", cost: 0, category: "fs_dph", enabled: true },
  { id: "FS_DPH_REGISTROVANI", name: "DPH registrovaní", short: "REG", description: "Zoznam daňových subjektov registrovaných pre DPH", label: "DPH registrovaní", sublabel: "Daňové subjekty registrované pre DPH", cost: 0, category: "fs_dph", enabled: true },
  { id: "FS_DAN_PRIJMOV_REG", name: "Daň z príjmov (reg.)", short: "DPR", description: "Zoznam daňových subjektov registrovaných na daň z príjmov", label: "Daň z príjmov (reg.)", sublabel: "Daňové subjekty registrované na daň z príjmov", cost: 0, category: "fs_dan", enabled: true },

  // ── Poisťovne a inštitúcie ──
  { id: "SP_DLZNICI",  name: "Sociálna poisťovňa", short: "SP",  description: "Zoznam dlžníkov na sociálnom poistení", label: "Soc. poisťovňa", sublabel: "Dlžníci na sociálnom poistení", cost: 0, category: "inst", enabled: true },
  { id: "ZP_DLZNICI",  name: "Zdravotné poisťovne", short: "ZP", description: "Dlžníci na zdravotnom poistení (VšZP, Dôvera, Union)", label: "Zdrav. poisťovne", sublabel: "Dlžníci na zdravotnom poistení", cost: 0, category: "inst", enabled: false },
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

export const SOURCE_COSTS: Record<string, number> = Object.fromEntries(
  ENABLED_SOURCES.map(s => [s.id, s.cost])
);

export const DEFAULT_SELECTED_SOURCES = ENABLED_SOURCES.map(s => s.id);

export function calculateCost(sources: string[]): number {
  return sources.reduce((sum, source) => sum + (SOURCE_COSTS[source] ?? 0), 0);
}
