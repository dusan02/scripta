"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (env: string) => void };
      Initialize: (opts: { token: string; eventCallback?: (data: any) => void }) => void;
      Checkout: {
        open: (opts: { transactionId: string }) => void;
      };
    };
  }
}

export default function PaddleCheckoutHandler() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ptxn = params.get("_ptxn");

    if (!ptxn) return;

    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) {
      console.error("Paddle: NEXT_PUBLIC_PADDLE_CLIENT_TOKEN not set");
      return;
    }

    // Wait for Paddle.js to load, then initialize and open checkout
    const initPaddle = () => {
      if (!window.Paddle) {
        setTimeout(initPaddle, 100);
        return;
      }

      // Set sandbox environment BEFORE Initialize
      if (process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT === "sandbox") {
        window.Paddle.Environment.set("sandbox");
      }

      window.Paddle.Initialize({
        token,
        eventCallback: (data: any) => {
          console.log("Paddle event:", data?.event);
        },
      });

      // Small delay to ensure Initialize completes
      setTimeout(() => {
        window.Paddle?.Checkout.open({
          transactionId: ptxn,
        });
      }, 200);
    };

    initPaddle();
  }, []);

  return null;
}
