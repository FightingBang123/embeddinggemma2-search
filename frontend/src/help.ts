/** 帮助中心的章节定义：原生菜单、快捷键、空状态入口共用同一套 id。 */
export type HelpSection = "quickstart" | "best" | "modes" | "shortcuts" | "faq" | "about";

export const HELP_SECTIONS: { id: HelpSection; label: string; hint: string }[] = [
  { id: "quickstart", label: "快速上手", hint: "3 分钟跑通第一次检索" },
  { id: "best", label: "最佳实践", hint: "让命中率和可读性都更好" },
  { id: "modes", label: "模式与参数", hint: "检索模式、返回条数、维度" },
  { id: "shortcuts", label: "键盘快捷键", hint: "不用鼠标也能完成检索" },
  { id: "faq", label: "常见问题", hint: "连不上、搜不到、数据在哪" },
  { id: "about", label: "软件信息", hint: "版本、运行时、目录与许可" },
];

export const HELP_SECTION_IDS = HELP_SECTIONS.map((s) => s.id);

export function normalizeHelpSection(value: unknown): HelpSection {
  return HELP_SECTION_IDS.includes(value as HelpSection) ? (value as HelpSection) : "quickstart";
}
