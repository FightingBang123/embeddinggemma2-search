import { useRef, useState } from "react";
import { FileText, Loader2, Trash2, UploadCloud, Database, Cpu } from "lucide-react";
import type { DocumentRow, Health } from "../api";
import { fmtBytes, fmtTime } from "../api";
import { Badge, cn } from "../ui";

export function Sidebar({
  health,
  documents,
  uploading,
  onUpload,
  onDelete,
  deletingId,
}: {
  health?: Health;
  documents: DocumentRow[];
  uploading: boolean;
  onUpload: (files: File[]) => void;
  onDelete: (id: string) => void;
  deletingId?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const llama = health?.llama;

  const pick = (files: FileList | null) => {
    if (!files?.length) return;
    onUpload(Array.from(files));
  };

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col gap-4 border-r border-white/5 bg-zinc-950/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-indigo-500/15 ring-1 ring-indigo-400/30">
            <Database className="size-4 text-indigo-300" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold text-zinc-100">向量库</div>
            <div className="text-[11px] text-zinc-500">
              {health?.stats.documents ?? 0} 文档 · {health?.stats.chunks ?? 0} 块
            </div>
          </div>
        </div>
        <Badge tone={llama?.ok ? "good" : "bad"}>
          <span className={cn("size-1.5 rounded-full", llama?.ok ? "bg-emerald-400" : "bg-rose-400")} />
          {llama?.ok ? "模型就绪" : "模型离线"}
        </Badge>
      </div>

      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 text-[11px] text-zinc-400">
        <div className="flex items-center gap-1.5">
          <Cpu className="size-3.5 text-zinc-500" />
          <span className="font-mono text-zinc-300">{llama?.name ?? "embeddinggemma2"}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-zinc-500">
          <span>{llama?.params ? `${(llama.params / 1e6).toFixed(0)}M` : "—"}</span>
          <span>{llama?.quant ?? "—"}</span>
          <span>ctx {llama?.n_ctx ?? "—"}</span>
          <span>{health?.dim ?? 768}d</span>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "group cursor-pointer rounded-xl border border-dashed px-3 py-5 text-center transition",
          dragging
            ? "border-indigo-400/60 bg-indigo-500/10"
            : "border-white/10 bg-white/[0.02] hover:border-indigo-400/40 hover:bg-indigo-500/[0.06]",
          uploading && "pointer-events-none opacity-70",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".txt,.md,.markdown,.csv,.json,.log,.py,.js,.ts,.tsx,.java,.go,.rs,.c,.cpp,.cs,.rb,.php,.sh,.ps1,.sql,.yaml,.yml,.pdf"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="mx-auto mb-2 grid size-9 place-items-center rounded-full bg-white/5 text-zinc-400 group-hover:text-indigo-300">
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
        </div>
        <div className="text-[12.5px] font-medium text-zinc-200">
          {uploading ? "正在切块并生成向量…" : "拖入文件或点击上传"}
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">md / txt / pdf / 代码 · 单文件 ≤ 25 MB</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between px-0.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">文档</span>
          <span className="text-[11px] text-zinc-600">{documents.length}</span>
        </div>
        <div className="-mr-1 flex-1 space-y-1 overflow-y-auto pr-1">
          {documents.length === 0 && (
            <div className="rounded-lg border border-white/5 bg-white/[0.015] px-3 py-6 text-center text-[12px] text-zinc-500">
              还没有文档
              <div className="mt-1 text-[11px] text-zinc-600">上传后即可语义检索</div>
            </div>
          )}
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="group flex items-start gap-2 rounded-lg border border-transparent px-2 py-2 transition hover:border-white/5 hover:bg-white/[0.04]"
            >
              <FileText className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-zinc-200" title={doc.name}>
                  {doc.name}
                </div>
                <div className="mt-0.5 flex gap-2 text-[10.5px] text-zinc-500">
                  <span>{doc.chunks} 块</span>
                  <span>{fmtBytes(doc.size)}</span>
                  <span className="text-zinc-600">{fmtTime(doc.created_at)}</span>
                </div>
              </div>
              <button
                onClick={() => onDelete(doc.id)}
                title="删除该文档"
                className="rounded p-1 text-zinc-600 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-300 group-hover:opacity-100"
              >
                {deletingId === doc.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
