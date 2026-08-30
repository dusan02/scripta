// LAU1 (NUTS4) codes → Slovak district names
// Source: Eurostat / Statistical Office of the SR
// Used to display human-readable district names in screener filters
// instead of raw codes like "SK0101".

export const OKRES_CODE_TO_NAME: Record<string, string> = {
  // Bratislava Region
  SK0101: "Bratislava I",
  SK0102: "Bratislava II",
  SK0103: "Bratislava III",
  SK0104: "Bratislava IV",
  SK0105: "Bratislava V",
  SK0106: "Malacky",
  SK0107: "Pezinok",
  SK0108: "Senec",
  // Trnava Region
  SK0211: "Dunajská Streda",
  SK0212: "Galanta",
  SK0213: "Hlohovec",
  SK0214: "Piešťany",
  SK0215: "Senica",
  SK0216: "Skalica",
  SK0217: "Trnava",
  // Trenčín Region
  SK0221: "Bánovce nad Bebravou",
  SK0222: "Ilava",
  SK0223: "Myjava",
  SK0224: "Nové Mesto nad Váhom",
  SK0225: "Partizánske",
  SK0226: "Považská Bystrica",
  SK0227: "Prievidza",
  SK0228: "Púchov",
  SK0229: "Trenčín",
  // Nitra Region
  SK0231: "Komárno",
  SK0232: "Levice",
  SK0233: "Nitra",
  SK0234: "Nové Zámky",
  SK0235: "Šaľa",
  SK0236: "Topoľčany",
  SK0237: "Zlaté Moravce",
  // Žilina Region
  SK0311: "Bytča",
  SK0312: "Čadca",
  SK0313: "Dolný Kubín",
  SK0314: "Kysucké Nové Mesto",
  SK0315: "Liptovský Mikuláš",
  SK0316: "Martin",
  SK0317: "Námestovo",
  SK0318: "Ružomberok",
  SK0319: "Turčianske Teplice",
  SK031A: "Tvrdošín",
  SK031B: "Žilina",
  // Banská Bystrica Region
  SK0321: "Banská Bystrica",
  SK0322: "Banská Štiavnica",
  SK0323: "Brezno",
  SK0324: "Detva",
  SK0325: "Krupina",
  SK0326: "Lučenec",
  SK0327: "Poltár",
  SK0328: "Revúca",
  SK0329: "Rimavská Sobota",
  SK032A: "Veľký Krtíš",
  SK032B: "Zvolen",
  SK032C: "Žarnovica",
  SK032D: "Žiar nad Hronom",
  // Prešov Region
  SK0411: "Bardejov",
  SK0412: "Humenné",
  SK0413: "Kežmarok",
  SK0414: "Levoča",
  SK0415: "Medzilaborce",
  SK0416: "Poprad",
  SK0417: "Prešov",
  SK0418: "Sabinov",
  SK0419: "Snina",
  SK041A: "Stará Ľubovňa",
  SK041B: "Stropkov",
  SK041C: "Svidník",
  SK041D: "Vranov nad Topľou",
  // Košice Region
  SK0421: "Gelnica",
  SK0422: "Košice I",
  SK0423: "Košice II",
  SK0424: "Košice III",
  SK0425: "Košice IV",
  SK0426: "Košice – okolie",
  SK0427: "Michalovce",
  SK0428: "Rožňava",
  SK0429: "Sobrance",
  SK042A: "Spišská Nová Ves",
  SK042B: "Trebišov",
};

export function okresName(code: string): string {
  if (code === "SKZZZZ") return "Zahraničné";
  return OKRES_CODE_TO_NAME[code] || code;
}
