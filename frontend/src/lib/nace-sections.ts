// SK NACE Rev. 2 sections (A–U)
const SECTIONS: Array<[number, number, string, string]> = [
  [1, 3, "A", "Poľnohospodárstvo, lesníctvo a rybolov"],
  [5, 9, "B", "Ťažba a dobývanie"],
  [10, 33, "C", "Priemyselná výroba"],
  [35, 35, "D", "Výroba a rozvod elektriny, plynu, pary a teplej vody"],
  [36, 39, "E", "Zásobovanie vodou, čistenie odpadových vôd"],
  [41, 43, "F", "Stavebníctvo"],
  [45, 47, "G", "Veľkoobchod a maloobchod; oprava motorových vozidiel"],
  [49, 53, "H", "Doprava a skladovanie"],
  [55, 56, "I", "Ubytovanie a stravovanie"],
  [58, 63, "J", "Informačné a komunikačné činnosti"],
  [64, 66, "K", "Finančné a poisťovacie činnosti"],
  [68, 68, "L", "Činnosti v oblasti nehnuteľností"],
  [69, 75, "M", "Profesionálne, vedecké a technické činnosti"],
  [77, 82, "N", "Ostatné činnosti služieb"],
  [84, 84, "O", "Verejná správa a obrana"],
  [85, 85, "P", "Vzdelávanie"],
  [86, 88, "Q", "Zdravotníctvo a sociálna pomoc"],
  [90, 93, "R", "Umenie, zábava a rekreácia"],
  [94, 96, "S", "Ostatné činnosti služieb"],
  [97, 98, "T", "Činnosti domácností ako zamestnávateľov"],
  [99, 99, "U", "Činnosti extrateritoriálnych organizácií"],
];

export function naceSection(code: string): { section: string; sectionName: string } {
  const div = parseInt(code.substring(0, 2), 10);
  if (isNaN(div)) return { section: "", sectionName: "" };
  for (const [lo, hi, s, sn] of SECTIONS) {
    if (div >= lo && div <= hi) return { section: s, sectionName: sn };
  }
  return { section: "", sectionName: "" };
}
