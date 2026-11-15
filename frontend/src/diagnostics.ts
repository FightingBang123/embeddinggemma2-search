import type { Health } from "./api";
import { isDesktop, type DesktopInfo } from "./desktop";

/** 反馈问题用的一段纯文本；不包含文档内容或查询记录。 */
export function buildDiagnostics(info: DesktopInfo | null, health: Health | undefined, docs: number, chunks: number) {
  return [
    "EmbeddingGemma 2 · 诊断信息",
    `时间: ${new Date().toISOString()}`,
    `运行形态: ${isDesktop() ? "桌面版" : "浏览器版"}`,
    `版本: ${info?.version ?? health?.version ?? "—"}`,
    `平台: ${info ? `${info.platform} ${info.arch}` : navigator.platform}`,
    `Electron: ${info?.electron ?? "—"}`,
    `Chromium: ${info?.chrome ?? "—"}`,
    `Node: ${info?.node ?? "—"}`,
    `模型: ${health?.llama.name ?? "—"} / ${health?.llama.quant ?? "—"} / ctx ${health?.llama.n_ctx ?? "—"}`,
    `模型状态: ${health?.llama.ok ? "就绪" : `离线 (${health?.llama.error ?? "unknown"})`}`,
    `向量维度: ${health?.dim ?? "—"}d`,
    `文档: ${docs} / 块: ${chunks}`,
    `数据目录: ${info?.dataDir ?? "—"}`,
    `日志目录: ${info?.logsDir ?? "—"}`,
    `模型文件: ${info?.modelFile ?? "—"}`,
    `运行时: ${info?.runtimeDir ?? "—"}`,
    `已打包: ${info ? (info.packaged ? "是" : "否（开发模式）") : "—"}`,
  ].join("\n");
}
