// アプリの利用の許可のスイッチ（specs/meguru/030-app-access FR-006）。
// 運営者の「使える機能」（人ごと）と、グループの詳しい画面（グループごと）で使う。
// 「運営者が開いた人だけ」のアプリが登録されているときだけ出す（なければ何も出さない。画面は今と同じ）。
// アプリの名前は登録の一覧とアプリの一覧から出す（共通の画面にアプリの名前を書かない）。変えたらすぐ保存する。
import { appById } from "@meguru/shared";
import { useId, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/lib/api-client";
import { grantedAppsOf, useOperatorRegistry } from "@/lib/feature-defs";

type Props = {
  /** 欄の見出し */
  title: string;
  /** 今開いているアプリ */
  granted: readonly string[];
  /** アプリごとに名前の下に出す短い文（「グループで開いています」など） */
  notes?: Partial<Record<string, string>>;
  /** スイッチの組の名前（読み上げ用） */
  label: string;
  /** 開く・閉じるを保存する */
  onChange: (app: string, granted: boolean) => Promise<unknown>;
};

/**
 * 「アプリの利用」の欄。「運営者が開いた人だけ」のアプリがなければ null。
 * @param props - title：欄の見出し、granted：今開いているアプリ、notes：アプリごとの短い文、label：読み上げ用の名前、onChange：保存
 * @returns 欄（出さないときは null）
 */
export function AppAccessSwitches({ title, granted, notes = {}, label, onChange }: Props) {
  const registry = useOperatorRegistry();
  const [status, setStatus] = useState<{ kind: "saved" } | { kind: "error"; message: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const idBase = useId();
  const apps = registry.data ? grantedAppsOf(registry.data) : [];
  if (apps.length === 0) return null;
  const change = async (app: string, value: boolean) => {
    setPending(app);
    setStatus(null);
    try {
      await onChange(app, value);
      setStatus({ kind: "saved" });
    } catch (err) {
      setStatus({ kind: "error", message: describeError(err) });
    } finally {
      setPending(null);
    }
  };
  return (
    <div role="group" aria-label={label} className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="divide-y">
        {apps.map((app) => (
          <li key={app} className="flex min-h-12 items-center gap-3 py-1.5 text-sm">
            <span className="flex min-w-0 flex-1 flex-col leading-snug">
              <span id={`${idBase}-${app}`}>{appById(app)?.name ?? app}</span>
              {notes[app] && <span className="text-xs text-muted-foreground">{notes[app]}</span>}
            </span>
            <Switch
              aria-labelledby={`${idBase}-${app}`}
              checked={granted.includes(app)}
              disabled={pending !== null}
              onCheckedChange={(v) => void change(app, v)}
            />
          </li>
        ))}
      </ul>
      {status?.kind === "saved" && (
        <p role="status" className="text-[13px] text-muted-foreground">
          保存しました
        </p>
      )}
      {status?.kind === "error" && (
        <p role="alert" className="text-[13px] text-destructive">
          {status.message}
        </p>
      )}
    </div>
  );
}
