import React from 'react';

export function Card(props: { children: React.ReactNode; className?: string }) {
  return <div className={`border bg-white ${props.className || ""}`}>{props.children}</div>;
}

export function CardContent(props: { children: React.ReactNode; className?: string }) {
  return <div className={props.className || ""}>{props.children}</div>;
}

export function AppButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "ghost"; size?: "default" | "icon" }
) {
  const { children, className = "", variant = "solid", size = "default", ...rest } = props;
  const base = size === "icon"
    ? "inline-flex h-9 w-9 items-center justify-center"
    : "inline-flex items-center justify-center px-4 py-2";
  const style = variant === "ghost"
    ? "bg-transparent hover:bg-slate-100"
    : "bg-slate-900 text-white hover:bg-slate-800";
  return (
    <button type="button" className={`${base} ${style} font-medium transition ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function AppInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      className={`w-full border border-slate-300 bg-white px-2 text-slate-900 outline-none focus:border-slate-500 ${className}`}
      {...rest}
    />
  );
}

export function AppSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", children, ...rest } = props;
  return (
    <select
      className={`w-full border border-slate-300 bg-white px-2 text-slate-900 outline-none focus:border-slate-500 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
