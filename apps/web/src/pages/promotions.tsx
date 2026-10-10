// 宣伝内容の画面（specs/002 US2、contracts/ui-routes.md「宣伝内容の画面」、docs/ui-design.md 型B）
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PROMOTION_LIMIT, type Promotion, type PromotionInput } from "@threads-grower/shared";
import { EllipsisIcon, ExternalLinkIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConflictDialog } from "@/components/ConflictDialog";
import { GrowerRequiredBanner, GrowerRequiredDialog } from "@/components/GrowerRequiredNotice";
import { ConfirmDeleteDialog } from "@/components/items/ConfirmDeleteDialog";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { PROMOTION_STATUS_LABELS, PromotionFormDialog } from "@/components/promotions/PromotionFormDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError, api } from "@/lib/api-client";
import { formatMonthDay } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { isGrowerRequired, isStale, saveErrorMessage } from "@/lib/save-error";
import { cn } from "@/lib/utils";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { useCurrentAccount } from "@/pages/account-layout";

type DialogState = { mode: "add" } | { mode: "edit"; item: Promotion } | null;

function statusPill(p: Promotion) {
  if (p.isExpired) return { label: "期限切れ", className: "bg-muted text-muted-foreground" };
  if (p.status === "active") return { label: "有効", className: "bg-success-bg text-success" };
  if (p.status === "paused") return { label: "一時停止", className: "bg-warning-bg text-warning" };
  return { label: PROMOTION_STATUS_LABELS[p.status], className: "bg-muted text-muted-foreground" };
}

function toInput(p: Promotion): PromotionInput {
  return {
    title: p.title,
    content: p.content,
    targetLocation: p.targetLocation,
    targetPersona: p.targetPersona,
    targetAgeRange: p.targetAgeRange,
    cta: p.cta,
    linkedUrl: p.linkedUrl,
    priority: p.priority,
    status: p.status,
    validUntil: p.validUntil,
  };
}

/**
 * 宣伝内容の画面。宣伝投稿の割合と、宣伝内容の一覧・追加・編集・状態の変更・削除。
 * @returns 宣伝内容の画面
 */
