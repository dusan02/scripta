import React from "react";

interface LogoProps {
  size?: "md" | "lg";
}

export default function Logo({ size = "md" }: LogoProps) {
  // We use fontSize on the container, and use 'em' units for SVG to scale perfectly proportionally
  const fontSize = size === "lg" ? "32px" : "24px";

  return (
    <div 
      style={{ 
        display: "flex", 
        alignItems: "center", 
        userSelect: "none", 
        cursor: "pointer",
        fontSize: fontSize,
        lineHeight: 1
      }}
    >
      <svg 
        width="1.3em" 
        height="1.3em" 
        viewBox="0 0 24 24" 
        fill="none" 
        style={{ 
          color: "var(--accent)", 
          flexShrink: 0, 
          marginRight: "0.2em",
          marginTop: "-0.1em"
        }}
      >
        <rect x="3" y="3" width="7" height="7" rx="2" fill="currentColor" />
        <rect x="14" y="3" width="7" height="7" rx="2" fill="currentColor" opacity="0.5" />
        <rect x="3" y="14" width="7" height="7" rx="2" fill="currentColor" opacity="0.5" />
        <rect x="14" y="14" width="7" height="7" rx="2" fill="currentColor" />
      </svg>
      <span
        style={{ 
          fontWeight: "bold", 
          color: "var(--text)", 
          letterSpacing: "-0.04em",
        }}
      >
        Registro<span style={{ color: "var(--accent)" }}>.sk</span>
      </span>
    </div>
  );
}
