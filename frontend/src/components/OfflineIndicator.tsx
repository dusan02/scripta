"use client";

import { useState, useEffect } from "react";
import { useT } from "@/components/LanguageProvider";

export default function OfflineIndicator() {
  const t = useT();
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setIsOffline(!navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 py-2 text-xs font-medium fade-in"
      style={{
        background: "var(--danger)",
        color: "#fff",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0125 20M5.28 11.06A10.94 10.94 0 0025 20M12 5v14M2 12h2M20 12h2" />
      </svg>
      {t("global.offline")}
    </div>
  );
}
