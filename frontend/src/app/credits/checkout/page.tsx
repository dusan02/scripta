"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/LanguageProvider";

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (env: string) => void };
      Initialize: (opts: {
        token: string;
        eventCallback?: (data: any) => void;
      }) => void;
      Checkout: {
        open: (opts: {
          items?: { priceId: string; quantity: number }[];
          transactionId?: string;
          customer?: { email: string };
          customData?: Record<string, string>;
          settings?: {
            successUrl?: string;
            displayMode?: "overlay" | "inline";
            theme?: "light" | "dark";
          };
        }) => void;
      };
    };
  }
}

export default function CheckoutPage() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useT();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const priceId = params.get("priceId");
    const planId = params.get("planId");
    const userId = params.get("userId");
    const email = params.get("email");

    if (!priceId || !planId || !userId) {
      setStatus("error");
      setErrorMsg(t("checkout.missingParams"));
      return;
    }

    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) {
      setStatus("error");
      setErrorMsg(t("checkout.noToken"));
      return;
    }

    // Load Paddle.js if not already loaded
    const loadPaddle = (): Promise<void> => {
      if (window.Paddle) return Promise.resolve();
      return new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
        script.async = true;
        script.onload = () => resolve();
        document.head.appendChild(script);
      });
    };

    const initAndOpen = async () => {
      await loadPaddle();

      if (!window.Paddle) {
        setStatus("error");
        setErrorMsg(t("checkout.error"));
        return;
      }

      if (process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT === "sandbox") {
        window.Paddle.Environment.set("sandbox");
      }

      window.Paddle.Initialize({
        token,
        eventCallback: (data: any) => {
          if (data?.event === "checkout.completed") {
            router.replace("/credits?success=1");
          }
          if (data?.event === "checkout.closed") {
            router.replace("/credits");
          }
        },
      });

      window.Paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: email ? { email } : undefined,
        customData: { userId, planId },
        settings: {
          successUrl: `${window.location.origin}/credits?success=1`,
          displayMode: "overlay",
          theme: "light",
        },
      });
    };

    initAndOpen();
  }, [params, router]);

  if (status === "error") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: "1rem" }}>
        <p style={{ color: "var(--danger)", fontSize: "1.1rem" }}>{errorMsg}</p>
        <button
          onClick={() => router.replace("/credits")}
          style={{ padding: "0.6rem 1.5rem", background: "var(--accent)", color: "var(--accent-button-text)", border: "none", borderRadius: "8px", cursor: "pointer" }}
        >
          {t("checkout.back")}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <div style={{ textAlign: "center", gap: "1rem", display: "flex", flexDirection: "column" }}>
        <div style={{ width: "40px", height: "40px", border: "3px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
        <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>{t("checkout.loading")}</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
