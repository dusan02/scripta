"use client";

import React from "react";
import { useTheme } from "@/components/ThemeProvider";

interface LogoProps {
  size?: "md" | "lg";
  forceLight?: boolean;
}

export default function Logo({ size = "md", forceLight = false }: LogoProps) {
  const { theme } = useTheme();
  // We use height based on size. The image has a wide aspect ratio.
  const height = size === "lg" ? "72px" : "56px";
  
  // Auth cards (which often use size="lg" or pass forceLight) are always white, so we need the dark text version.
  const isDark = theme === "dark" && !forceLight && size !== "lg";

  return (
    <div 
      style={{ 
        display: "flex", 
        alignItems: "center", 
        userSelect: "none", 
        cursor: "pointer",
        lineHeight: 1
      }}
    >
      <img src={isDark ? "/logo-verifa-dark.png" : "/logo-verifa.png"} alt="Verifa.sk" style={{ height, width: "auto", display: "block" }} loading="eager" />
    </div>
  );
}
