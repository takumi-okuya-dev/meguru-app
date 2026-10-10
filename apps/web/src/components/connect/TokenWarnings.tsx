// トークンに投稿・反応数の権限がないときの案内（specs/010-token-account-add contracts/ui-routes.md 6、US1-4・US1-5）。
// 追加の後は URL の warn から最初の表示のときに1回だけ読む（URLから消すのは useCallbackResult）。
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** 権限ごとの案内の文。 */
export const TOKEN_WARNING_TEXT = {
  publish:
    "このトークンには投稿の権限がありません。自動投稿を使うには、権限を付けて作り直したトークンで接続し直してください。",
  insights:
    "このトークンには反応数を読む権限がありません。パフォーマンスを見るには、権限を付けて作り直したトークンで接続し直してください。",
} as const;

type Kind = keyof typeof TOKEN_WARNING_TEXT;
const parse = (v: string | null): Kind[] =>
  (v ?? "").split(",").filter((k): k is Kind => k === "publish" || k === "insights");

/**
 * 権限がないものの案内。warnings を渡さなければ、URL の warn を読む。
 * @param props - warnings：出す案内（接続し直しのダイアログの結果など）
 * @returns 案内。なければ何も出さない
 */
export function TokenWarnings({ warnings }: { warnings?: Kind[] }) {
  const [params] = useSearchParams();
  const [fromUrl] = useState(() => parse(params.get("warn")));
  const kinds = warnings ?? fromUrl;
  if (kinds.length === 0) return null;
  return (
    <Alert variant="warning">
      <AlertDescription className="space-y-1 text-foreground">
        {kinds.map((k) => (
          <p key={k}>{TOKEN_WARNING_TEXT[k]}</p>
        ))}
      </AlertDescription>
    </Alert>
  );
}
