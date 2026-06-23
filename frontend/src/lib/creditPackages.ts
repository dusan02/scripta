export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  priceEur: string;
  priceCents: number;
  perCredit: string;
  popular: boolean;
  description: string;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: "small",
    name: "Štartér",
    credits: 20,
    priceEur: "9,90 €",
    priceCents: 990,
    perCredit: "0,50 €/kr.",
    popular: false,
    description: "Pre príležitostné overenia",
  },
  {
    id: "medium",
    name: "Profesionál",
    credits: 60,
    priceEur: "24,90 €",
    priceCents: 2490,
    perCredit: "0,42 €/kr.",
    popular: true,
    description: "Najobľúbenejší balík",
  },
  {
    id: "large",
    name: "Kancelária",
    credits: 150,
    priceEur: "49,90 €",
    priceCents: 4990,
    perCredit: "0,33 €/kr.",
    popular: false,
    description: "Pre advokátske kancelárie",
  },
];

export function getPackageById(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((pkg) => pkg.id === id);
}
