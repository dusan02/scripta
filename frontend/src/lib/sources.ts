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
  { id: "basic",    label: "Základné firemné a právne registre" },
  { id: "risk",     label: "Insolvencia, exekúcie a dlhy" },
  { id: "fs",       label: "Finančná správa a DPH" },
  { id: "court",    label: "Súdy a sankcie" },
  { id: "fin",      label: "Financie a štátne zákazky" },
  { id: "asset",    label: "Majetok a práva" },
];

export const SOURCES: SourceInfo[] = [
  // ── 1. Základné firemné a právne registre (5) ──
  { id: "ORSR",            name: "Obchodný register SR",   short: "ORSR", description: "Obchodný register SR — vyhľadanie firmy podľa IČO", label: "ORSR",             sublabel: "Obchodný register",          category: "basic", enabled: true },
  { id: "ZRSR",            name: "Živnostenský register SR", short: "ŽRSR", description: "Živnostenský register SR — živnostenské oprávnenia", label: "ŽRSR",         sublabel: "Živnostenský register",      category: "basic", enabled: true },
  { id: "RPO",             name: "Register právnych osôb",  short: "RPO",  description: "Register právnych osôb SR — zoznam všetkých PO zapísaných v SR", label: "RPO",          sublabel: "Register práv. osôb",        category: "basic", enabled: false },
  { id: "RPVS",            name: "Register partnerov verejného sektora", short: "RPVS", description: "RPVS — partneri verejného sektora podľa zákona o VFPO", label: "RPVS", sublabel: "Register part. ver. sektora", category: "basic", enabled: true },
  { id: "OBCHODNY_VESTNIK", name: "Obchodný vestník",       short: "OV",   description: "Obchodný vestník SR — zverejňovanie právnych skutočností", label: "Obchodný vestník", sublabel: "Obchodný vestník SR",     category: "basic", enabled: false },

  // ── 2. Insolvencia, exekúcie a dlhy (7) ──
  { id: "INSOLVENCY",      name: "Register úpadcov",        short: "INS",  description: "Insolvenčný register — konania o úpadku a reštrukturalizácii", label: "Register úpadcov", sublabel: "Insolvenčný register",   category: "risk",  enabled: true },
  { id: "POVERENIA",       name: "Poverenia na exekúcie",   short: "POV",  description: "Register poverení na exekúcie — Ministerstvo spravodlivosti SR", label: "Poverenia", sublabel: "Poverenia na exekúcie",       category: "risk",  enabled: true },
  { id: "FINANCNA_SPRAVA", name: "Daňoví dlžníci",          short: "FS",   description: "Zoznam daňových dlžníkov — Finančná správa SR", label: "Daňoví dlžníci", sublabel: "Zoznam daňových dlžníkov",       category: "risk",  enabled: true },
  { id: "SP_DLZNICI",      name: "Sociálna poisťovňa",      short: "SP",   description: "Zoznam dlžníkov na sociálnom poistení", label: "Soc. poisťovňa", sublabel: "Dlžníci na sociálnom poistení",        category: "risk",  enabled: true },
  { id: "VSZP_DLZNICI",    name: "VšZP",                    short: "VšZP", description: "Zoznam dlžníkov na zdravotnom poistení — Všeobecná zdravotná poisťovňa", label: "VšZP", sublabel: "Dlžníci na zdravotnom poistení (VšZP)", category: "risk", enabled: true },
  { id: "DOVERA_DLZNICI",  name: "Dôvera",                  short: "Dôvera", description: "Zoznam dlžníkov na zdravotnom poistení — Dôvera zdravotná poisťovňa", label: "Dôvera", sublabel: "Dlžníci na zdravotnom poistení (Dôvera)", category: "risk", enabled: true },
  { id: "UNION_DLZNICI",   name: "UNION",                   short: "UNION", description: "Zoznam dlžníkov na zdravotnom poistení — UNION zdravotná poisťovňa", label: "UNION", sublabel: "Dlžníci na zdravotnom poistení (UNION)", category: "risk", enabled: true },

  // ── 3. Súdy a sankcie (2) ──
  { id: "CRRS",            name: "Rozhodnutia súdov",       short: "CRRS", description: "Centrálny register rozhodnutí súdov — judikatúra a rozhodnutia", label: "Rozhodnutia súdov", sublabel: "Register rozhodnutí (CRRS)", category: "court", enabled: false },
  { id: "DISQUAL",         name: "Register diskvalifikácií", short: "DIS", description: "Zoznam osôb so zákazom výkonu funkcie štatutára", label: "Diskvalifikácie", sublabel: "Zákaz výkonu funkcie štatutára", category: "court", enabled: false },

  // ── 4. Majetok a práva (3) ──
  { id: "NCRZP",           name: "Záložné práva",           short: "NCRZP", description: "Notársky centrálny register záložných práv", label: "Záložné práva",  sublabel: "Register záložných práv (NCRZP)", category: "asset", enabled: true },
  { id: "NCRD",            name: "Register dražieb",        short: "NCRD",  description: "Notársky centrálny register dražieb", label: "Register dražieb", sublabel: "Register dražieb (NCRD)",       category: "asset", enabled: true },
  { id: "OCHRANNE_ZNAMKY", name: "Ochranné známky",         short: "OZ",    description: "Register ochranných známok — Úrad priemyselného vlastníctva SR", label: "Ochranné známky", sublabel: "Register ochranných známok", category: "asset", enabled: false },

  // ── 5. Finančná správa a DPH (8) ──
  { id: "FS_DANOVE_SUBJEKTY",      name: "Index daň. spoľahlivosti", short: "IDS", description: "Index daňovej spoľahlivosti subjektov", label: "Index daň. spoľahlivosti", sublabel: "Index daňovej spoľahlivosti", category: "fs", enabled: true },
  { id: "FS_DPH_REGISTROVANI",     name: "Platitelia DPH",           short: "REG", description: "Zoznam daňových subjektov registrovaných pre DPH", label: "Platitelia DPH", sublabel: "Registrovaní platitelia DPH", category: "fs", enabled: true },
  { id: "FS_DPH_RUSENIE",          name: "Zrušenie DPH",             short: "DPH", description: "Zoznam platiteľov DPH s dôvodmi na zrušenie registrácie", label: "Zrušenie DPH", sublabel: "Dôvody na zrušenie registrácie DPH", category: "fs", enabled: true },
  { id: "FS_DPH_VYMAZANI",         name: "Vymazaní z DPH",           short: "VYM", description: "Vymazaní platitelia DPH podľa §52 ods.8", label: "Vymazaní z DPH", sublabel: "Vymazaní platitelia DPH §52 ods.8", category: "fs", enabled: true },
  { id: "FS_DPH_NADMERNY_ODPOCET", name: "Nadmerný odpočet",        short: "NOP", description: "Zoznam DPH subjektov s nadmerným odpočtom a vlastnou daňovou povinnosťou", label: "Nadmerný odpočet", sublabel: "DPH subjekty s nadmerným odpočtom", category: "fs", enabled: true },
  { id: "FS_DPH_BANKOVE_UCTY",     name: "Bankové účty DPH",         short: "BA",  description: "Zoznam zverejnených bankových účtov platiteľov DPH", label: "Bankové účty DPH", sublabel: "Zverejnené bankové účty DPH", category: "fs", enabled: false },
  { id: "FS_DAN_Z_PRIJMOV",        name: "Daň z príjmov PO",         short: "DAP", description: "Zoznam subjektov s výškou dane z príjmov právnickej osoby", label: "Daň z príjmov PO", sublabel: "Výška dane z príjmov PO", category: "fs", enabled: true },
  { id: "FS_DAN_PRIJMOV_REG",      name: "Registrácia k dani z príjmov", short: "DPR", description: "Zoznam daňových subjektov registrovaných na daň z príjmov", label: "Reg. k dani z príjmov", sublabel: "Registrácia k dani z príjmov", category: "fs", enabled: true },

  // ── 6. Financie a štátne zákazky (3) ──
  { id: "REGISTER_UZ", name: "Účtovné závierky", short: "RUZ", description: "Súvaha, výkaz ziskov a strát, kľúčové finančné ukazovatele", label: "Účtovné závierky", sublabel: "Register účtovných závierok (RUZ)", category: "fin", enabled: true },
  { id: "CRZ",         name: "Register zmlúv",    short: "CRZ", description: "Zmluvy, objednávky a faktúry zverejnené podľa zákona o VFPO", label: "Register zmlúv", sublabel: "Centrálny register zmlúv (CRZ)", category: "fin", enabled: true },
  { id: "UVO",         name: "Verejné obstarávanie", short: "UVO", description: "Profily VO/O, referencie a zákazky z registra ÚVO", label: "Verejné obstarávanie", sublabel: "Úrad pre verejné obstarávanie (UVO)", category: "fin", enabled: true },
];

export const ENABLED_SOURCES = SOURCES.filter(s => s.enabled);
export const SOURCE_IDS = ENABLED_SOURCES.map(s => s.id) as [string, ...string[]];

export const SOURCE_MAP: Record<string, SourceInfo> = Object.fromEntries(
  SOURCES.map(s => [s.id, s])
);

export const DEFAULT_SELECTED_SOURCES = ENABLED_SOURCES.map(s => s.id);

export const SOURCE_DOT_COLOR: Record<string, string> = {
  SUCCESS:     "var(--success)",
  UNAVAILABLE: "var(--warning)",
  FAILED:      "var(--danger)",
  PENDING:     "var(--border-strong)",
  PROCESSING:  "var(--info)",
};
