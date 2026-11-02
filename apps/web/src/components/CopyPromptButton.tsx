// AIのプロンプトをコピーするボタン（specs/014-strategy-guidance。深掘り・全体の整理・解説・キーワードの案で共有する）。
// コピーできたら「コピーしました」を出し、できなければプロンプトを選べる形で出す（003の投稿のプロンプトと同じ扱い）。
// 結果の文はボタンの横ではなく下に出す。ボタンを右寄せや説明の横に置く画面では、useCopyPrompt と CopyPromptStatus で、
// 結果の文をその行の外（下の全幅）に置く。行の中に置くと、文の分だけボタンや隣が動いてしまう（2026-11-02）。
import { CopyIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type CopyState =
  | { kind: "idle" }
  | { kind: "copied" }
  | { kind: "failed"; text: string }
  | { kind: "error"; message: string };

type CopyOptions = {
  /** 押したときのプロンプト（画面の今の入力から作る） */
  getText: () => string | Promise<string>;
  /** コピーできたとき、または手でコピーする欄を出したとき */
  onCopied?: () => void;
};

/**
 * プロンプトをコピーする処理と結果。ボタンと結果の文を別の場所に置くときに使う。
 * @param options - getText・onCopied
 * @returns state：結果、loading：プロンプトを作っている途中か、copy：コピーする
 */
export function useCopyPrompt({ getText, onCopied }: CopyOptions) {
  const [state, setState] = useState<CopyState>({ kind: "idle" });
  const [loading, setLoading] = useState(false);
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
      // 手でコピーする欄を出したときも、次の手順（答えの貼り付け欄）へ進めるようにする（PR #17 のCodexレビュー）
      onCopied?.();
    }
  };
  return { state, loading, copy };
}

/**
 * プロンプトをコピーするボタンの見た目。
 * @param props - label：文言、variant：見た目、disabled：押せないか、onClick：押したとき
 * @returns ボタン
 */
export function CopyPromptTrigger({
  label = "プロンプトをコピーする",
  variant = "default",
  disabled,
  onClick,
}: {
  label?: string;
  variant?: "default" | "outline";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant={variant} className="h-10 rounded-full px-4" disabled={disabled} onClick={onClick}>
      <CopyIcon className="size-4" />
      {label}
    </Button>
  );
}

/**
 * コピーの結果の文。コピーできたときの文は、読み上げの知らせ（role="status"）を先に置いておき、文だけを入れ替える。
 * @param props - state：結果、copiedMessage：コピーできたときの文、className：外側の追加のクラス
 * @returns 結果の文
 */
export function CopyPromptStatus({
  state,
  copiedMessage = "コピーしました",
  className,
}: {
  state: CopyState;
  copiedMessage?: string;
  className?: string;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const areaId = useId();

  // コピーできなかったら、全文を選んだ状態にする
  useEffect(() => {
    if (state.kind === "failed") {
      areaRef.current?.focus();
      areaRef.current?.select();
    }
  }, [state]);

  return (
    <>
      <p role="status" className={cn(state.kind === "copied" ? "text-[13px] text-success" : "sr-only", className)}>
        {state.kind === "copied" ? copiedMessage : ""}
      </p>
      {state.kind === "error" && (
        <p role="alert" className={cn("rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm", className)}>
          プロンプトを作れませんでした。{state.message}もう一度押してください
        </p>
      )}
      {state.kind === "failed" && (
        <div className={cn("space-y-1.5", className)}>
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
    </>
  );
}

/**
 * プロンプトをコピーするボタンと、その下の結果の文。
 * @param props - getText：押したときのプロンプト（画面の今の入力から作る）、label：ボタンの文言、
 *   copiedMessage：コピーできたときの文、disabled：押せないか、variant：見た目、
 *   onCopied：コピーできたとき、または手でコピーする欄を出したとき
 * @returns ボタンと結果の表示
 */
export function CopyPromptButton({
  getText,
  label,
  copiedMessage,
  disabled,
  variant,
  className,
  onCopied,
}: CopyOptions & {
  label?: string;
  copiedMessage?: string;
  disabled?: boolean;
  variant?: "default" | "outline";
  className?: string;
}) {
  const { state, loading, copy } = useCopyPrompt({ getText, onCopied });
  return (
    <div className={cn("space-y-2", className)}>
      <CopyPromptTrigger label={label} variant={variant} disabled={disabled || loading} onClick={() => void copy()} />
      <CopyPromptStatus state={state} copiedMessage={copiedMessage} />
    </div>
  );
}
