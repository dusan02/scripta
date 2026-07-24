"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { useLang } from "@/components/LanguageProvider";

export interface PasswordInputHandle {
  hide: () => void;
}

interface PasswordInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  disabled?: boolean;
  placeholder?: string;
}

const PasswordInput = forwardRef<PasswordInputHandle, PasswordInputProps>(function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  placeholder = "••••••••",
}, ref) {
  const { t } = useLang();
  const [showPassword, setShowPassword] = useState(false);

  useImperativeHandle(ref, () => ({
    hide: () => setShowPassword(false),
  }));

  return (
    <div>
      <label htmlFor={id} className="label" style={{ display: "block", marginBottom: "8px" }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete={autoComplete}
          required
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="input"
          style={{ width: "100%", padding: "10px 36px 10px 12px", boxSizing: "border-box" }}
        />
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            setShowPassword((v) => !v);
          }}
          style={{
            position: "absolute",
            right: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            padding: "4px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
          }}
          aria-label={showPassword ? t("form.skryt") : t("form.zobrazit")}
        >
          {showPassword ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
});

export default PasswordInput;
