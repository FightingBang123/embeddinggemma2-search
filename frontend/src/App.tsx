import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleQuestionMark, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { api, type SearchMode, type SearchResponse } from "./api";
import { HelpCenter } from "./components/HelpCenter";
import { SearchPanel } from "./components/SearchPanel";
import { Sidebar } from "./components/Sidebar";
import { copyText, getDesktopInfo, isDesktop, onDesktopMenu } from "./desktop";
import { buildDiagnostics } from "./diagnostics";
import { normalizeHelpSection, type HelpSection } from "./help";
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
  const [help, setHelp] = useState<{ open: boolean; section: HelpSection }>({ open: false, section: "quickstart" });
  const [uploadSignal, setUploadSignal] = useState(0);
  const lastRun = useRef<{ query: string; mode: SearchMode; topK: number; dim: number; docId: string | null } | null>(
    null,
  );

  const openHelp = useCallback((section: HelpSection = "quickstart") => {
    setHelp({ open: true, section });
  }, []);
  const closeHelp = useCallback(() => setHelp((prev) => ({ ...prev, open: false })), []);

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

  // 帮助中心里的示例问题：关掉弹层，填入问题并立即检索
  const tryExample = useCallback(
    (q: string) => {
      closeHelp();
      setQuery(q);
      run({ query: q });
    },
    [closeHelp, run],
  );

  useHotkey("/", (e) => {
    if (help.open) return; // 帮助中心打开时不要抢焦点
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

  // 原生菜单 → 渲染进程；菜单、帮助中心、快捷键共用同一套动作
  useEffect(
    () =>
      onDesktopMenu((payload) => {
        switch (payload.action) {
          case "help":
            openHelp(normalizeHelpSection(payload.section));
            break;
          case "upload":
            closeHelp();
            setUploadSignal((n) => n + 1);
            break;
          case "refresh":
            void qc.invalidateQueries({ queryKey: ["health"] });
            void qc.invalidateQueries({ queryKey: ["documents"] });
            push("状态已刷新", "ok");
            break;
          case "copy-diagnostics":
            void (async () => {
              const info = await getDesktopInfo();
              const ok = await copyText(
                buildDiagnostics(info, health.data, docs.data?.length ?? 0, health.data?.stats.chunks ?? 0),
              );
              push(ok ? "诊断信息已复制到剪贴板" : "复制失败，请在「帮助 › 软件信息」中重试", ok ? "ok" : "error");
            })();
            break;
        }
      }),
    [openHelp, closeHelp, push, qc, health.data, docs.data],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        openHelp("quickstart");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        openHelp("shortcuts");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        // 桌面版由原生菜单的 Ctrl+O 处理，避免同时弹出两个文件选择框
        if (!isDesktop()) setUploadSignal((n) => n + 1);
        return;
      }
      if (e.key === "Escape") {
        // 帮助中心优先吃掉 Esc：否则会顺手清空用户正在输入的检索词
        if (help.open) {
          closeHelp();
          return;
        }
        setQuery("");
        setFilterDocId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [help.open, openHelp, closeHelp]);

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
        uploadSignal={uploadSignal}
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
              onClick={() => openHelp("quickstart")}
              title="帮助与上手引导 (F1)"
              data-testid="open-help"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:border-indigo-400/30 hover:text-indigo-200"
            >
              <CircleQuestionMark className="size-3.5" />
              帮助
            </button>
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
          onOpenHelp={() => openHelp("quickstart")}
        />
      </main>

      <ToastStack toasts={toasts} onDismiss={dismiss} />

      <HelpCenter
        open={help.open}
        section={help.section}
        onSection={(section) => setHelp((prev) => ({ ...prev, section }))}
        onClose={closeHelp}
        health={health.data}
        documents={docs.data?.length ?? 0}
        onUpload={() => {
          closeHelp();
          setUploadSignal((n) => n + 1);
        }}
        onTryExample={tryExample}
        push={push}
      />
    </div>
  );
}
