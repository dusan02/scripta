import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-04-10",
});

export const CREDIT_TOPUP_OPTIONS = [
  { label: "20 kreditov", credits: 20, priceEur: 20 },
  { label: "50 kreditov", credits: 50, priceEur: 45 },
  { label: "100 kreditov", credits: 100, priceEur: 80 },
];
