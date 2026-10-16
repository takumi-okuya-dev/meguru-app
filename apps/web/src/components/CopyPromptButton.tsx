// AIのプロンプトをコピーするボタン（specs/014-strategy-guidance。深掘り・全体の整理・解説・キーワードの案で共有する）。
// コピーできたら「コピーしました」を出し、できなければプロンプトを選べる形で出す（003の投稿のプロンプトと同じ扱い）。
import { CopyIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * プロンプトをコピーするボタン。
 * @param props - getText：押したときのプロンプト（画面の今の入力から作る）、label：ボタンの文言、
 *   copiedMessage：コピーできたときの文、disabled：押せないか、variant：見た目、onCopied：コピーできたとき
 * @returns ボタンと結果の表示
 */
export function CopyPromptButton({
  getText,
  label = "プロンプトをコピーする",
  copiedMessage = "コピーしました",
  disabled,
  variant = "default",
  className,
  onCopied,
}: {
  getText: () => string | Promise<string>;
  label?: string;
  copiedMessage?: string;
  disabled?: boolean;
  variant?: "default" | "outline";
  className?: string;
  onCopied?: () => void;
}) {
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "copied" } | { kind: "failed"; text: string } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [loading, setLoading] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const areaId = useId();

  // コピーできなかったら、全文を選んだ状態にする
  useEffect(() => {
    if (state.kind === "failed") {
      areaRef.current?.focus();
      areaRef.current?.select();
    }
  }, [state]);

  const copy = async () => {
    // プロンプトをAPIから作るボタン（解説・キーワードの案）は、読み込みに失敗することがある（PR #17 のCodexレビュー）
    let text: string;
    setLoading(true);
    try {
      text = await getText();
    } catch (err) {
      setState({ kind: "error", message: describeError(err) });
      return;
    } finally {
      setLoading(false);
    }
    try {
      await navigator.clipboard.writeText(text);
      setState({ kind: "copied" });
      onCopied?.();
    } catch {
      setState({ kind: "failed", text });
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button type="button" variant={variant} className="h-10 rounded-full px-4" disabled={disabled || loading} onClick={() => void copy()}>
          <CopyIcon className="size-4" />
          {label}
        </Button>
        {state.kind === "copied" && (
          <span role="status" className="text-[13px] text-success">
            {copiedMessage}
          </span>
        )}
      </div>
      {state.kind === "error" && (
        <p role="alert" className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm">
          プロンプトを作れませんでした。{state.message}もう一度押してください
        </p>
      )}
      {state.kind === "failed" && (
        <div className="space-y-1.5">
          <p role="alert" className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm">
            コピーできませんでした。全体を選んでコピーしてください
          </p>
          <label htmlFor={areaId} className="sr-only">
            プロンプト
          </label>
          <textarea
            id={areaId}
            ref={areaRef}
            readOnly
            value={state.text}
            className="h-48 w-full resize-y rounded-xl border bg-muted/40 px-3 py-2 font-mono text-[13px]"
          />
        </div>
      )}
    </div>
  );
}
