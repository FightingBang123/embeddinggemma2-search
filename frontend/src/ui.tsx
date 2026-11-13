import { clsx, type ClassValue } from "clsx";
import { useEffect, useRef, useState } from "react";

export const cn = (...inputs: ClassValue[]) => clsx(inputs);

/* ------------------------------------------------------------------ */
/* highlight                                                           */
/* ------------------------------------------------------------------ */
const STOP = new Set(["的", "了", "是", "在", "和", "我", "有", "吗", "呢", "怎么", "如何", "什么"]);

function terms(query: string): string[] {
  const raw = query
    .replace(/task:[^|]*\|/i, " ")
    .replace(/(query|sentence|text):/gi, " ")
    .split(/[\s,，。.;；:：!！?？、"'“”()（）\[\]{}<>/\\|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
  const cjk = query.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  const grams: string[] = [];
  for (const run of cjk) {
    if (run.length <= 4) grams.push(run);
    for (let i = 0; i + 2 <= run.length; i++) grams.push(run.slice(i, i + 2));
  }
  return [...new Set([...raw, ...grams])].sort((a, b) => b.length - a.length).slice(0, 40);
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const list = terms(query);
  if (!list.length) return <>{text}</>;
  const re = new RegExp(`(${list.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) ? (
          <mark key={i} className="rounded bg-indigo-400/25 px-0.5 text-indigo-100">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* small ui primitives                                                 */
/* ------------------------------------------------------------------ */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "bad" | "accent";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide",
        tone === "good" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
        tone === "bad" && "border-rose-400/30 bg-rose-400/10 text-rose-300",
        tone === "accent" && "border-indigo-400/30 bg-indigo-400/10 text-indigo-300",
        tone === "neutral" && "border-white/10 bg-white/5 text-zinc-300",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("size-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 opacity-0 shadow-lg transition group-hover:opacity-100">
        {label}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* toasts                                                              */
/* ------------------------------------------------------------------ */
export type Toast = { id: number; text: string; tone: "info" | "ok" | "error" };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = (text: string, tone: Toast["tone"] = "info") => {
    const id = ++seq.current;
    setToasts((prev) => [...prev, { id, text, tone }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  };
  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));
  return { toasts, push, dismiss };
}

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={cn(
            "pointer-events-auto cursor-pointer rounded-xl border px-3.5 py-2.5 text-[13px] shadow-xl backdrop-blur",
            t.tone === "ok" && "border-emerald-400/30 bg-emerald-500/15 text-emerald-100",
            t.tone === "error" && "border-rose-400/30 bg-rose-500/15 text-rose-100",
            t.tone === "info" && "border-white/10 bg-zinc-800/90 text-zinc-100",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* keyboard helper                                                     */
/* ------------------------------------------------------------------ */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "") || target?.isContentEditable;
      if (typing && key !== "Escape") return;
      if (e.key === key) handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, handler]);
}

export function scoreTone(score: number) {
  if (score >= 0.7) return { bar: "bg-emerald-400", text: "text-emerald-300" };
  if (score >= 0.55) return { bar: "bg-indigo-400", text: "text-indigo-300" };
  if (score >= 0.4) return { bar: "bg-amber-400", text: "text-amber-300" };
  return { bar: "bg-zinc-500", text: "text-zinc-400" };
}
