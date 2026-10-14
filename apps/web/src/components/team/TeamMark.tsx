// チームの色の四角（チーム名の頭文字。specs/011 contracts/ui-routes.md「サイドバー」）。
import { cn } from "@/lib/utils";

// 白の文字で読める濃さの色（チーム名から決まる。同じ名前はいつも同じ色）
const COLORS = ["#8A5A2B", "#2F5D8A", "#3F6B3A", "#7A3E6B", "#5A4B8A", "#8A3B3B"];

/**
 * チーム名から色を選ぶ。
 * @param name - チーム名
 * @returns 色
 */
function colorOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return COLORS[h % COLORS.length]!;
}

/**
 * チームの色の四角。
 * @param props - name：チーム名、className：大きさ・文字の大きさ
 * @returns 四角
 */
export function TeamMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center rounded-[5px] font-semibold text-white", className)}
      style={{ background: colorOf(name) }}
    >
      {[...name.trim()][0] ?? "・"}
    </span>
  );
}
