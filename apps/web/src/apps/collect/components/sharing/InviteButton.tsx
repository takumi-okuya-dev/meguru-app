// 運営メンバーの行の招待（specs/collect/003-revenue-sharing User Story 5、FR-050・FR-055、research.md R6、tasks.md T025）。
// つながっていない人：招待のリンクを出す（QR・コピー・期限）・止める。リンクは出したときにしか見えないので、見せ直すときは出し直す。
// つながった人：つながりを外す。主催者の行には何も出さない。
import type { SharingMember, SharingSnapshot } from "@meguru/shared";
import { CopyIcon, LinkIcon, UnlinkIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { formatJstShort } from "@/lib/format";
import { collectApi } from "../../lib/api";
import { collectErrorText } from "../../lib/errors";
import { QrCode } from "../QrCode";

/**
 * 運営メンバーの行の招待の操作。
 * @param props - eventId：イベント、member：運営メンバー、onChange：分配の数字が変わった（止めた・外した・出した）
 * @returns 操作
 */
export function InviteButton({ eventId, member, onChange }: { eventId: string; member: SharingMember; onChange: (snap?: SharingSnapshot) => void }) {
  const [shown, setShown] = useState<{ url: string; expiresAt: string } | null>(null);
  const [confirm, setConfirm] = useState<"stop" | "unlink" | null>(null);
  const [pending, setPending] = useState(false);
  if (member.isOwner) return null;

  const issue = async () => {
    setPending(true);
    try {
      setShown(await collectApi.createInvite(eventId, member.id));
      onChange();
    } catch (e) {
      toast.error(collectErrorText(e));
    } finally {
      setPending(false);
    }
  };
  const act = async (kind: "stop" | "unlink") => {
    setPending(true);
    try {
      onChange(kind === "stop" ? await collectApi.stopInvite(eventId, member.id) : await collectApi.unlinkMember(eventId, member.id));
      setConfirm(null);
      toast.success(kind === "stop" ? "招待のリンクを止めました。" : "つながりを外しました。");
    } catch (e) {
      toast.error(collectErrorText(e));
    } finally {
      setPending(false);
    }
  };
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("リンクをコピーしました。");
    } catch {
      toast.error("コピーできませんでした。リンクを長押しして選んでください。");
    }
  };

  return (
    <>
      {member.linked ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm("unlink")}>
          <UnlinkIcon className="size-4" /> 外す
        </Button>
      ) : (
        <>
          {member.invite && <span className="text-xs text-muted-foreground">招待中（{formatJstShort(member.invite.expiresAt)}まで）</span>}
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void issue()} aria-label={`${member.name}の招待のリンクを${member.invite ? "出し直す" : "出す"}`}>
            <LinkIcon className="size-4" /> {member.invite ? "出し直す" : "招待"}
          </Button>
          {member.invite && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm("stop")} aria-label={`${member.name}の招待を止める`}>
              止める
            </Button>
          )}
        </>
      )}
      {shown && (
        <Dialog open onOpenChange={(v) => !v && setShown(null)}>
          <DialogContent className="sm:max-w-md" aria-describedby="invite-desc">
            <DialogTitle>{member.name}さんへの招待のリンク</DialogTitle>
            <DialogDescription id="invite-desc">
              LINE などで送ってください。受けた人は、めぐるにログインして、このイベントの分配を読むだけで見られます。リンクはこの画面でしか見られません（あとで見せたいときは出し直してください）。
            </DialogDescription>
            <div className="flex flex-col items-center gap-3">
              <QrCode value={shown.url} />
              <div className="flex w-full items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 text-xs select-all">{shown.url}</code>
                <Button type="button" variant="outline" size="sm" onClick={() => void copy(shown.url)}>
                  <CopyIcon className="size-4" /> コピー
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">期限：{formatJstShort(shown.expiresAt)}（1回だけ使えます）</p>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => setShown(null)}>
                閉じる
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm === "stop" ? "招待のリンクを止めますか？" : "つながりを外しますか？"}
          confirmLabel={confirm === "stop" ? "止める" : "外す"}
          destructive
          pending={pending}
          onConfirm={() => void act(confirm)}
          onCancel={() => setConfirm(null)}
        >
          <p>
            {confirm === "stop"
              ? `${member.name}さんに送ったリンクは使えなくなります。`
              : `${member.name}さんは、このイベントの分配を見られなくなります。運営メンバーの行と分配額は残ります。`}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
