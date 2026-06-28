"use client";

import { useState, useCallback } from "react";
import { useT } from "@/components/LanguageProvider";
import toast from "react-hot-toast";

interface CopyableTextProps {
  text: string;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function CopyableText({ text, label, className, style }: CopyableTextProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t("copy.skopirovane"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        toast.success(t("copy.skopirovane"));
        setTimeout(() => setCopied(false), 1500);
      } catch {
        toast.error(t("copy.chyba"));
      }
      document.body.removeChild(textarea);
    }
  }, [text]);

  return (
    <span
      className={`copyable-text ${className ?? ""}`}
      style={style}
    >
      <span className="copyable-text-value">{label ? `${label}: ${text}` : text}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? t("copy.skopirovane") : t("copy.kopirovat")}
        className="copyable-text-btn"
      >
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        )}
      </button>
    </span>
  );
}
