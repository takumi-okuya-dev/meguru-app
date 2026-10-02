// 設定 > 外観：表示スタイルのモード（既定はライト。contracts/ui-routes.md）
// ChatGPT の外観設定にならい、配色を見本の絵（OSに合わせる・ライト・ダーク）で選ぶ
import { SettingCard } from "@/components/settings/SettingRow";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MODES: { value: Theme; label: string }[] = [
  { value: "system", label: "OSに合わせる" },
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
];

/**
 * 配色の見本の絵（サイドバー・本文の線・入力欄を簡略化して描く）。
 * @param props - tone：light か dark
 * @returns 見本の絵
 */
function Preview({ tone }: { tone: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <div className={cn("flex h-full w-full", dark ? "bg-neutral-900" : "bg-white")}>
      <div className={cn("h-full w-1/4 border-r p-1", dark ? "border-neutral-700 bg-neutral-800" : "border-neutral-200 bg-neutral-100")}>
        <div className={cn("size-1.5 rounded-full", dark ? "bg-neutral-500" : "bg-neutral-300")} />
      </div>
      <div className="flex flex-1 flex-col justify-between p-1.5">
        <div className="space-y-1">
          <div className="ml-auto h-0.5 w-3/5 rounded bg-blue-500" />
          <div className={cn("h-0.5 w-4/5 rounded", dark ? "bg-neutral-600" : "bg-neutral-300")} />
          <div className={cn("h-0.5 w-3/5 rounded", dark ? "bg-neutral-600" : "bg-neutral-300")} />
          <div className="ml-auto h-0.5 w-2/5 rounded bg-blue-500" />
        </div>
        <div className={cn("flex h-2 items-center justify-end rounded-full px-0.5", dark ? "bg-neutral-800" : "bg-neutral-100")}>
          <div className="size-1 rounded-full bg-blue-500" />
        </div>
      </div>
    </div>
  );
}

/**
 * モードの見本の絵。OSに合わせるは、左半分をライト、右半分をダークにする。
 * @param props - mode：選べる配色
 * @returns 見本の絵
 */
function ModeThumbnail({ mode }: { mode: Theme }) {
  if (mode === "system") {
    // 左半分がライト、右半分がダーク
    return (
      <div className="relative h-full w-full">
        <Preview tone="light" />
        <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
          <div className="absolute inset-y-0 right-0 w-[200%]">
            <Preview tone="dark" />
          </div>
        </div>
      </div>
    );
  }
  return <Preview tone={mode} />;
}

/**
 * 設定 > 外観。表示スタイルのモードを見本の絵（OSに合わせる・ライト・ダーク）で選ぶ。既定はライト。
 * @returns 外観の設定
 */
export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">外観</h1>
      <section className="space-y-3">
        <h2 className="text-base font-medium">表示スタイル</h2>
        <SettingCard>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="text-sm font-medium" id="mode-label">
              モード
            </div>
            <div role="radiogroup" aria-labelledby="mode-label" className="flex gap-3">
              {MODES.map(({ value, label }) => {
                const selected = theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={label}
                    title={label}
                    onClick={() => setTheme(value)}
                    className={cn(
                      "h-14 w-20 overflow-hidden rounded-lg border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected ? "border-blue-500" : "border-border hover:border-muted-foreground/40",
                    )}
                  >
                    <ModeThumbnail mode={value} />
                  </button>
                );
              })}
            </div>
          </div>
        </SettingCard>
        <p className="text-xs text-muted-foreground">
          {MODES.find((m) => m.value === theme)?.label}を選択中。OSに合わせるを選ぶと、OSのライト・ダークの設定に従います。
        </p>
      </section>
    </div>
  );
}
