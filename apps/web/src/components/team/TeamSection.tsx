// このアカウントの設定の「運用を手伝ってもらう」（specs/008-team-operations contracts/ui-routes.md「このアカウントの設定」、US1・US3）。
// 個人運用のオーナーに足すのは、この区分1つだけ（FR-006。原則Vの例外）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountAccessResponse, AccountTeam } from "@threads-grower/shared";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { SettingCard, SettingRow } from "@/components/settings/SettingRow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, describeError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { InviteLinkDialog } from "./InviteLinkDialog";
import { RemovePartnerDialog } from "./RemovePartnerDialog";
import { RoleDiagram, type DiagramRole } from "./RoleDiagram";
import { rosterTiers, TeamRoster } from "./TeamRoster";

/**
 * 役割の図を開く・閉じる行（FR-048）。区分を読む人の役割に「あなた」の印を付ける。
 * @param props - role：見ている人の役割
 * @returns 行と図
 */
function RolesHelp({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const you: DiagramRole | undefined = role === "owner" || role === "partner" || role === "editor" ? role : undefined;
  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm text-foreground underline underline-offset-4"
      >
        3つの役割と、できることを見る
        <ChevronDownIcon aria-hidden="true" className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && <RoleDiagram you={you} />}
    </div>
  );
}

/**
 * パートナーを招くときの説明（できること・オーナーだけができること）。
 * @returns 説明
 */
function PartnerAbilities() {
  return (
    <div className="grid gap-3 rounded-xl bg-muted/50 p-4 text-sm sm:grid-cols-2">
      <div className="space-y-1">
        <div className="font-medium">パートナーができること</div>
        <p className="text-foreground/80">投稿の案・戦略を作る、直す</p>
        <p className="text-foreground/80">パフォーマンスを見る</p>
        <p className="text-foreground/80">自社のスタッフ（編集者）を担当にする</p>
      </div>
      <div className="space-y-1">
        <div className="font-medium">あなただけができること</div>
        <p className="text-foreground/80">投稿の承認・却下</p>
        <p className="text-foreground/80">自動投稿・NGワードなどの設定</p>
        <p className="text-foreground/80">Threadsとの接続・支払い</p>
        <p className="text-xs text-muted-foreground">承認と設定は、参加した後にパートナーへ任せられます</p>
      </div>
    </div>
  );
}

/**
 * 「運用を手伝ってもらう」の区分。オーナーには招待・パートナー・任せる範囲・このアカウントのチームを、
 * パートナー・編集者にはこのアカウントのチームのカードだけを出す（FR-042）。
 * @param props - accountId：Account、access：役割と権限
 * @returns 区分。出すものがなければ何も出さない
 */
