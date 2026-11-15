import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  Compass,
  Copy,
  Cpu,
  Database,
  FolderOpen,
  Info,
  Keyboard,
  Lightbulb,
  Rocket,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Health } from "../api";
import { copyText, desktopActions, getDesktopInfo, isDesktop, type DesktopInfo } from "../desktop";
import { buildDiagnostics } from "../diagnostics";
import { HELP_SECTIONS, type HelpSection } from "../help";
import { Badge, cn } from "../ui";

const SECTION_ICONS: Record<HelpSection, LucideIcon> = {
  quickstart: Rocket,
  best: Lightbulb,
  modes: Compass,
  shortcuts: Keyboard,
  faq: CircleQuestionMark,
  about: Info,
};

const EXAMPLES = ["忘记密码怎么处理？", "token bucket 限流怎么实现", "发票什么时候开"];

const FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: "顶部显示「模型离线 / 连不上后端」怎么办？",
    a: (
      <>
        说明推理进程没有就绪，检索和上传都会失败。依次尝试：① 等待十几秒让模型加载完；② 关闭应用重开；③
        打开日志目录看 <code className="text-zinc-300">llama-server.log</code> 的最后几行；④
        若是绿色版，确认没有杀毒软件拦截 <code className="text-zinc-300">llama-server.exe</code>。
      </>
    ),
  },
  {
    q: "上传成功了，但检索没有命中？",
    a: (
      <>
        先看左侧文档列表里的「块数」是否大于 0。然后：换一句更完整的自然语言；把返回条数调到 12–20；确认模式选对（找代码要用「代码检索」）；如果只搜某份文档，用结果卡上的「只看该文档」。
      </>
    ),
  },
  {
    q: "PDF 上传后提示「没有可提取的文字」？",
    a: (
      <>
        扫描件 / 图片型 PDF 没有文字层，当前版本不做 OCR。可以先用系统或在线工具做一次 OCR，再上传识别后的 PDF 或纯文本。
      </>
    ),
  },
  {
    q: "余弦分数多少算「好」？",
    a: (
      <>
        它是相似度，不是概率。经验值：<b className="text-emerald-300">≥ 0.70</b> 强相关，通常可直接使用；
        <b className="text-indigo-300">0.55–0.70</b> 可能相关，看上下文；<b className="text-amber-300">0.40–0.55</b>{" "}
        弱相关；低于 0.40 基本可以忽略。不同语料的分值分布不同，先看 Top 3 的相对排序更可靠。
      </>
    ),
  },
  {
    q: "数据存在哪里？怎么备份或换电脑？",
    a: (
      <>
        所有文档、切块和向量都在本机的 <code className="text-zinc-300">data/app.db</code>（SQLite）。用「帮助 ›
        软件信息」里的「打开数据目录」即可找到它。备份时关闭应用，复制整个 <code className="text-zinc-300">data</code>{" "}
        目录；换电脑时放回同一位置即可继续用。
      </>
    ),
  },
  {
    q: "支持哪些文件？有大小限制吗？",
    a: (
      <>
        文本类（md / txt / csv / json / log）、常见代码文件、以及带文字层的 PDF；单文件 ≤ 25 MB。单个文件会被切成约
        900 字符的块，长表格可能被切开，这是已知边界。
      </>
    ),
  },
  {
    q: "会上传数据到云端吗？",
    a: (
      <>
        不会。模型和向量库都在本机，服务只监听 <code className="text-zinc-300">127.0.0.1</code>，断网也能用。唯一可能联网的场景是「轻量包」首次启动时下载模型。
      </>
    ),
  },
  {
    q: "双击没反应 / 启动就退出？",
    a: (
      <>
        启动器会把日志写到 <code className="text-zinc-300">%TEMP%\embeddinggemma2-startup.log</code> 和{" "}
        <code className="text-zinc-300">embeddinggemma2-launcher.log</code>。先看这两个文件；常见原因是目录不可写或被杀软拦截，启动器会自动重试并换目录。
      </>
    ),
  },
];

function jsonSafe(value: unknown) {
  return String(value ?? "—");
}

