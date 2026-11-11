// 下書きの長さの表示（specs/003 FR-013、Clarifications Q3、contracts/ui-routes.md「各下書き」）。
// Threadsの数え方（絵文字はUTF-8のバイト数）で、上限（500）までの使用量を細いバーで出す。
import { THREADS_LINK_LIMIT, THREADS_TEXT_LIMIT, countLinks, threadsLength } from "@meguru/shared";
import { cn } from "@/lib/utils";

/** 使用量がこの割合を超えたら、バーを注意の色の手前の色にする */
const NEAR_LIMIT_RATIO = 0.8;

/**
 * 文字数と、上限までの使用量のバー。上限を超えたら注意の色と案内、リンクが多すぎるときも案内を出す。
 * @param props - text：下書きの本文、className：追加のクラス
 * @returns 長さの表示
 */
export function ThreadsLengthBar({ text, className }: { text: string; className?: string }) {
  const length = threadsLength(text);
  const links = countLinks(text);
  const ratio = length / THREADS_TEXT_LIMIT;
  const over = length > THREADS_TEXT_LIMIT;
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-2">
        <div
          role="meter"
          aria-label="Threadsの上限までの使用量"
          aria-valuemin={0}
          aria-valuemax={THREADS_TEXT_LIMIT}
          aria-valuenow={Math.min(length, THREADS_TEXT_LIMIT)}
          className="h-1 w-24 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full",
              over ? "bg-warning" : ratio > NEAR_LIMIT_RATIO ? "bg-warning/50" : "bg-muted-foreground/50",
            )}
            style={{ width: `${Math.min(ratio, 1) * 100}%` }}
          />
        </div>
        <span className={cn("text-xs tabular-nums text-muted-foreground", over && "font-medium text-warning")}>
          {length}文字
        </span>
      </div>
      {over && <p className="text-xs text-warning">Threadsの上限を超えています（{THREADS_TEXT_LIMIT}文字まで）</p>}
      {links > THREADS_LINK_LIMIT && <p className="text-xs text-warning">リンクは{THREADS_LINK_LIMIT}個までです</p>}
    </div>
  );
}