export function TeamSection({ accountId, access }: { accountId: string; access: AccountAccessResponse }) {
  const isOwner = access.role === "owner";
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: queryKeys.accountTeam(accountId), queryFn: () => api.accountTeam(accountId) });
  const invite = useQuery({
    queryKey: queryKeys.partnerInvite(accountId),
    queryFn: () => api.getPartnerInvite(accountId),
    enabled: isOwner && team.data?.partner === null,
  });
  const [dialog, setDialog] = useState(false);
  const [removing, setRemoving] = useState(false);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.accountTeam(accountId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.partnerInvite(accountId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.access(accountId) }),
    ]);

  const create = useMutation({
    mutationFn: () => api.createPartnerInvite(accountId),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.partnerInvite(accountId), data);
      setDialog(true);
    },
    onError: (err) => {
      toast.error(describeError(err));
      void refresh();
    },
  });
  const rotate = useMutation({
    mutationFn: () => api.rotatePartnerInvite(accountId),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.partnerInvite(accountId), data);
      toast.success("新しいリンクを作りました。前のリンクは使えません。");
    },
    onError: (err) => toast.error(describeError(err)),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelPartnerInvite(accountId),
    onSuccess: () => queryClient.setQueryData(queryKeys.partnerInvite(accountId), { invite: null }),
    onError: (err) => toast.error(describeError(err)),
  });
  const delegate = useMutation({
    mutationFn: (next: { review?: boolean; settings?: boolean }) => api.setDelegation(accountId, next),
    // 押すとすぐ切り替え、失敗したら元に戻す
    onMutate: (next) => {
      const prev = queryClient.getQueryData<AccountTeam>(queryKeys.accountTeam(accountId));
      if (prev?.delegation) {
        queryClient.setQueryData<AccountTeam>(queryKeys.accountTeam(accountId), {
          ...prev,
          delegation: { ...prev.delegation, ...next },
        });
      }
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.accountTeam(accountId), ctx.prev);
      toast.error(describeError(err));
    },
    onSettled: () => void refresh(),
  });
  const remove = useMutation({
    mutationFn: () => api.removePartner(accountId),
    onSuccess: () => {
      setRemoving(false);
      void refresh();
    },
    onError: (err) => toast.error(describeError(err)),
  });

  const data = team.data;
  const hasRoster = data ? rosterTiers(data).length > 0 : false;
  // パートナー・編集者には、このアカウントのチームのカードだけを出す。読み込みに失敗したときは、区分を消さずに
  // 再読み込みを出す（PR #9 のCodexレビュー）
  if (!isOwner && !team.isError && !hasRoster) return null;

  return (
    <section aria-labelledby="team-heading" className="space-y-3">
      <h2 id="team-heading" className="font-medium">
        運用を手伝ってもらう
      </h2>
      {team.isError ? (
        <p className="text-sm text-muted-foreground">
          読み込めませんでした。{" "}
          <button type="button" className="text-ring underline" onClick={() => void team.refetch()}>
            再読み込み
          </button>
        </p>
      ) : !data ? null : (
        <div className="space-y-5">
          {isOwner && !data.partner && (
            <SettingCard>
              {invite.data?.invite ? (
                <SettingRow
                  label="パートナーを招待中（参加待ち）"
                  description="パートナーが参加するまで、このリンクで参加できます"
                >
                  <div className="flex gap-2">
                    <Button variant="outline" className="h-10 rounded-full md:h-9" onClick={() => setDialog(true)}>
                      リンクを表示
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10 rounded-full md:h-9"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate()}
                    >
                      取り消す
                    </Button>
                  </div>
                </SettingRow>
              ) : (
                <SettingRow
                  label="パートナーを招待する"
                  description="運用代行・コンサルの方が、その会社のスタッフと一緒に投稿の案を作れるようになります。承認と設定は、あなたが任せるまで、あなただけが行います。"
                >
                  <Button
                    className="h-10 rounded-full md:h-9"
                    disabled={create.isPending || invite.isPending}
                    onClick={() => create.mutate()}
                  >
                    招待リンクを作る
                  </Button>
                </SettingRow>
              )}
            </SettingCard>
          )}

          {isOwner && data.partner && (
            <SettingCard>
              <SettingRow
                label={data.partner.teamName ? `${data.partner.name} · ${data.partner.teamName}` : data.partner.name}
                description={`パートナー（運用を手伝うコンサル・代理店）· ${formatDate(data.partner.joinedAt)}から参加`}
              >
                <Button
                  variant="outline"
                  className="h-10 rounded-full text-destructive md:h-9"
                  onClick={() => setRemoving(true)}
                >
                  外す
                </Button>
              </SettingRow>
            </SettingCard>
          )}

          {isOwner && data.partner && data.delegation && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground/80">パートナーに任せること</h3>
              <SettingCard>
                <SettingRow
                  label="投稿の承認・却下"
                  description="オンにすると、パートナーも承認・却下できます。誰が承認したかは操作の記録に残ります。"
                >
                  <Switch
                    aria-label="投稿の承認・却下をパートナーに任せる"
                    checked={data.delegation.review}
                    onCheckedChange={(v) => delegate.mutate({ review: v })}
                  />
                </SettingRow>
                <SettingRow
                  label="自動投稿・NGワード・投稿のルールの設定"
                  description="オンにすると、パートナーも投稿の時刻や自動投稿のオン・オフ、NGワードを変えられます。"
                >
                  <Switch
                    aria-label="設定をパートナーに任せる"
                    checked={data.delegation.settings}
                    onCheckedChange={(v) => delegate.mutate({ settings: v })}
                  />
                </SettingRow>
                <div className="px-4 py-3 text-xs text-muted-foreground">
                  編集者は、どちらもできません。Threadsとの接続・支払い・パートナーを外すことは、いつもあなただけが行えます。
                </div>
              </SettingCard>
            </div>
          )}

          {data && hasRoster && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground/80">このアカウントのチーム</h3>
              <TeamRoster team={data} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                {isOwner && (
                  <p className="text-xs text-muted-foreground">編集者は、パートナーが自社のスタッフから割り当てます。</p>
                )}
                {access.permissions.includes("activity") && (
                  <Link className="text-sm text-foreground underline" to={`/accounts/${accountId}/activity`}>
                    操作の記録を見る
                  </Link>
                )}
              </div>
            </div>
          )}

          <RolesHelp role={access.role} />
        </div>
      )}

      {dialog && (
        <InviteLinkDialog
          title="パートナーを招待"
          description="運用を手伝ってもらう方に、このリンクをLINEやメールで送ってください。相手がGoogleでログインして参加すると、パートナーになります。"
          url={invite.data?.invite?.url ?? null}
          loadFailed={invite.isError}
          onRetry={() => void invite.refetch()}
          qrNote="会って招くときは、相手のスマホでこのQRコードを読み取ってもらいます。パートナーになれるのは、最初に参加した1人（1社）だけです。"
          onRotate={() => rotate.mutate()}
          rotating={rotate.isPending}
          onClose={() => setDialog(false)}
        >
          <PartnerAbilities />
        </InviteLinkDialog>
      )}
      {removing && data?.partner && (
        <RemovePartnerDialog
          partnerName={data.partner.name}
          teamName={data.partner.teamName}
          editorNames={data.editors.map((e) => e.name)}
          removing={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setRemoving(false)}
        />
      )}
    </section>
  );
}
