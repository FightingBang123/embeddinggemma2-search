export type LlamaHealth = {
  ok: boolean;
  url: string;
  name?: string;
  params?: number;
  quant?: string;
  n_ctx?: number;
  error?: string;
};

export type Health = {
  ok: boolean;
  llama: LlamaHealth;
  stats: { documents: number; chunks: number; last_ingest: string | null };
  dim: number;
  version: string;
};

export type DocumentRow = {
  id: string;
  name: string;
  suffix: string;
  size: number;
  chunks: number;
  chars: number;
  created_at: string;
};

export type Hit = {
  score: number;
  chunk_id: number;
  doc_id: string;
  doc_name: string;
  ord: number;
  text: string;
};

export type SearchResponse = {
  query: string;
  mode: SearchMode;
  dim: number;
  results: Hit[];
  timing: { embed_ms: number; total_ms: number };
};

export type SearchMode = "retrieval" | "code" | "similarity";

export type UploadResult = {
  name: string;
  ok: boolean;
  id?: string;
  chunks?: number;
  chars?: number;
  embed_ms?: number;
  error?: string;
};

const BASE = "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep status text */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => req<Health>("/api/health"),

  documents: async () => (await req<{ documents: DocumentRow[] }>("/api/documents")).documents,

  stats: () => req<{ documents: number; chunks: number; chars: number; db_mb: number }>("/api/stats"),

  upload: async (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f, f.name);
    return req<{ results: UploadResult[] }>("/api/documents", { method: "POST", body: form });
  },

  remove: (id: string) => req<{ deleted: string }>(`/api/documents/${id}`, { method: "DELETE" }),

  search: (params: { query: string; top_k: number; dim: number; mode: SearchMode; doc_ids?: string[] }) =>
    req<SearchResponse>("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),
};

export const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};
