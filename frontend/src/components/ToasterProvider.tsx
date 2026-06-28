"use client";

import { Toaster } from "react-hot-toast";
import { useTheme } from "@/components/ThemeProvider";

export default function ToasterProvider() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 3000,
        style: {
          background: isDark ? "rgba(28, 28, 31, 0.92)" : "rgba(255, 255, 255, 0.92)",
          color: "var(--text)",
          border: `1px solid ${isDark ? "rgba(63, 63, 70, 0.8)" : "rgba(228, 228, 231, 0.8)"}`,
          borderRadius: "10px",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          boxShadow: isDark
            ? "0 8px 24px rgba(0, 0, 0, 0.4)"
            : "0 8px 24px rgba(0, 0, 0, 0.12)",
          fontSize: "13px",
          fontWeight: 500,
          padding: "10px 14px",
        },
        success: {
          iconTheme: {
            primary: "#5b9279",
            secondary: isDark ? "#1c1c1f" : "#ffffff",
          },
        },
        error: {
          iconTheme: {
            primary: "#ef4444",
            secondary: isDark ? "#1c1c1f" : "#ffffff",
          },
        },
      }}
    />
  );
}
