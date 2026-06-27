import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "media",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        background: "var(--bg)",
        surface: "var(--surface)",
        border: "var(--border)",
        text: "var(--text)",
        accent: "var(--accent)",
        navy: {
          950: "#060b18",
          900: "#0a1628",
          800: "#0f2040",
          700: "#162d58",
          600: "#1e3d72",
        },
        emerald: {
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
        },
        amber: {
          400: "#fbbf24",
          500: "#f59e0b",
        },
        crimson: {
          400: "#f87171",
          500: "#ef4444",
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-mesh":
          "linear-gradient(135deg, #060b18 0%, #0a1628 50%, #0f2040 100%)",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 3s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
      boxShadow: {
        glow: "0 0 20px rgba(16, 185, 129, 0.15)",
        "glow-lg": "0 0 40px rgba(16, 185, 129, 0.2)",
        glass: "0 8px 32px rgba(0, 0, 0, 0.4)",
      },
    },
  },
  plugins: [],
};

export default config;
