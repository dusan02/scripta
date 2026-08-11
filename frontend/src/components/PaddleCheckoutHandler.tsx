"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    Paddle?: {
      Environment: (env: string) => void;
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

    // Wait for Paddle.js to load
    const initPaddle = () => {
      if (!window.Paddle) {
        setTimeout(initPaddle, 100);
        return;
      }

      const isSandbox = process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT === "sandbox";
      if (isSandbox) {
        window.Paddle.Environment("sandbox");
      }

      window.Paddle.Initialize({
        token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN || "",
      });

      // Open overlay checkout
      window.Paddle.Checkout.open({
        transactionId: ptxn,
      });
    };

    initPaddle();
  }, []);

  return null;
}