export function HelpCenter({
  open,
  section,
  onSection,
  onClose,
  health,
  documents,
  onUpload,
  onTryExample,
  push,
}: {
  open: boolean;
  section: HelpSection;
  onSection: (section: HelpSection) => void;
  onClose: () => void;
  health?: Health;
  documents: number;
  onUpload: () => void;
  onTryExample: (query: string) => void;
  push: (text: string, tone?: "info" | "ok" | "error") => void;
}) {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void getDesktopInfo().then((next) => {
      if (alive) setInfo(next);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      previousFocus.current?.focus();
    };
  }, [open]);

  // 简单焦点陷阱：Tab 不会跑到弹层背后的检索界面
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes) return;
      // 过滤 display:none 的桌面/移动双份导航，否则 Tab 会跳到不可见按钮
      const visible = Array.from(nodes).filter((node) => node.offsetParent !== null);
      if (visible.length === 0) return;
      const first = visible[0];
      const last = visible[visible.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const copyDiagnostics = async () => {
    const text = buildDiagnostics(info, health, documents, health?.stats.chunks ?? 0);
    const ok = await copyText(text);
    push(ok ? "诊断信息已复制到剪贴板" : "复制失败，请手动打开日志目录", ok ? "ok" : "error");
  };

  if (!open) return null;

  const current = HELP_SECTIONS.find((item) => item.id === section) ?? HELP_SECTIONS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-center-title"
    >
      <div className="help-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        ref={panelRef}
        className="help-panel relative flex h-[min(800px,90vh)] w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0e] shadow-[0_30px_120px_-20px_rgba(0,0,0,0.9)]"
      >
        <aside className="hidden w-60 shrink-0 flex-col border-r border-white/5 bg-white/[0.015] md:flex">
          <div className="border-b border-white/5 px-5 py-5">
            <div className="flex items-center gap-2.5">
              <div className="grid size-8 place-items-center rounded-lg bg-indigo-500/15 ring-1 ring-indigo-400/30">
                <BookOpen className="size-4 text-indigo-300" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-zinc-100">帮助与文档</div>
                <div className="text-[10.5px] text-zinc-500">离线可用 · F1 随时打开</div>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
            {HELP_SECTIONS.map((item) => {
              const Icon = SECTION_ICONS[item.id];
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  data-testid={`help-nav-${item.id}`}
                  onClick={() => onSection(item.id)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
                    active
                      ? "bg-indigo-500/15 text-indigo-100 ring-1 ring-indigo-400/20"
                      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
                  )}
                >
                  <Icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-indigo-300" : "text-zinc-500")} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-[10.5px] leading-snug text-zinc-500">{item.hint}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-white/5 px-5 py-3 text-[10.5px] text-zinc-600">
            v{info?.version ?? health?.version ?? "1.0.0"} · MIT License
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-start gap-3 border-b border-white/5 px-5 py-4 sm:px-7">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 id="help-center-title" className="text-[15px] font-semibold text-zinc-100">
                  {current.label}
                </h2>
                <Badge tone="neutral" className="hidden sm:inline-flex">
                  {current.hint}
                </Badge>
              </div>
              <div className="mt-1 text-[11px] text-zinc-500 md:hidden">按 Esc 关闭</div>
            </div>
            <button
              ref={closeRef}
              onClick={onClose}
              title="关闭 (Esc)"
              aria-label="关闭帮助中心"
              className="rounded-lg p-2 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/5 px-4 py-2 md:hidden">
            {HELP_SECTIONS.map((item) => (
              <button
                key={item.id}
                onClick={() => onSection(item.id)}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] transition",
                  item.id === section
                    ? "bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/30"
                    : "text-zinc-400 hover:bg-white/5",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            {section === "quickstart" && <QuickStart onUpload={onUpload} onTryExample={onTryExample} />}
            {section === "best" && <BestPractices />}
            {section === "modes" && <Modes />}
            {section === "shortcuts" && <Shortcuts />}
            {section === "faq" && <Faq onOpenLogs={() => void desktopActions.openLogs()} />}
            {section === "about" && (
              <About info={info} health={health} documents={documents} onCopyDiagnostics={copyDiagnostics} />
            )}
          </div>

          <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/5 px-5 py-2.5 text-[10.5px] text-zinc-600 sm:px-7">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3" />
              全本地推理，数据不出本机
            </span>
            <span className="ml-auto inline-flex items-center gap-1">
              <Kbd>Esc</Kbd> 关闭
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* shared bits                                                         */
/* ------------------------------------------------------------------ */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-200">
      {children}
    </kbd>
  );
}

function SectionHeading({ eyebrow, title, desc }: { eyebrow: string; title: string; desc: string }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-400/80">{eyebrow}</div>
      <h3 className="mt-1.5 text-[20px] font-semibold tracking-tight text-zinc-100">{title}</h3>
      <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-zinc-500">{desc}</p>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:p-5", className)}>{children}</div>
  );
}

