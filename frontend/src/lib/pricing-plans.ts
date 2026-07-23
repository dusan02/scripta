export interface PricingPlan {
  id: string;
  nameKey: string;
  subtitleKey: string;
  reports: number;
  price: string;
  pricePerReport: string;
  isSubscription: boolean;
  featureKeys: string[];
  highlight: boolean;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "payg1",
    nameKey: "pricing.payg1",
    subtitleKey: "pricing.payg1Subtitle",
    reports: 1,
    price: "14",
    pricePerReport: "14,00",
    isSubscription: false,
    featureKeys: [
      "pricing.feat30Registre",
      "pricing.featAnalyzaFinancnychVykazov",
      "pricing.featRizikoveUpozornenia",
      "pricing.featInsolvencne",
      "pricing.featDphPravne",
      "pricing.featZaverneSkore",
      "pricing.featPdfReport",
      "pricing.featExportReportu",
    ],
    highlight: false,
  },
  {
    id: "payg10",
    nameKey: "pricing.payg10",
    subtitleKey: "pricing.payg10Subtitle",
    reports: 10,
    price: "89",
    pricePerReport: "8,90",
    isSubscription: false,
    featureKeys: [
      "pricing.featAllFromStart",
      "pricing.featZlavnenie",
      "pricing.featHistoria",
      "pricing.featPdfArchivacia",
      "pricing.featExportReportu",
    ],
    highlight: true,
  },
  {
    id: "payg50",
    nameKey: "pricing.payg50",
    subtitleKey: "pricing.payg50Subtitle",
    reports: 50,
    price: "349",
    pricePerReport: "6,98",
    isSubscription: false,
    featureKeys: [
      "pricing.featAllFromStart",
      "pricing.featZlavnenie",
      "pricing.featHistoria",
      "pricing.featPdfArchivacia",
      "pricing.featExportReportu",
    ],
    highlight: false,
  },
  {
    id: "freelance",
    nameKey: "pricing.freelance",
    subtitleKey: "pricing.freelanceSubtitle",
    reports: 5,
    price: "49",
    pricePerReport: "9,80",
    isSubscription: true,
    featureKeys: [
      "pricing.featAllFromStart",
      "pricing.feat15Kreditov",
      "pricing.featHistoria",
      "pricing.featPrioritneSpracovanie",
      "pricing.featPdfArchivacia",
      "pricing.featRollOver",
    ],
    highlight: false,
  },
  {
    id: "firma",
    nameKey: "pricing.firma",
    subtitleKey: "pricing.firmaSubtitle",
    reports: 20,
    price: "159",
    pricePerReport: "7,95",
    isSubscription: true,
    featureKeys: [
      "pricing.featAllFromFreelance",
      "pricing.feat40Kreditov",
      "pricing.featPrioritnaPodpora",
      "pricing.featRychlejsieSpracovanie",
      "pricing.featObchodneTimy",
      "pricing.featUctovneKancelarie",
      "pricing.featRollOver",
    ],
    highlight: true,
  },
  {
    id: "korporat",
    nameKey: "pricing.korporat",
    subtitleKey: "pricing.korporatSubtitle",
    reports: 40,
    price: "289",
    pricePerReport: "7,23",
    isSubscription: true,
    featureKeys: [
      "pricing.featAllFromFirma",
      "pricing.feat100Kreditov",
      "pricing.featPrioritnaPodpora",
      "pricing.featOsobnyAccount",
      "pricing.featNajnejsiaCena",
      "pricing.featBankyAdvokati",
      "pricing.featRollOver",
    ],
    highlight: false,
  },
];

export const REPORT_INCLUDES_KEYS = [
  "pricing.inc30Registre",
  "pricing.incAiFinancna",
  "pricing.incAltman",
  "pricing.incRizika",
  "pricing.incInsolvencie",
  "pricing.incExekucie",
  "pricing.incDiskvalifikacie",
  "pricing.incZalozne",
  "pricing.incDph",
  "pricing.incMajetok",
  "pricing.incAiOdporucania",
  "pricing.incPdfShare",
];
