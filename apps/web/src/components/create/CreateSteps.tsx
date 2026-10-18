// 「投稿をつくる」の、投稿ができるまでの5つの手順（specs/014-strategy-guidance FR-130、research.md R15）。
// 「閉じる」で見出し1行にでき、閉じたことは端末に覚える。
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { readPreference, writePreference } from "@/lib/preferences";

const COLLAPSED_KEY = "threads-grower:create-steps-collapsed";

/**
 * 投稿ができるまでの5つの手順。
 * @param props - accountId：Account の ID
 * @returns 手順の案内
 */
export function CreateSteps({ accountId }: { accountId: string }) {
  const [collapsed, setCollapsed] = useState(() => readPreference(COLLAPSED_KEY, false));
  const base = `/accounts/${accountId}`;
  const toggle = () => {
    writePreference(COLLAPSED_KEY, !collapsed);
    setCollapsed(!collapsed);
  };
  const link = (to: string, label: string) => (
    <Link to={to} className="text-ring underline">
      {label}
    </Link>
  );

  return (
    <section aria-labelledby="create-steps-heading" className="rounded-2xl border bg-card px-4 py-3 md:px-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="create-steps-heading" className="text-sm font-semibold">
          投稿ができるまでの5つの手順
        </h2>
        <Button variant="ghost" size="sm" className="h-9 rounded-full" onClick={toggle}>
          {collapsed ? "開く" : "閉じる"}
        </Button>
      </div>
      {!collapsed && (
        <ol className="mt-1.5 space-y-1.5 text-[13px] leading-relaxed">
          <li>
            ① 材料を埋める：{link(`${base}/strategy`, "課題")}・{link(`${base}/promotions`, "宣伝内容")}・
            {link(`${base}/research`, "リサーチ")}（埋めるほど、投稿がアカウントらしくなります）
          </li>
          <li>② 下のプロンプトをコピーする</li>
          <li>③ ChatGPTやClaudeに貼り付けて送る</li>
          <li>④ 返ってきた答えを、いちばん下の欄に貼り付けて登録する</li>
          <li>⑤ {link(`${base}/stock`, "投稿ストック")}で内容を確かめて、承認する</li>
        </ol>
      )}
    </section>
  );
}