function Callout({
  icon: Icon,
  tone = "indigo",
  title,
  children,
}: {
  icon: LucideIcon;
  tone?: "indigo" | "emerald" | "amber";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border p-3.5",
        tone === "indigo" && "border-indigo-400/20 bg-indigo-500/[0.07]",
        tone === "emerald" && "border-emerald-400/20 bg-emerald-500/[0.06]",
        tone === "amber" && "border-amber-400/20 bg-amber-500/[0.06]",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "indigo" && "text-indigo-300",
          tone === "emerald" && "text-emerald-300",
          tone === "amber" && "text-amber-300",
        )}
      />
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-zinc-200">{title}</div>
        <div className="mt-1 text-[12px] leading-relaxed text-zinc-400">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* quick start                                                         */
/* ------------------------------------------------------------------ */
function QuickStart({ onUpload, onTryExample }: { onUpload: () => void; onTryExample: (q: string) => void }) {
  return (
    <div>
      <SectionHeading
        eyebrow="Quick start"
        title="3 分钟完成第一次检索"
        desc="不用命令行、不用配置模型。装好后只需要做三件事：放资料、选模式、提问。"
      />

      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            n: 1,
            icon: Upload,
            title: "把资料放进来",
            body: "拖入左侧上传区，或按 Ctrl+O。md / txt / pdf / 代码都行，单个文件 ≤ 25 MB；上传后会自动切块并生成向量。",
          },
          {
            n: 2,
            icon: Compass,
            title: "选一个任务模式",
            body: "默认「文档检索」适合问答；找代码切到「代码检索」；比较两段话是否相近用「语义相似」。",
          },
          {
            n: 3,
            icon: Sparkles,
            title: "用自然语言提问",
            body: "按 / 聚焦输入框，输入一句完整的问题后回车。不需要关键词，也不需要用空格拼词。",
          },
        ].map((step) => (
          <div key={step.n} className="relative rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="grid size-9 place-items-center rounded-lg bg-indigo-500/15 ring-1 ring-indigo-400/25">
                <step.icon className="size-4 text-indigo-300" />
              </div>
              <span className="font-mono text-[24px] font-semibold leading-none text-white/[0.08]">0{step.n}</span>
            </div>
            <div className="text-[13px] font-medium text-zinc-200">{step.title}</div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-zinc-500">{step.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={onUpload}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3.5 py-2 text-[12.5px] font-medium text-white transition hover:bg-indigo-400"
        >
          <Upload className="size-3.5" />
          上传第一份文档
        </button>
        <button
          onClick={() => onTryExample(EXAMPLES[0])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[12.5px] text-zinc-300 transition hover:border-indigo-400/40 hover:text-indigo-200"
        >
          用示例问题试一下
        </button>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Callout icon={Lightbulb} title="不知道选哪个模式？">
          90% 的场景用「文档检索」就够了。只有当你在代码库里找实现、或比较两段文字时才需要切换。
        </Callout>
        <Callout icon={CircleQuestionMark} tone="emerald" title="结果不好不是坏了">
          语义检索按「意思相近」排序，第一次可以先把返回条数调到 12，看到全貌后再收窄。
        </Callout>
      </div>

      <Panel className="mt-4">
        <div className="flex items-center gap-2 text-[12px] font-medium text-zinc-200">
          <Sparkles className="size-3.5 text-indigo-300" />
          三个可以立刻试的问题
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              onClick={() => onTryExample(q)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11.5px] text-zinc-300 transition hover:border-indigo-400/40 hover:text-indigo-200"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="mt-3 text-[11px] text-zinc-600">
          示例问题需要向量库里已有相关内容；还没有文档时，先上传左侧的任意资料。
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* best practices                                                      */
/* ------------------------------------------------------------------ */
function BestPractices() {
  return (
    <div>
      <SectionHeading
        eyebrow="Best practices"
        title="让检索更准、更好读的 6 个习惯"
        desc="向量检索不是搜索框：它匹配「意思」。下面这些做法能显著提升命中率和可用性。"
      />

      <div className="grid gap-3 md:grid-cols-2">
        <Panel className="border-emerald-400/15 bg-emerald-500/[0.04]">
          <div className="mb-3 flex items-center gap-2 text-[12.5px] font-medium text-emerald-200">
            <CircleCheck className="size-4" />
            推荐这样做
          </div>
          <ul className="space-y-2.5 text-[12px] leading-relaxed text-zinc-400">
            <li>上传单一主题、信息密度高的文档；一个文件讲清一件事。</li>
            <li>提问用完整句子，带上产品名 / 模块名等限定词。</li>
            <li>一次只问一个问题，复杂问题拆成多次检索。</li>
            <li>先看 Top 3 的相对排序，再决定是否调大返回条数。</li>
            <li>文档更新后删掉旧版本再传新的，避免新旧答案同时出现。</li>
            <li>把不同项目放进不同文档，用「只看该文档」收窄范围。</li>
          </ul>
        </Panel>

        <Panel className="border-rose-400/15 bg-rose-500/[0.04]">
          <div className="mb-3 flex items-center gap-2 text-[12.5px] font-medium text-rose-200">
            <CircleX className="size-4" />
            尽量避免
          </div>
          <ul className="space-y-2.5 text-[12px] leading-relaxed text-zinc-400">
            <li>把整本手册、会议记录、目录页一次性塞进来。</li>
            <li>只输入两三个关键词，例如「密码 忘记」。</li>
            <li>把多个问题写在同一句里：「怎么改密码和开票」。</li>
            <li>只看分数不看内容；分数受语料分布影响，不是绝对标准。</li>
            <li>重复上传同一文件（会产生重复块，挤占返回名额）。</li>
            <li>用扫描版 PDF 直接上传（没有文字层，无法切块）。</li>
          </ul>
        </Panel>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Panel>
          <div className="text-[12px] font-medium text-zinc-200">提问公式</div>
          <div className="mt-2 space-y-2 text-[11.5px] leading-relaxed">
            <div className="rounded-lg border border-rose-400/15 bg-rose-500/[0.04] px-3 py-2 text-zinc-400">
              <span className="mr-1.5 font-mono text-rose-300/80">×</span>
              密码
            </div>
            <div className="rounded-lg border border-emerald-400/15 bg-emerald-500/[0.04] px-3 py-2 text-zinc-300">
              <span className="mr-1.5 font-mono text-emerald-300/80">✓</span>
              企业账号忘记密码时，管理员应该怎么重置？
            </div>
            <p className="pt-1 text-[11px] text-zinc-500">
              句式：<span className="text-zinc-300">[场景/对象] + [动作/问题] + [期望的结果]</span>
              。完整句子会带上更多语义线索。
            </p>
          </div>
        </Panel>

        <Panel>
          <div className="text-[12px] font-medium text-zinc-200">分数怎么读</div>
          <div className="mt-2 space-y-1.5 text-[11.5px]">
            {[
              { range: "≥ 0.70", label: "强相关，通常可直接引用", tone: "text-emerald-300" },
              { range: "0.55 – 0.70", label: "可能相关，结合上下文判断", tone: "text-indigo-300" },
              { range: "0.40 – 0.55", label: "弱相关，仅作线索", tone: "text-amber-300" },
              { range: "< 0.40", label: "基本无关，优先换问法", tone: "text-zinc-500" },
            ].map((row) => (
              <div key={row.range} className="flex items-center justify-between gap-3 rounded-md bg-white/[0.02] px-2.5 py-1.5">
                <span className={cn("font-mono text-[11px]", row.tone)}>{row.range}</span>
                <span className="text-right text-zinc-500">{row.label}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Callout icon={Database} tone="amber" title="容量与维护">
        单机建议控制在 10 万块以内（约 300 MB 内存）。向量随应用启动常驻内存，文档特别多时首次检索会略慢；定期删除不再需要的文档即可。
      </Callout>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* modes                                                               */
/* ------------------------------------------------------------------ */
function Modes() {
  return (
    <div>
      <SectionHeading
        eyebrow="Modes & parameters"
        title="三种模式，两种参数"
        desc="模式决定提问被包装成哪种任务；条数和维度决定看多少、算多细。"
      />

      <div className="space-y-3">
        {[
          {
            title: "文档检索",
            tag: "默认 · search result",
            color: "indigo",
            when: "查 FAQ、制度、手册、技术文档，想直接得到答案段落。",
            example: "忘记密码怎么处理？",
          },
          {
            title: "代码检索",
            tag: "code retrieval",
            color: "emerald",
            when: "用自然语言在代码库里找实现，例如「限流是怎么做的」。",
            example: "token bucket 限流怎么实现",
          },
          {
            title: "语义相似",
            tag: "sentence similarity",
            color: "amber",
            when: "拿一段话去找相似段落，适合查重、找相关案例、归并同义问题。",
            example: "用户无法登录，提示凭据无效",
          },
        ].map((mode) => (
          <Panel key={mode.title} className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg ring-1",
                mode.color === "indigo" && "bg-indigo-500/15 text-indigo-300 ring-indigo-400/25",
                mode.color === "emerald" && "bg-emerald-500/15 text-emerald-300 ring-emerald-400/25",
                mode.color === "amber" && "bg-amber-500/15 text-amber-300 ring-amber-400/25",
              )}
            >
              {mode.color === "emerald" ? <Cpu className="size-4" /> : <Sparkles className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-zinc-100">{mode.title}</span>
                <span className="font-mono text-[10px] text-zinc-600">{mode.tag}</span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{mode.when}</p>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-400">
                <span className="text-zinc-600">示例</span>
                {mode.example}
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-zinc-200">返回条数</span>
            <span className="font-mono text-[10.5px] text-zinc-600">top_k</span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-zinc-500">
            默认 8。想要精准就 3–5；第一次探索或问题比较宽泛时用 12–20，再从中挑。
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
            {["3–5 精准", "8 默认", "12–20 探索"].map((t) => (
              <span key={t} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-zinc-400">
                {t}
              </span>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-zinc-200">向量维度</span>
            <span className="font-mono text-[10.5px] text-zinc-600">MRL</span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-zinc-500">
            768 维最准；512 / 256 / 128 会截断向量，速度更快但召回略降。日常保持 768 即可。
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
            {["768 最准", "512 均衡", "256 / 128 省资源"].map((t) => (
              <span key={t} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-zinc-400">
                {t}
              </span>
            ))}
          </div>
        </Panel>
      </div>

      <Callout icon={Info} title="模式可以在检索后切换">
        同一句提问切换模式会自动重新检索；窗口标题旁的刷新按钮只刷新状态，不会重新检索。
      </Callout>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* shortcuts                                                           */
/* ------------------------------------------------------------------ */
function Shortcuts() {
  const rows = [
    { keys: ["/"], action: "聚焦搜索框", scope: "全局" },
    { keys: ["Enter"], action: "执行检索", scope: "搜索框内" },
    { keys: ["Esc"], action: "先关闭帮助；没有帮助时清空检索条件", scope: "全局" },
    { keys: ["F1"], action: "打开帮助中心（本页）", scope: "桌面版" },
    { keys: ["Ctrl", "/"], action: "直接跳到快捷键说明", scope: "全局" },
    { keys: ["Ctrl", "O"], action: "上传文档", scope: "桌面版" },
    { keys: ["Ctrl", "R"], action: "刷新界面", scope: "桌面版" },
    { keys: ["Ctrl", "+/-"], action: "放大 / 缩小界面", scope: "桌面版" },
    { keys: ["F11"], action: "全屏 / 退出全屏", scope: "桌面版" },
  ];

  return (
    <div>
      <SectionHeading
        eyebrow="Shortcuts"
        title="键盘快捷键"
        desc="检索的核心操作都能只用键盘完成；macOS 上把 Ctrl 换成 ⌘ 即可。"
      />

      <div className="overflow-hidden rounded-xl border border-white/5">
        {rows.map((row, i) => (
          <div
            key={`${row.keys.join("-")}-${i}`}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 text-[12px]",
              i % 2 === 0 ? "bg-white/[0.02]" : "bg-transparent",
            )}
          >
            <div className="flex w-40 shrink-0 items-center gap-1">
              {row.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </div>
            <div className="min-w-0 flex-1 text-zinc-300">{row.action}</div>
            <div className="shrink-0 text-[10.5px] text-zinc-600">{row.scope}</div>
          </div>
        ))}
      </div>

      <Callout icon={Keyboard} tone="emerald" title="推荐的一条检索路径">
        <span className="inline-flex flex-wrap items-center gap-1">
          <Kbd>/</Kbd> 聚焦 → 输入问题 → <Kbd>Enter</Kbd> → 看 Top 3 → 需要时点「只看该文档」收窄。
        </span>
      </Callout>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */
function Faq({ onOpenLogs }: { onOpenLogs: () => void }) {
  return (
    <div>
      <SectionHeading
        eyebrow="FAQ & troubleshooting"
        title="常见问题与故障排查"
        desc="先看这里，大多数问题能在 30 秒内定位。仍有问题就复制诊断信息再反馈。"
      />

      <div className="space-y-2">
        {FAQ_ITEMS.map((item) => (
          <details key={item.q} className="group rounded-xl border border-white/5 bg-white/[0.02] open:bg-white/[0.03]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[12.5px] font-medium text-zinc-200 marker:hidden">
              <ChevronDown className="size-3.5 shrink-0 text-zinc-500 transition group-open:rotate-180" />
              {item.q}
            </summary>
            <div className="border-t border-white/5 px-4 py-3 text-[12px] leading-relaxed text-zinc-400">{item.a}</div>
          </details>
        ))}
      </div>

      <Panel className="mt-4">
        <div className="flex items-start gap-3">
          <FolderOpen className="mt-0.5 size-4 shrink-0 text-indigo-300" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium text-zinc-200">启动失败时，先看日志</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500">
              应用内日志在数据目录的 <code className="text-zinc-300">logs</code> 子目录；启动器日志在系统临时目录
              （<code className="text-zinc-300">%TEMP%\embeddinggemma2-startup.log</code>）。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={onOpenLogs}
                disabled={!isDesktop()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11.5px] text-zinc-300 transition hover:border-indigo-400/40 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FolderOpen className="size-3.5" />
                打开日志目录
              </button>
              <span className="self-center text-[10.5px] text-zinc-600">
                {isDesktop() ? "也可以用菜单「帮助 › 打开日志目录」" : "浏览器模式无法直接打开本机目录"}
              </span>
            </div>
          </div>
        </div>
      </Panel>

      <Callout icon={ShieldCheck} tone="emerald" title="隐私边界">
        应用只在本机读写数据；没有账号、没有遥测、不会把文档或问题发送到外部服务。
      </Callout>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* about / software info                                               */
/* ------------------------------------------------------------------ */
function About({
  info,
  health,
  documents,
  onCopyDiagnostics,
}: {
  info: DesktopInfo | null;
  health?: Health;
  documents: number;
  onCopyDiagnostics: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const desktop = isDesktop();
  const version = info?.version ?? health?.version ?? "1.0.0";
  const chunks = health?.stats.chunks ?? 0;

  const copy = async () => {
    await onCopyDiagnostics();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const rows = [
    { label: "运行形态", value: desktop ? "桌面版（Electron）" : "浏览器 / 服务器模式" },
    { label: "版本", value: `v${version}` },
    { label: "平台", value: info ? `${info.platform} · ${info.arch}` : navigator.platform },
    { label: "Electron", value: jsonSafe(info?.electron) },
    { label: "Chromium", value: jsonSafe(info?.chrome) },
    { label: "Node.js", value: jsonSafe(info?.node) },
    { label: "模型", value: `${health?.llama.name ?? "embeddinggemma2"} · ${health?.llama.quant ?? "—"}` },
    { label: "上下文 / 维度", value: `ctx ${health?.llama.n_ctx ?? "—"} · ${health?.dim ?? 768}d` },
    { label: "向量库", value: `${documents} 文档 · ${chunks} 块` },
    { label: "推理状态", value: health?.llama.ok ? "就绪" : "离线 / 未连接" },
  ];

  return (
    <div>
      <div className="mb-5 flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-500/15 ring-1 ring-indigo-400/30">
          <Database className="size-5 text-indigo-300" />
        </div>
        <div>
          <div className="text-[18px] font-semibold tracking-tight text-zinc-100">EmbeddingGemma 2</div>
          <div className="text-[12px] text-zinc-500">本地语义检索 · llama.cpp + EmbeddingGemma 2 · MIT License</div>
        </div>
      </div>

      <Panel>
        <div className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] pb-2">
              <span className="text-[11px] text-zinc-500">{row.label}</span>
              <span className="truncate text-right font-mono text-[11px] text-zinc-300" title={row.value}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="mt-3 space-y-2">
        <PathRow
          icon={FolderOpen}
          label="数据目录"
          value={info?.dataDir ?? "仅在桌面版可查看"}
          action="打开"
          onAction={() => void desktopActions.openData()}
          disabled={!desktop}
        />
        <PathRow
          icon={FolderOpen}
          label="日志目录"
          value={info?.logsDir ?? "仅在桌面版可查看"}
          action="打开"
          onAction={() => void desktopActions.openLogs()}
          disabled={!desktop}
        />
        <PathRow icon={Cpu} label="模型文件" value={info?.modelFile ?? "随桌面版打包"} />
        <PathRow icon={Cpu} label="推理运行时" value={info?.runtimeDir ?? "随桌面版打包"} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3.5 py-2 text-[12px] font-medium text-white transition hover:bg-indigo-400"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "已复制" : "复制诊断信息"}
        </button>
        <span className="text-[10.5px] text-zinc-600">反馈问题时附上它，能快速定位环境差异。</span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Panel>
          <div className="text-[12px] font-medium text-zinc-200">开源组件</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["llama.cpp", "EmbeddingGemma 2", "Electron", "React 19", "Vite", "Tailwind CSS", "SQLite"].map((t) => (
              <span
                key={t}
                className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[10.5px] text-zinc-400"
              >
                {t}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            模型与推理运行时遵循各自的上游许可；应用本体以 MIT License 发布。
          </p>
        </Panel>

        <Panel>
          <div className="text-[12px] font-medium text-zinc-200">数据与隐私</div>
          <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-zinc-500">
            <li className="flex gap-1.5">
              <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400/80" />
              文档、向量和检索记录都保存在本机
            </li>
            <li className="flex gap-1.5">
              <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400/80" />
              服务仅监听 127.0.0.1，不对外网开放
            </li>
            <li className="flex gap-1.5">
              <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400/80" />
              无账号体系、无遥测、无云端调用
            </li>
          </ul>
        </Panel>
      </div>

      <div className="mt-4 text-[10.5px] text-zinc-600">
        Copyright © 2026 pzibang · 若在启动、检索或打包中遇到问题，请先查阅「常见问题」并附上诊断信息。
      </div>
    </div>
  );
}

function PathRow({
  icon: Icon,
  label,
  value,
  action,
  onAction,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  action?: string;
  onAction?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <Icon className="size-3.5 shrink-0 text-zinc-500" />
      <span className="w-16 shrink-0 text-[11px] text-zinc-500">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-zinc-400" title={value}>
        {value}
      </span>
      {action && onAction && (
        <button
          onClick={onAction}
          disabled={disabled}
          className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[10.5px] text-zinc-400 transition hover:border-indigo-400/40 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {action}
        </button>
      )}
    </div>
  );
}
