"use client";

import React from "react";
import Image from "next/image";
import { useTheme } from "@/components/ThemeProvider";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  forceLight?: boolean;
}

export default function Logo({ size = "md", forceLight = false }: LogoProps) {
  const { theme } = useTheme();
  const heights = { lg: 72, md: 56, sm: 40 };
  const h = heights[size];
  const w = Math.round(h * (1024 / 348));

  const isDark = theme === "dark" && !forceLight;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        userSelect: "none",
        cursor: "pointer",
        lineHeight: 1,
        minHeight: h,
        minWidth: w,
      }}
    >
      {/* next/image serves a resized variant of the 1024×348 source (~100 kB → few kB) */}
      <Image
        key={isDark ? "dark" : "light"}
        src={isDark ? "/logo-verifa-dark.png" : "/logo-verifa.png"}
        alt="Verifa.sk"
        width={w}
        height={h}
        style={{ height: h, width: w, display: "block" }}
      />
    </div>
  );
}
