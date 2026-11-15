// 「チームを抜ける」のダイアログ（specs/011-team-revision FR-040・FR-042・FR-043、contracts/ui-routes.md「チームの画面」）。
// 管理者は、引き継ぐ人を選ぶまで「引き継いで抜ける」を押せない。管理者しかいなければ、チームの削除を案内する。
import type { TeamDetail } from "@meguru/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ROLE_NAMES = { admin: "管理者", member: "メンバー", editor: "編集者" } as const;

/**
 * チームを抜けるダイアログ。
 * @param props - team：チームの詳細、pending：抜けている途中、error：失敗の文言、onLeave：抜ける（管理者は引き継ぐ人を渡す）、
 *   onDeleteTeam：チームを削除する（管理者しかいないとき）、onCancel：やめる
 * @returns ダイアログ
 */
export function LeaveTeamDialog({
  team,
  pending,
  error,
  onLeave,
  onDeleteTeam,
  onCancel,
}: {
  team: TeamDetail;
  pending: boolean;
  error: string | null;
  onLeave: (newAdminUserId?: string) => void;
  onDeleteTeam: () => void;
  onCancel: () => void;
}) {
  const isAdmin = team.myRole === "admin";
  const heirs = team.members.filter((m) => !m.isMe);
  const [heir, setHeir] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md" aria-describedby="leave-desc">
        <DialogTitle>{team.name}を抜けますか？</DialogTitle>
        {isAdmin ? (
          heirs.length === 0 ? (
            <>
              <DialogDescription id="leave-desc" className="text-sm text-foreground/80">
                チームにはあなたしかいません。抜けるときは、チームを削除してください。あなたのアカウントは、あなたのものとして残ります。
              </DialogDescription>
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="h-10 rounded-full" onClick={onCancel}>
                  キャンセル
                </Button>
                <Button variant="destructive" className="h-10 rounded-full" onClick={onDeleteTeam}>
                  チームを削除する
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogDescription id="leave-desc" className="text-sm text-foreground/80">
                あなたはこのチームの管理者です。管理者がいなくなると、ロールの切り替えや招待ができなくなるので、抜ける前に、管理者を引き継ぐ人を選んでください。
              </DialogDescription>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">新しい管理者</legend>
                {heirs.map((m) => (
                  <label
                    key={m.userId}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2",
                      heir === m.userId && "border-foreground",
                    )}
                  >
                    <input
                      type="radio"
                      name="heir"
                      className="size-4 accent-foreground"
                      checked={heir === m.userId}
                      onChange={() => setHeir(m.userId)}
                    />
                    <span className="flex-1">{m.name}</span>
                    <span className="text-xs text-muted-foreground">{ROLE_NAMES[m.role]}</span>
                  </label>
                ))}
              </fieldset>
              <p className="text-xs text-muted-foreground">
                抜けた後も、あなたのアカウントはあなたのものとして残ります。チームに見せていた内容は、チームの人から見えなくなります。
              </p>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="h-10 rounded-full" onClick={onCancel}>
                  キャンセル
                </Button>
                <Button className="h-10 rounded-full" disabled={!heir || pending} onClick={() => heir && onLeave(heir)}>
                  引き継いで抜ける
                </Button>
              </div>
            </>
          )
        ) : (
          <>
            <DialogDescription id="leave-desc" className="text-sm text-foreground/80">
              チームに入れていたアカウントはチームから外れ、あなたのものとして残ります。
            </DialogDescription>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="h-10 rounded-full" onClick={onCancel}>
                キャンセル
              </Button>
              <Button className="h-10 rounded-full" disabled={pending} onClick={() => onLeave()}>
                抜ける
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
