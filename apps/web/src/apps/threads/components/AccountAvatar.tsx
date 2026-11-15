import { accountLabel, type AccountSummary } from "@meguru/shared";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Account のプロフィール画像。Meta CDN の URL は期限付きなので、読み込めなければ頭文字を出す（research.md R6）。
 * 頭文字はアカウントの名前から取る（specs/012 research.md R2）。
 * @param props - account：表示する Account、className：大きさなどの追加のクラス
 * @returns プロフィール画像
 */
export function AccountAvatar({
  account,
  className,
}: {
  account: Pick<AccountSummary, "name" | "username" | "profilePictureUrl">;
  className?: string;
}) {
  const { initial } = accountLabel(account);
  return (
    <Avatar className={cn(className)}>
      {account.profilePictureUrl && <AvatarImage src={account.profilePictureUrl} alt="" />}
      <AvatarFallback>{initial}</AvatarFallback>
    </Avatar>
  );
}
