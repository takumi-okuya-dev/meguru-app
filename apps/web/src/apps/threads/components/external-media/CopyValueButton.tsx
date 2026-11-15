// 値をコピーするボタン（specs/021 contracts/ui-routes.md 6）。押すと「コピーしました」に変わり、幅を変えない（docs/ui-design.md §6）。
import { CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { SwapLabel } from "@/components/SwapLabel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 値をコピーするボタン。
 * @param props - text：コピーする文、label：読み上げの名前、idleText：ボタンの文字（既定「コピー」）、variant：見た目、className：大きさなど
 * @returns ボタン
 */
export function CopyValueButton({
  text,
  label,
  idleText = "コピー",
  variant = "outline",
  className,
}: {
  text: string;
  label: string;
  idleText?: string;
  variant?: "default" | "outline";
  className?: string;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      aria-label={idleText === "コピー" ? `${label}をコピー` : undefined}
      disabled={text === ""}
      className={cn("h-9 shrink-0 rounded-full px-3 text-[13px]", className)}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setDone(true), () => setDone(false));
      }}
    >
      <CopyIcon className="size-3.5" aria-hidden="true" />
      <SwapLabel labels={{ idle: idleText, done: "コピーしました" }} show={done ? "done" : "idle"} />
    </Button>
  );
}
