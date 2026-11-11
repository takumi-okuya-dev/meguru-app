// 外枠の入口（specs/028-meguru-shell contracts/web-module-boundaries.md 1）。アプリと組み立ては、外枠をここからだけ読む。
export { AppRegistryProvider, findCurrentApp, useAppRegistry, useCurrentApp } from "./app-module";
export type { AppModule, LegacyRedirect, SettingsSectionContribution } from "./app-module";
export { AppShell, CenteredLayout } from "./layout/AppShell";
export { PageBody, PageHeader } from "./layout/PageHeader";
export { useShell } from "./layout/shell-context";
export { Sidebar } from "./layout/Sidebar";
export type { AppSidebar, SidebarPartProps } from "./layout/sidebar-parts";
export { NotFound } from "./pages/not-found";
export { buildRoutes } from "./routes";
