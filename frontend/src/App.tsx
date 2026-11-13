import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { api, type Hit, type SearchMode, type SearchResponse } from "./api";
import { SearchPanel } from "./components/SearchPanel";
import { Sidebar } from "./components/Sidebar";
import { cn, ToastStack, useHotkey, useToasts } from "./ui";

export default function App() {
  const qc = useQueryClient();
  const { toasts, push, dismiss } = useToasts();

  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000, retry: 1 });
  const docs = useQuery({ queryKey: ["documents"], queryFn: api.documents, retry: 1 });

  const initialQ = useRef(new URLSearchParams(window.location.search).get("q") ?? "").current;
  const [query, setQuery] = useState(initialQ);
  const [mode, setMode] = useState<SearchMode>("retrieval");
  const [topK, setTopK] = useState(8);
  const [dim, setDim] = useState(768);
  const [response, setResponse] = useState<SearchResponse | undefined>();
  const [filterDocId, setFilterDocId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const lastRun = useRef<{ query: string; mode: SearchMode; topK: number; dim: number; docId: string | null } | null>(
    null,
  );

  const upload = useMutation({
    mutationFn: api.upload,
    onSuccess: (data) => {
      const ok = data.results.filter((r) => r.ok);
      const bad = data.results.filter((r) => !r.ok);
      if (ok.length) {
        const chunks = ok.reduce((a, r) => a + (r.chunks ?? 0), 0);
        push(`已索引 ${ok.length} 个文件、${chunks} 个块`, "ok");
      }
      for (const b of bad) push(`${b.name}: ${b.error}`, "error");
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: ["health"] });
    },
    onError: (err: Error) => push(`上传失败：${err.message}`, "error"),
  });

  const remove = useMutation({
    mutationFn: api.remove,
    onMutate: (id) => setDeletingId(id),
    onSuccess: (_d, id) => {
      push("文档已删除", "info");
      if (filterDocId === id) setFilterDocId(null);
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: ["health"] });
    },
    onError: (err: Error) => push(`删除失败：${err.message}`, "error"),
    onSettled: () => setDeletingId(null),
  });

  const search = useMutation({
    mutationFn: api.search,
    onSuccess: (data, vars) => {
      setResponse(data);
      lastRun.current = { query: vars.query, mode: vars.mode, topK: vars.top_k, dim: vars.dim, docId: vars.doc_ids?.[0] ?? null };
      const params = new URLSearchParams(window.location.search);
      params.set("q", vars.query);
      window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
      if (!data.results.length) push("没有命中，换个说法或先上传文档", "info");
    },
    onError: (err: Error) => push(`检索失败：${err.message}`, "error"),
  });

  const run = useCallback(
    (override?: { query?: string; docId?: string | null }) => {
      const q = (override?.query ?? query).trim();
      if (!q) return;
      const docId = override?.docId === undefined ? filterDocId : override.docId;
      search.mutate({ query: q, top_k: topK, dim, mode, doc_ids: docId ? [docId] : undefined });
    },
    [query, filterDocId, topK, dim, mode, search],
  );

  useHotkey("/", (e) => {
    e.preventDefault();
    document.getElementById("search-input")?.focus();
  });

  // deep link: /?q=... runs the search once on load
  const bootRan = useRef(false);
  useEffect(() => {
    if (bootRan.current || !initialQ.trim()) return;
    bootRan.current = true;
    run({ query: initialQ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setQuery("");
        setFilterDocId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const offline = health.data && !health.data.llama.ok;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#09090b] text-zinc-200">
      <Sidebar
        health={health.data}
        documents={docs.data ?? []}
        uploading={upload.isPending}
        onUpload={(files) => upload.mutate(files)}
        onDelete={(id) => remove.mutate(id)}
        deletingId={deletingId}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/5 px-8">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[14px] font-semibold tracking-tight text-zinc-100">EmbeddingGemma 2 · 语义检索</h1>
            <span className="text-[11px] text-zinc-600">llama.cpp backend</span>
          </div>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2.5 py-1 text-emerald-300/90">
              <ShieldCheck className="size-3" />
              全本地推理
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3" />
              数据不出本机
            </span>
            <button
              onClick={() => {
                void qc.invalidateQueries({ queryKey: ["health"] });
                void qc.invalidateQueries({ queryKey: ["documents"] });
              }}
              className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
              title="刷新状态"
            >
              <RefreshCw className={cn("size-3.5", health.isFetching && "animate-spin")} />
            </button>
          </div>
        </header>

        {offline && (
          <div className="border-b border-rose-400/20 bg-rose-500/10 px-8 py-2 text-[12px] text-rose-200">
            连不上后端：{health.data?.llama.error?.slice(0, 160)} — 先确认 llama-server 在{" "}
            <span className="font-mono">{health.data?.llama.url}</span> 上运行。
          </div>
        )}

        <SearchPanel
          query={query}
          setQuery={setQuery}
          mode={mode}
          setMode={(m) => {
            setMode(m);
            if (lastRun.current) run();
          }}
          topK={topK}
          setTopK={setTopK}
          dim={dim}
          setDim={setDim}
          onSubmit={() => run()}
          loading={search.isPending}
          response={response}
          filterDocId={filterDocId}
          onClearFilter={() => {
            setFilterDocId(null);
            if (lastRun.current) run({ docId: null });
          }}
          onFilterDoc={(id) => {
            setFilterDocId(id);
            run({ docId: id });
          }}
        />
      </main>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
