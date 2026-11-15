import { useMemo, useState } from "react";
import { ArrowRight, Check, Copy, Filter, Rocket, Search, Sparkles, Timer, X } from "lucide-react";
import type { Hit, SearchMode, SearchResponse } from "../api";
import { Badge, Highlight, cn, scoreTone } from "../ui";

const MODES: { id: SearchMode; label: string; hint: string }[] = [
  { id: "retrieval", label: "文档检索", hint: "提问找答案（search result）" },
  { id: "code", label: "代码检索", hint: "自然语言找代码（code retrieval）" },
  { id: "similarity", label: "语义相似", hint: "两句/两段比相似（sentence similarity）" },
];

const SUGGESTIONS = ["忘记密码怎么处理？", "如何降低账号被盗风险", "token bucket 限流怎么实现", "发票什么时候开"];

export function SearchPanel({
  query,
  setQuery,
  mode,
  setMode,
  topK,
  setTopK,
  dim,
  setDim,
  onSubmit,
  loading,
  response,
  filterDocId,
  onClearFilter,
  onFilterDoc,
  onOpenHelp,
}: {
  query: string;
  setQuery: (v: string) => void;
  mode: SearchMode;
  setMode: (m: SearchMode) => void;
  topK: number;
  setTopK: (n: number) => void;
  dim: number;
  setDim: (n: number) => void;
  onSubmit: () => void;
  loading: boolean;
  response?: SearchResponse;
  filterDocId: string | null;
  onClearFilter: () => void;
  onFilterDoc: (id: string) => void;
  onOpenHelp: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/5 px-8 pb-5 pt-7">
        <div className="mb-4 flex items-center gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              title={m.hint}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition",
                mode === m.id
                  ? "bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/30"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
              )}
            >
              {m.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-500">
            <label className="flex items-center gap-1.5">
              返回
              <select
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="rounded-md border border-white/10 bg-zinc-900 px-1.5 py-1 text-zinc-300 outline-none focus:border-indigo-400/50"
              >
                {[3, 5, 8, 12, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              维度
              <select
                value={dim}
                onChange={(e) => setDim(Number(e.target.value))}
                title="MRL 截断维度，越小越省存储"
                className="rounded-md border border-white/10 bg-zinc-900 px-1.5 py-1 text-zinc-300 outline-none focus:border-indigo-400/50"
              >
                {[768, 512, 256, 128].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="group relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            id="search-input"
            data-testid="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
            }}
            placeholder="用自然语言描述你要找的内容…  按 / 聚焦，Enter 检索"
            className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-11 pr-28 text-[14px] text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-indigo-400/50 focus:bg-white/[0.05] focus:ring-4 focus:ring-indigo-500/10"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-24 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-300"
              title="清空"
            >
              <X className="size-4" />
            </button>
          )}
          <button
            data-testid="search-submit"
            onClick={onSubmit}
            disabled={!query.trim() || loading}
            className="absolute right-2 top-1/2 flex h-8 -translate-y-1/2 items-center gap-1.5 rounded-lg bg-indigo-500 px-3 text-[12.5px] font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            {loading ? "检索中" : "检索"}
            {!loading && <ArrowRight className="size-3.5" />}
          </button>
        </div>

        <div className="mt-3 flex min-h-6 items-center gap-2 text-[11px] text-zinc-500">
          {filterDocId && (
            <button
              onClick={onClearFilter}
              className="inline-flex items-center gap-1 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-1 text-indigo-200 hover:bg-indigo-500/20"
            >
              <Filter className="size-3" />
              已限定文档
              <X className="size-3" />
            </button>
          )}
          {response && (
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <Timer className="size-3" />
                向量 {response.timing.embed_ms} ms · 总计 {response.timing.total_ms} ms
              </span>
              <span>top {response.results.length}</span>
              <span>{response.dim}d</span>
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {!response && !loading && (
          <div className="mx-auto mt-10 max-w-2xl text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-indigo-500/10 ring-1 ring-indigo-400/20">
              <Sparkles className="size-5 text-indigo-300" />
            </div>
            <h2 className="text-[15px] font-semibold text-zinc-200">语义检索，不是关键词匹配</h2>
            <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-zinc-500">
              直接问问题即可。第一次用？按下面三步走：
            </p>

            <div className="mt-5 rounded-xl border border-indigo-400/20 bg-indigo-500/[0.05] p-4 text-left">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[12px] font-medium text-indigo-200">
                  <Rocket className="size-3.5" />
                  第一次使用 · 3 步上手
                </div>
                <button
                  onClick={onOpenHelp}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-indigo-300/90 transition hover:bg-indigo-500/10 hover:text-indigo-200"
                >
                  打开完整引导
                  <ArrowRight className="size-3" />
                </button>
              </div>
              <div className="mt-2.5 grid gap-1.5 text-[11.5px] text-zinc-400 sm:grid-cols-3">
                <span className="flex items-start gap-1.5">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded bg-indigo-500/20 font-mono text-[9.5px] text-indigo-200">
                    1
                  </span>
                  左侧上传资料
                </span>
                <span className="flex items-start gap-1.5">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded bg-indigo-500/20 font-mono text-[9.5px] text-indigo-200">
                    2
                  </span>
                  选一个任务模式
                </span>
                <span className="flex items-start gap-1.5">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded bg-indigo-500/20 font-mono text-[9.5px] text-indigo-200">
                    3
                  </span>
                  用完整句子提问
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-zinc-300 transition hover:border-indigo-400/40 hover:text-indigo-200"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="mb-3 h-3 w-24 rounded bg-white/10" />
                <div className="space-y-2">
                  <div className="h-3 w-full rounded bg-white/[0.07]" />
                  <div className="h-3 w-5/6 rounded bg-white/[0.07]" />
                  <div className="h-3 w-2/3 rounded bg-white/[0.07]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && response && response.results.length === 0 && (
          <div className="mx-auto mt-16 max-w-md text-center text-[13px] text-zinc-500">
            没有命中。向量库里还没有文档，或该文档下没有内容。
          </div>
        )}

        {!loading && response && response.results.length > 0 && (
          <div className="space-y-3">
            {response.results.map((hit, i) => (
              <ResultCard
                key={hit.chunk_id}
                hit={hit}
                rank={i + 1}
                query={response.query}
                onFilterDoc={onFilterDoc}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  hit,
  rank,
  query,
  onFilterDoc,
}: {
  hit: Hit;
  rank: number;
  query: string;
  onFilterDoc: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const tone = scoreTone(hit.score);
  const lines = useMemo(() => hit.text.split("\n").length, [hit.text]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hit.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <article className="group rounded-xl border border-white/5 bg-white/[0.025] p-4 transition hover:border-white/10 hover:bg-white/[0.04]">
      <header className="mb-2 flex items-center gap-2">
        <span className="grid size-5 shrink-0 place-items-center rounded bg-white/5 text-[10.5px] font-semibold text-zinc-400">
          {rank}
        </span>
        <Badge tone="accent" className="max-w-[240px] truncate">
          {hit.doc_name}
        </Badge>
        <span className="text-[11px] text-zinc-600">块 #{hit.ord}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-white/5 sm:block">
            <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.max(4, hit.score * 100)}%` }} />
          </div>
          <span className={cn("w-12 text-right font-mono text-[12px] tabular-nums", tone.text)}>
            {hit.score.toFixed(3)}
          </span>
        </div>
      </header>

      <div
        className={cn(
          "whitespace-pre-wrap text-[12.8px] leading-[1.75] text-zinc-300",
          !open && "line-clamp-4",
        )}
      >
        <Highlight text={hit.text} query={query} />
      </div>

      <footer className="mt-2.5 flex items-center gap-3 text-[11px] text-zinc-500 opacity-0 transition group-hover:opacity-100">
        {lines > 4 && (
          <button onClick={() => setOpen((v) => !v)} className="hover:text-zinc-300">
            {open ? "收起" : "展开全文"}
          </button>
        )}
        <button onClick={copy} className="inline-flex items-center gap-1 hover:text-zinc-300">
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "已复制" : "复制"}
        </button>
        <button onClick={() => onFilterDoc(hit.doc_id)} className="inline-flex items-center gap-1 hover:text-zinc-300">
          <Filter className="size-3" />
          只看该文档
        </button>
      </footer>
    </article>
  );
}
