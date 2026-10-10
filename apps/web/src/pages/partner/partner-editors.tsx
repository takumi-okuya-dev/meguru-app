// 編集者と担当（specs/008-team-operations contracts/ui-routes.md「編集者と担当」、US2）。
// チームに1本の招待リンク、編集者×Accountの担当の表、編集者を外す、チーム名を変える。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Team } from "@threads-grower/shared";
import { CheckIcon, EllipsisIcon, LinkIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { InviteLinkDialog } from "@/components/team/InviteLinkDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api, describeError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";

type Editor = Team["editors"][number];

/**
 * 編集者と担当の画面。
 * @returns 画面
 */
export function PartnerEditorsPage() {
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: queryKeys.team, queryFn: api.getTeam });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<Editor | null>(null);
  const [renaming, setRenaming] = useState(false);
  const invite = useQuery({ queryKey: queryKeys.teamInvite, queryFn: api.getTeamInvite, enabled: Boolean(team.data) });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.team }),
      queryClient.invalidateQueries({ queryKey: queryKeys.me }),
    ]);

  const rotate = useMutation({
    mutationFn: api.rotateTeamInvite,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.teamInvite, data);
      toast.success("新しいリンクを作りました。前のリンクは使えません。");
    },
    onError: (err) => toast.error(describeError(err)),
  });
  const toggle = useMutation({
    mutationFn: ({ editor, accountId, on }: { editor: Editor; accountId: string; on: boolean }) =>
      on ? api.assignEditor(editor.userId, accountId) : api.unassignEditor(editor.userId, accountId),
    // 押すとすぐ表に出し、失敗したら元に戻す
    onMutate: ({ editor, accountId, on }) => {
      const prev = queryClient.getQueryData<Team>(queryKeys.team);
      if (prev) {
        queryClient.setQueryData<Team>(queryKeys.team, {
          ...prev,
          editors: prev.editors.map((e) =>
            e.userId !== editor.userId
              ? e
              : { ...e, accountIds: on ? [...e.accountIds, accountId] : e.accountIds.filter((id) => id !== accountId) },
          ),
        });
      }
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.team, ctx.prev);
      toast.error(describeError(err));
    },
    onSettled: () => void refresh(),
  });
  const remove = useMutation({
    mutationFn: (editor: Editor) => api.removeEditor(editor.userId),
    onSuccess: () => {
      setRemoving(null);
      void refresh();
    },
    onError: (err) => toast.error(describeError(err)),
  });

  if (team.isPending) return <div className="m-6 h-40 animate-pulse rounded-2xl bg-muted" aria-busy="true" />;
  if (team.isError) return <ApiErrorScreen error={team.error} onRetry={() => void team.refetch()} />;
  const data = team.data;
  const teamLabel = data.name ?? data.partnerName;
  const remaining = Math.max(0, data.editorLimit - data.editors.length);

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-14 shrink-0 flex-wrap items-center gap-3 border-b px-6 max-md:hidden">
        <h1 className="text-base font-semibold">編集者と担当</h1>
        <span className="text-sm text-muted-foreground">
          編集者 {data.editors.length}/{data.editorLimit}人
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label="チームの操作">
              <EllipsisIcon className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>チーム名を変える</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button className="ml-auto h-9 rounded-full" onClick={() => setInviteOpen(true)}>
          <PlusIcon className="size-4" />
          編集者を招待
        </Button>
      </header>
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2 md:hidden">
          <span className="text-sm text-muted-foreground">
            編集者 {data.editors.length}/{data.editorLimit}人
          </span>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setRenaming(true)}>
            チーム名を変える
          </Button>
          <Button size="sm" className="ml-auto rounded-full" onClick={() => setInviteOpen(true)}>
            <PlusIcon className="size-4" />
            編集者を招待
          </Button>
        </div>
        <p className="text-sm text-foreground/80">
          チェックしたアカウントで、その人が投稿の案・戦略を作れます。承認と設定はできません。
        </p>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3">
          <LinkIcon className="size-[18px] text-muted-foreground" />
          <div className="min-w-0 flex-1 leading-snug">
            <div className="text-sm font-medium">{teamLabel}の招待リンク</div>
            <div className="text-[13px] text-muted-foreground">
              いつでも使えます · 参加した人は{teamLabel}の編集者になります（あと{remaining}人）
            </div>
          </div>
          <Button variant="outline" className="h-10 rounded-full md:h-9" onClick={() => setInviteOpen(true)}>
            リンクとQRコード
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-full md:h-9"
            disabled={rotate.isPending}
            onClick={() => rotate.mutate()}
          >
            作り直す
          </Button>
        </div>

        {data.editors.length === 0 ? (
          <p className="rounded-2xl border px-4 py-6 text-center text-sm text-muted-foreground">
            まだ編集者はいません。「編集者を招待」から、社内のメンバーにリンクを共有してください。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-left font-normal">
                    編集者
                  </th>
                  {data.accounts.map((a) => (
                    <th key={a.id} scope="col" className="px-2 py-2.5 text-center font-normal">
                      <div className="truncate">{a.displayName ?? a.username}</div>
                      {a.own && <div className="text-[11px]">自社</div>}
                    </th>
                  ))}
                  <th scope="col" className="w-12">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.editors.map((e) => (
                  <tr key={e.userId} className="border-t">
                    <th scope="row" className="px-4 py-2 text-left font-normal">
                      <div className="font-medium">{e.name}</div>
                      <div className={cn("text-xs", e.accountIds.length === 0 ? "text-warning" : "text-muted-foreground")}>
                        {e.accountIds.length === 0 ? "担当を決めてください" : `${formatDate(e.joinedAt)}に参加`}
                      </div>
                    </th>
                    {data.accounts.map((a) => {
                      const on = e.accountIds.includes(a.id);
                      return (
                        <td key={a.id} className="px-2 py-1 text-center">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            aria-label={`${e.name}を${a.displayName ?? a.username}の担当にする`}
                            className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-accent"
                            onClick={() => toggle.mutate({ editor: e, accountId: a.id, on: !on })}
                          >
                            <span
                              className={cn(
                                "flex size-[22px] items-center justify-center rounded-md border-[1.5px]",
                                on ? "border-foreground bg-foreground text-background" : "border-muted-foreground/70",
                              )}
                            >
                              {on && <CheckIcon className="size-3.5" strokeWidth={3} />}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                    <td className="pr-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 text-muted-foreground md:size-9"
                            aria-label={`${e.name}の操作`}
                          >
                            <EllipsisIcon className="size-5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="text-destructive" onSelect={() => setRemoving(e)}>
                            外す
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          「⋯」から編集者を外せます。外した人は、どのアカウントも開けなくなります。1つの会社で編集者は{data.editorLimit}人まで。
        </p>
      </div>

      {inviteOpen && (
        <InviteLinkDialog
          title="編集者を招待"
          description={`${teamLabel}のメンバーに、このリンクかQRコードを共有してください。参加した人は編集者になり、どのアカウントを担当するかは、参加した後にあなたが決めます。`}
          url={invite.data?.url ?? null}
          qrNote={`このリンクは${teamLabel}に1本で、期限はありません。編集者は合わせて${data.editorLimit}人まで、無料です。知らない人に広まったときは「リンクを作り直す」で古いリンクを使えなくし、参加してしまった人は「⋯」から外してください。`}
          onRotate={() => rotate.mutate()}
          rotating={rotate.isPending}
          onClose={() => setInviteOpen(false)}
        />
      )}
      {removing && (
        <Dialog open onOpenChange={(v) => !v && setRemoving(null)}>
          <DialogContent role="alertdialog">
            <DialogHeader>
              <DialogTitle>{removing.name}さんを外しますか？</DialogTitle>
              <DialogDescription className="text-foreground/80">
                すべての担当がなくなり、どのアカウントも開けなくなります。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" className="rounded-full" onClick={() => setRemoving(null)}>
                キャンセル
              </Button>
              <Button
                variant="destructive"
                className="rounded-full"
                disabled={remove.isPending}
                onClick={() => remove.mutate(removing)}
              >
                外す
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {renaming && <RenameTeamDialog current={data.name ?? ""} onClose={() => setRenaming(false)} onSaved={refresh} />}
    </div>
  );
}

/**
 * チーム名を変えるダイアログ（FR-062）。
 * @param props - current：今のチーム名、onClose：閉じる、onSaved：保存の後
 * @returns ダイアログ
 */
function RenameTeamDialog({ current, onClose, onSaved }: { current: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(current);
  const save = useMutation({
    mutationFn: () => api.renameTeam(name),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(describeError(err)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>チーム名を変える</DialogTitle>
          <DialogDescription>編集者を招くときや、オーナーの画面に出ます（50文字まで）。</DialogDescription>
        </DialogHeader>
        <Input value={name} maxLength={50} aria-label="チーム名" onChange={(e) => setName(e.target.value)} autoFocus />
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onClose}>
            キャンセル
          </Button>
          <Button className="rounded-full" disabled={save.isPending} onClick={() => save.mutate()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
