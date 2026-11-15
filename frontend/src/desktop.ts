/**
 * 桌面壳（Electron preload）的薄封装。
 *
 * 浏览器 / 服务器模式没有 window.desktop，这里统一退化为 no-op，
 * 组件里就不用到处判断运行形态。
 */
import type { HelpSection } from "./help";

export type DesktopInfo = {
  appName: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  dataDir: string;
  logsDir: string;
  runtimeDir: string;
  modelFile: string;
  webDir: string;
  packaged: boolean;
  userDataDir: string;
  userDataKind: string;
  dataDirFallback: boolean;
};

export type MenuAction =
  | { action: "help"; section?: HelpSection }
  | { action: "upload" }
  | { action: "refresh" }
  | { action: "copy-diagnostics" };

type DesktopBridge = {
  info: () => Promise<DesktopInfo>;
  openData: () => Promise<void>;
  openLogs: () => Promise<void>;
  toggleFullscreen: () => Promise<boolean>;
  quit: () => Promise<void>;
  onMenu: (cb: (payload: MenuAction) => void) => void;
  offMenu: () => void;
};

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export const isDesktop = () => typeof window !== "undefined" && Boolean(window.desktop);

export async function getDesktopInfo(): Promise<DesktopInfo | null> {
  try {
    return (await window.desktop?.info()) ?? null;
  } catch {
    return null;
  }
}

export function onDesktopMenu(cb: (payload: MenuAction) => void): () => void {
  if (!window.desktop?.onMenu) return () => {};
  window.desktop.onMenu(cb);
  return () => window.desktop?.offMenu();
}

export const desktopActions = {
  openData: () => window.desktop?.openData(),
  openLogs: () => window.desktop?.openLogs(),
  toggleFullscreen: () => window.desktop?.toggleFullscreen(),
  quit: () => window.desktop?.quit(),
};

/** 剪贴板在 Electron/安全上下文里都可用，失败时退回到 textarea 方案。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}