export function PromotionsPage() {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: queryKeys.promotions(account.id), queryFn: () => api.listPromotions(account.id) });
  const settings = useQuery({
    queryKey: queryKeys.promotionSettings(account.id),
    queryFn: () => api.getPromotionSettings(account.id),
  });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toDelete, setToDelete] = useState<Promotion | null>(null);
  const [growerLost, setGrowerLost] = useState(false);
  const [growerDialog, setGrowerDialog] = useState(false);
  // カードのメニューからの状態の変更が、他で先に更新されていた（contracts/ui-routes.md 規則5）
  const [statusConflict, setStatusConflict] = useState<{
    latest: Promotion;
    status: Promotion["status"];
    // 先に保存した人（specs/008 FR-007）
    by?: string | null;
  } | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.promotions(account.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.profileStatus(account.id) });
  };
  const onMutationError = (err: unknown) => {
    if (isGrowerRequired(err)) return setGrowerDialog(true);
    if (isStale(err) || (err instanceof ApiError && err.code === "ITEM_NOT_FOUND")) {
      toast.error(saveErrorMessage(err));
      return refresh();
    }
    toast.error(saveErrorMessage(err));
  };

  const changeStatus = useMutation({
    mutationFn: ({ item, status }: { item: Promotion; status: Promotion["status"] }) =>
      api.updatePromotion(account.id, item.id, { ...toInput(item), status, expectedVersion: item.version }),
    onSuccess: () => {
      refresh();
      toast.success("保存しました");
    },
    onError: (err, { status }) => {
      if (isStale(err)) return setStatusConflict({ latest: err.latest as Promotion, status, by: err.updatedBy?.name ?? null });
      onMutationError(err);
    },
  });
  const remove = useMutation({
    mutationFn: (item: Promotion) => api.deletePromotion(account.id, item.id),
    onSuccess: () => {
      setToDelete(null);
      refresh();
      toast.success("削除しました");
    },
    onError: (err) => {
      setToDelete(null);
      onMutationError(err);
    },
  });

  if (list.isError) return <ApiErrorScreen error={list.error} onRetry={() => void list.refetch()} />;

  const items = list.data?.items ?? [];
  const canEdit = (list.data?.canEdit ?? false) && !growerLost;
  const limit = list.data?.limit ?? PROMOTION_LIMIT;
  const atLimit = items.length >= limit;
  const targetable = items.filter((p) => p.isTargetable);
  const others = items.filter((p) => !p.isTargetable);

  const addButton = canEdit ? (
    <Button
      className="h-9 rounded-full max-md:size-11 max-md:bg-transparent max-md:p-0 max-md:text-foreground md:pr-4 md:pl-3"
      disabled={atLimit || !list.data}
      onClick={() => setDialog({ mode: "add" })}
      aria-label="宣伝内容を追加"
    >
      <PlusIcon className="size-5 md:size-4" />
      <span className="hidden md:inline">追加</span>
    </Button>
  ) : null;

  const menu = (item: Promotion) =>
    canEdit ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="-my-2 -mr-2 size-11 shrink-0 text-muted-foreground md:size-8"
            aria-label={`${item.title}の操作`}
          >
            <EllipsisIcon className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog({ mode: "edit", item })}>編集</DropdownMenuItem>
          {item.status === "active" ? (
            <DropdownMenuItem onSelect={() => changeStatus.mutate({ item, status: "paused" })}>一時停止</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => changeStatus.mutate({ item, status: "active" })}>有効に戻す</DropdownMenuItem>
          )}
          {item.status !== "ended" && (
            <DropdownMenuItem onSelect={() => changeStatus.mutate({ item, status: "ended" })}>終了</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onSelect={() => setToDelete(item)}>
            削除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <>
      <PageHeader title="宣伝内容" actions={addButton} />
      <PageBody className="space-y-7 pb-16">
        {!canEdit && list.data && <GrowerRequiredBanner />}
        <p className="text-[15px] text-muted-foreground">
          登録した宣伝内容は、投稿づくりの材料になります。宣伝内容がなくても投稿は作れます。
        </p>
        <RatioRow
          accountId={account.id}
          value={settings.data?.ratioPercent}
          canEdit={canEdit}
          onGrowerLost={() => setGrowerDialog(true)}
        />
        {canEdit && atLimit && (
          <p role="status" className="rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm">
            登録できる上限（{limit}件）に達しています。不要なものを削除してから追加してください。
          </p>
        )}
        {!list.data ? (
          <div className="h-40 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-6 py-10 text-center">
            <p className="text-[15px] text-muted-foreground">
              まだ宣伝内容がありません。イベントやサービスを登録すると、投稿の材料になります。
            </p>
            {canEdit && (
              <Button className="mt-4 rounded-full" onClick={() => setDialog({ mode: "add" })}>
                <PlusIcon className="size-4" /> 追加
              </Button>
            )}
          </div>
        ) : (
          <>
            <section className="space-y-2.5">
              <h2 className="text-[13px] font-medium text-muted-foreground">宣伝の対象（{targetable.length}）</h2>
              {targetable.map((p) => (
                <PromotionCard key={p.id} item={p} menu={menu(p)} />
              ))}
            </section>
            {others.length > 0 && (
              <section className="space-y-2.5">
                <h2 className="text-[13px] font-medium text-muted-foreground">対象外（{others.length}）</h2>
                {others.map((p) => {
                  const pill = statusPill(p);
                  return (
                    <article key={p.id} className="flex items-center gap-3 rounded-2xl border px-4 py-3">
                      <span className={cn("shrink-0 rounded-full px-2.5 py-px text-xs", pill.className)}>{pill.label}</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-x-3 md:flex-row md:items-baseline">
                        <span className="truncate font-medium text-muted-foreground">{p.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {p.isExpired && p.validUntil ? `掲載期限 ${formatMonthDay(p.validUntil)}` : `優先度 ${p.priority}`}
                        </span>
                      </span>
                      {menu(p)}
                    </article>
                  );
                })}
              </section>
            )}
          </>
        )}
      </PageBody>

      {dialog && (
        <PromotionFormDialog
          accountId={account.id}
          item={dialog.mode === "edit" ? dialog.item : undefined}
          onSaved={() => {
            setDialog(null);
            refresh();
            toast.success("保存しました");
          }}
          onClose={() => setDialog(null)}
          // ダイアログは閉じずに、入力内容を読むだけで残す（閉じるのはユーザーの操作で）
          onGrowerLost={() => setGrowerLost(true)}
          onDeletedElsewhere={refresh}
          onLimitReached={refresh}
        />
      )}
      <ConfirmDeleteDialog
        name={toDelete?.title ?? null}
        deleting={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />
      <ConflictDialog
        open={statusConflict !== null}
        updatedAt={statusConflict?.latest.updatedAt ?? null}
        updatedByName={statusConflict?.by ?? null}
        onCancel={() => setStatusConflict(null)}
        onReload={() => {
          setStatusConflict(null);
          refresh();
        }}
        onOverwrite={() => {
          // 最新の内容に、選んだ状態だけを当てて保存し直す
          if (statusConflict) changeStatus.mutate({ item: statusConflict.latest, status: statusConflict.status });
          setStatusConflict(null);
        }}
      />
      <GrowerRequiredDialog
        open={growerDialog}
        onClose={() => {
          setGrowerDialog(false);
          setGrowerLost(true);
        }}
      />
    </>
  );
}

function PromotionCard({ item, menu }: { item: Promotion; menu: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const pill = statusPill(item);
  const attrs = [item.targetLocation, item.targetPersona, item.targetAgeRange].filter((a) => a !== "");
  const long = item.content.length > 120 || item.content.split("\n").length > 3;
  return (
    <article className="space-y-2 rounded-2xl border bg-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className={cn("rounded-full px-2.5 py-px text-xs", pill.className)}>{pill.label}</span>
        <span className="text-xs text-muted-foreground">
          優先度 {item.priority}
          {item.validUntil && ` ・ ${formatMonthDay(item.validUntil)}まで`}
        </span>
        <span className="ml-auto" />
        {menu}
      </div>
      <h3 className="text-[15px] font-semibold break-words">{item.title}</h3>
      <p className={cn("text-sm whitespace-pre-wrap text-muted-foreground", !expanded && "line-clamp-3")}>
        {item.content}
      </p>
      {long && (
        <button type="button" className="text-[13px] underline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "閉じる" : "もっと見る"}
        </button>
      )}
      {attrs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attrs.map((a) => (
            <span key={a} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
              {a}
            </span>
          ))}
        </div>
      )}
      {item.cta && <p className="text-[13px] text-muted-foreground">CTA：{item.cta}</p>}
      {item.linkedUrl && (
        <a
          href={item.linkedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 text-[13px] text-ring underline"
        >
          <span className="truncate">{item.linkedUrl}</span>
          <ExternalLinkIcon className="size-3.5 shrink-0" />
        </a>
      )}
    </article>
  );
}

function RatioRow({
  accountId,
  value,
  canEdit,
  onGrowerLost,
}: {
  accountId: string;
  value: number | undefined;
  canEdit: boolean;
  onGrowerLost: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(value));
  const valid = /^\d+$/.test(shown) && Number(shown) <= 100;
  const changed = draft !== null && draft !== String(value);
  // 保存していない割合も、移動・タブを閉じる前に確認する（FR-019）
  useUnsavedChanges(canEdit && changed);

  const save = useMutation({
    mutationFn: () => api.putPromotionSettings(accountId, Number(shown)),
    onSuccess: (s) => {
      queryClient.setQueryData(queryKeys.promotionSettings(accountId), s);
      setDraft(null);
      toast.success("保存しました");
    },
    onError: (err) => (isGrowerRequired(err) ? onGrowerLost() : toast.error(saveErrorMessage(err))),
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
      <div className="min-w-0">
        <label htmlFor="promotion-ratio" className="font-medium">
          宣伝投稿の割合
        </label>
        <p className="text-[13px] text-muted-foreground">投稿全体のうち、宣伝内容を扱う投稿の割合</p>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="promotion-ratio"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={shown}
          readOnly={!canEdit}
          aria-invalid={!valid}
          onChange={(e) => setDraft(e.target.value)}
          className="h-11 w-20 rounded-xl border border-input bg-card px-3 text-right text-base md:h-9 md:text-[15px]"
        />
        <span>%</span>
        {canEdit && changed && (
          <Button size="sm" className="rounded-full" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            保存
          </Button>
        )}
      </div>
      {!valid && <p className="w-full text-[13px] text-warning">0〜100の整数で入力してください</p>}
    </div>
  );
}
