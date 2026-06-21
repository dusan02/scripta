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
          marginRight: "-0.2em",
          marginTop: "-0.1em" // Posunieme Včko mierne dole/hore aby lícovalo s textom
        }}
      >
        <path
          d="M4.5 10 L10 18 L20 4"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span
        style={{ 
          fontWeight: "bold", 
          color: "var(--text)", 
          letterSpacing: "-0.04em",
        }}
      >
        eriso<span style={{ color: "var(--accent)" }}>.sk</span>
      </span>
    </div>
  );
}
