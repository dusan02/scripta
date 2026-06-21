import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import CreditPackages from "./CreditPackages";

export const metadata: Metadata = {
  title: "Peňaženka",
  description: "Správa kreditov — história transakcií a dobíjanie",
};


// For demo: load first wallet (replace with getCurrentUser session)
async function getWalletData() {
  try {
    const wallet = await prisma.wallet.findFirst({
      include: {
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            reportRequest: {
              select: { id: true, ico: true, name: true, surname: true, targetType: true },
            },
          },
        },
      },
    });
    return wallet;
  } catch {
    return null;
  }
}

const CREDIT_PACKAGES = [
  {
    id: "small",
    name: "Štartér",
    credits: 20,
    price: "9,90 €",
    perCredit: "0,50 €/kr.",
    popular: false,
    description: "Pre príležitostné overenia",
  },
  {
    id: "medium",
    name: "Profesionál",
    credits: 60,
    price: "24,90 €",
    perCredit: "0,42 €/kr.",
    popular: true,
    description: "Najobľúbenejší balík",
  },
  {
    id: "large",
    name: "Kancelária",
    credits: 150,
    price: "49,90 €",
    perCredit: "0,33 €/kr.",
    popular: false,
    description: "Pre advokátske kancelárie",
  },
];

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("sk-SK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function TransactionItem({
  tx,
}: {
  tx: {
    id: string;
    amount: { toNumber(): number } | number;
    type: string;
    createdAt: Date;
    description?: string | null;
    reportRequest?: {
      id: string;
      ico?: string | null;
      name?: string | null;
      surname?: string | null;
      targetType: string;
    } | null;
  };
}) {
  const amount = typeof tx.amount === "object" ? tx.amount.toNumber() : tx.amount;
  const isPositive = amount > 0;

  return (
    <div
      className="flex items-center justify-between py-3 border-b transition-colors"
      style={{ borderColor: "rgba(255,255,255,0.04)" }}
    >
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
            isPositive ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-700/50 text-slate-400"
          }`}
        >
          {tx.type === "TOPUP" ? "↑" : tx.type === "REFUND" ? "↩" : "↓"}
        </div>

        {/* Description */}
        <div>
          <div className="text-sm font-medium text-slate-300">
            {tx.type === "TOPUP"
              ? "Dobíjanie kreditov"
              : tx.type === "REFUND"
              ? "Vrátenie kreditov"
              : tx.reportRequest
              ? tx.reportRequest.targetType === "COMPANY"
                ? `Report — IČO ${tx.reportRequest.ico}`
                : `Report — ${tx.reportRequest.name} ${tx.reportRequest.surname}`
              : (tx.description ?? "Transakcia")}
          </div>
          <div className="text-xs text-slate-600">{formatDate(tx.createdAt)}</div>
        </div>
      </div>

      {/* Amount */}
      <div
        className={`text-sm font-bold tabular-nums ${
          isPositive ? "text-emerald-400" : "text-slate-400"
        }`}
      >
        {isPositive ? "+" : ""}
        {amount.toFixed(0)} kr.
      </div>
    </div>
  );
}

export default async function WalletPage() {
  const wallet = await getWalletData();
  const balance = wallet ? parseFloat(wallet.balance.toString()) : 0;

  return (
    <div className="page-container max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href="/" className="text-slate-500 hover:text-slate-300 transition-colors">Dashboard</Link>
        <span className="text-slate-700">/</span>
        <span className="text-slate-400">Peňaženka</span>
      </div>

      <h1 className="text-3xl font-extrabold text-white mb-8">
        Kreditová <span className="text-gradient">peňaženka</span>
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Balance card */}
        <div className="lg:col-span-1 space-y-4">
          {/* Current balance */}
          <div
            className="glass-card p-6"
            style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.06), rgba(15,32,64,0.6))" }}
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
              Aktuálny zostatok
            </div>
            <div className="text-5xl font-extrabold text-white tabular-nums">
              {balance.toFixed(0)}
            </div>
            <div className="text-emerald-400 font-medium mt-1">kreditov</div>

            <div className="mt-4 pt-4 border-t text-xs text-slate-600" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              1 CRE dopyt = 5 kreditov
            </div>
          </div>

          {/* Stats */}
          {wallet && (
            <div className="glass-card p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Celkom transakcií</span>
                <span className="text-slate-300 font-medium">{wallet.transactions.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Dobité kredity</span>
                <span className="text-emerald-400 font-medium">
                  {wallet.transactions
                    .filter((t) => t.type === "TOPUP")
                    .reduce((s, t) => s + parseFloat(t.amount.toString()), 0)
                    .toFixed(0)}{" "}
                  kr.
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Spotrebované</span>
                <span className="text-slate-300 font-medium">
                  {Math.abs(
                    wallet.transactions
                      .filter((t) => t.type === "CHARGE")
                      .reduce((s, t) => s + parseFloat(t.amount.toString()), 0)
                  ).toFixed(0)}{" "}
                  kr.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Credit packages */}
          <div className="glass-card p-6">
            <h2 className="section-title mb-4">Dobiť kredity</h2>
            <CreditPackages />
            <p className="text-xs text-slate-600 mt-3 text-center">
              Platba cez Stripe · Bezpečná transakcia · Kredity nepretekajú
            </p>
          </div>

          {/* Transaction history */}
          <div className="glass-card p-6">
            <h2 className="section-title mb-4">História transakcií</h2>
            {!wallet || wallet.transactions.length === 0 ? (
              <div className="text-center py-8 text-slate-600 text-sm">
                Zatiaľ žiadne transakcie
              </div>
            ) : (
              <div>
                {wallet.transactions.map((tx) => (
                  <TransactionItem key={tx.id} tx={tx} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
