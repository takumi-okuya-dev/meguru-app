import type { AccountSummary } from "@threads-grower/shared";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Account のプロフィール画像。Meta CDN の URL は期限付きなので、読み込めなければイニシャルを出す（research.md R6）。
 * @param props - account：表示する Account、className：大きさなどの追加のクラス
 * @returns プロフィール画像
 */
export function AccountAvatar({ account, className }: { account: Pick<AccountSummary, "username" | "displayName" | "profilePictureUrl">; className?: string }) {
  const initial = (account.displayName || account.username).slice(0, 1).toUpperCase();
  return (
    <Avatar className={cn(className)}>
      {account.profilePictureUrl && <AvatarImage src={account.profilePictureUrl} alt="" />}
      <AvatarFallback>{initial}</AvatarFallback>
    </Avatar>
  );
}
