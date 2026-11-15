// アプリの切り替え（サイドバーのいちばん上。specs/028-meguru-shell contracts/ui-routes.md 5-2）。
// 使っているアプリが2本以上の人にだけ出す（出すかどうかはサイドバーの枠が決める）。押すと、使っているアプリと「すべてのアプリ」。
import { appById } from "@meguru/shared";
import { CheckIcon, ChevronsUpDownIcon, LayoutGridIcon } from "lucide-react";
import { Link } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppModule } from "../app-module";

/**
 * アプリの切り替え。
 * @param props - current：開いているアプリ、using：使っているアプリ（登録の一覧の順）、onNavigate：項目を選んだときの処理（ドロワーを閉じる）
 * @returns アプリの切り替え
 */
export function AppSwitcher({ current, using, onNavigate }: { current: AppModule; using: readonly AppModule[]; onNavigate?: () => void }) {
  const CurrentIcon = current.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="アプリを切り替える"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium hover:bg-accent lg:min-h-10"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
          <CurrentIcon className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate">{appById(current.id)?.name ?? current.id}</span>
        <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {using.map((app) => {
          const Icon = app.icon;
          return (
            <DropdownMenuItem key={app.id} asChild>
              <Link to={app.basePath} onClick={onNavigate} aria-current={app.id === current.id ? "page" : undefined}>
                <Icon className="size-4" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{appById(app.id)?.name ?? app.id}</span>
                {app.id === current.id && <CheckIcon className="size-4" aria-label="開いているアプリ" />}
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/apps" onClick={onNavigate}>
            <LayoutGridIcon className="size-4" /> すべてのアプリ
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
