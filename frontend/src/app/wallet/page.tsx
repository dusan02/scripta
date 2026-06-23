import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import Link from "next/link";
import CreditPackages from "./CreditPackages";

export const metadata: Metadata = {
  title: "Peňaženka",
  description: "Správa kreditov — história transakcií a dobíjanie",
};


async function getWalletData(userId: string) {
  try {
    const wallet = await prisma.wallet.findFirst({
      where: { userId },
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
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
            isPositive ? "text-emerald-500" : "text-muted-v"
          }`}
          style={{ background: isPositive ? "var(--accent-light)" : "var(--bg-muted)" }}
        >
          {tx.type === "TOPUP" ? "↑" : tx.type === "REFUND" ? "↩" : "↓"}
        </div>

        {/* Description */}
        <div>
          <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
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
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>{formatDate(tx.createdAt)}</div>
        </div>
      </div>

      {/* Amount */}
      <div
        className={`text-sm font-bold tabular-nums ${
          isPositive ? "text-emerald-500" : ""
        }`}
        style={!isPositive ? { color: "var(--text-secondary)" } : undefined}
      >
        {isPositive ? "+" : ""}
        {amount.toFixed(0)} kr.
      </div>
    </div>
  );
}

export default async function WalletPage() {
  const session = await getServerSession();
  if (!session?.user?.id) redirect("/login");

  const wallet = await getWalletData(session.user.id);
  const balance = wallet ? parseFloat(wallet.balance.toString()) : 0;

  return (
    <div className="page-container max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href="/" className="transition-colors" style={{ color: "var(--text-muted)" }}>Dashboard</Link>
        <span style={{ color: "var(--border-strong)" }}>/</span>
        <span style={{ color: "var(--text-secondary)" }}>Peňaženka</span>
      </div>

      <h1 className="text-3xl font-extrabold mb-8" style={{ color: "var(--text)" }}>
        Kreditová <span style={{ color: "var(--accent)" }}>peňaženka</span>
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Balance card */}
        <div className="lg:col-span-1 space-y-4">
          {/* Current balance */}
          <div
            className="glass-card p-6"
            style={{ background: "linear-gradient(135deg, var(--accent-light), var(--surface))" }}
          >
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
              Aktuálny zostatok
            </div>
            <div className="text-5xl font-extrabold tabular-nums" style={{ color: "var(--text)" }}>
              {balance.toFixed(0)}
            </div>
            <div className="font-medium mt-1" style={{ color: "var(--accent)" }}>kreditov</div>

            <div className="mt-4 pt-4 border-t text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              1 CRE dopyt = 5 kreditov
            </div>
          </div>

          {/* Stats */}
          {wallet && (
            <div className="glass-card p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span style={{ color: "var(--text-muted)" }}>Celkom transakcií</span>
                <span className="font-medium" style={{ color: "var(--text)" }}>{wallet.transactions.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: "var(--text-muted)" }}>Dobité kredity</span>
                <span className="font-medium" style={{ color: "var(--accent)" }}>
                  {wallet.transactions
                    .filter((t) => t.type === "TOPUP")
                    .reduce((s, t) => s + parseFloat(t.amount.toString()), 0)
                    .toFixed(0)}{" "}
                  kr.
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: "var(--text-muted)" }}>Spotrebované</span>
                <span className="font-medium" style={{ color: "var(--text)" }}>
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
            <p className="text-xs mt-3 text-center" style={{ color: "var(--text-muted)" }}>
              Platba cez Stripe · Bezpečná transakcia · Kredity nepretekajú
            </p>
          </div>

          {/* Transaction history */}
          <div className="glass-card p-6">
            <h2 className="section-title mb-4">História transakcií</h2>
            {!wallet || wallet.transactions.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: "var(--text-muted)" }}>
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
