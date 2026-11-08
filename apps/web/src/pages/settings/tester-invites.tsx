// 設定 > 運営 > テスター招待（specs/024-tester-invite-connect contracts/ui-routes.md 5、US2・US5、FR-008〜FR-014）。
// 運営者だけ。申し込みを状態ごとに見て、Metaでテスターに加えたあと「招待した」を押す。テスター枠の使用数を見る。
// 画面はモック（https://claude.ai/artifact/R6Pc9o8YomNZNDEB161eSf 5枚目）。タブは今の画面のタブ（下線）にそろえた。
import {
  DECLINE_REASON_MAX,
  TESTER_REMOVAL_REASON_LABELS,
  TESTER_SLOT_CAPACITY_MAX,
  TESTER_SLOT_CAPACITY_MIN,
  type OperatorTesterApplication,
  type TesterApplicationView,
} from "@threads-grower/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, ExternalLinkIcon } from "lucide-react";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/team/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

/** タブ（見送り・取り下げは下のリンクから）。 */
const TABS = [
  { view: "pending", label: "申し込み中" },
  { view: "invited", label: "招待済み" },
  { view: "connected", label: "接続済み" },
  { view: "removable", label: "外してよい" },
] as const;

/**
 * 日付の表示（例：11月7日）。
 * @param iso - ISO 8601 の日時
 * @returns 表示の文字列
 */
const ymd = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/**
 * テスター招待（/settings/tester-invites）。
 * @returns 画面
 */
export function TesterInvitesPage() {
  const client = useQueryClient();
  const [view, setView] = useState<TesterApplicationView>("pending");
  const list = useQuery({
    queryKey: queryKeys.operatorTesterApplications(view),
    queryFn: () => api.operatorTesterApplications(view),
    retry: false,
  });
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [declining, setDeclining] = useState<OperatorTesterApplication | null>(null);
  const [full, setFull] = useState<{ item: OperatorTesterApplication; used: string; capacity: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.operatorTesterApplicationsAll });

  /**
   * 運営者の操作を送る。枠がいっぱいなら確認のダイアログを出す。
   * @param item - 行
   * @param action - 操作
   * @param body - force・reason
   * @returns 成功したら true
   */
  const operate = async (
    item: OperatorTesterApplication,
    action: "invite" | "decline" | "revert" | "removed",
    body: { force?: boolean; reason?: string } = {},
  ) => {
    setActionError(null);
    setPending(true);
    try {
      await api.operateTesterApplication(item.id, action, body);
      await refresh();
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "TESTER_SLOTS_FULL") {
        setFull({ item, used: err.details[0] ?? "?", capacity: err.details[1] ?? "?" });
      } else {
        setActionError(describeError(err));
      }
      return false;
    } finally {
      setPending(false);
    }
  };

  if (list.isError && list.error instanceof ApiError && list.error.code === "OPERATOR_ONLY") {
    return <p className="text-sm text-muted-foreground">この画面は運営者だけが使えます。</p>;
  }

  const data = list.data;
  const enabled = data?.enabled ?? true;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold max-md:hidden">テスター招待</h1>

      {data && !enabled && (
        <p className="rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">この環境では招待の管理を使っていません</p>
      )}

      {data && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">テスター枠</span>
              <span className="text-lg font-semibold tabular-nums">
                {data.slots.used} / {data.slots.capacity}
              </span>
            </div>
            {enabled && (
              <Button variant="ghost" className="h-10 rounded-full md:h-9" onClick={() => setCapacityOpen(true)}>
                枠の数を変える
              </Button>
            )}
          </div>
          {data.threadsAppId && (
            <a
              className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
              href={`https://developers.facebook.com/apps/${data.threadsAppId}/roles/roles/`}
              target="_blank"
              rel="noreferrer"
            >
              Metaでテスターを加える
              <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            </a>
          )}
        </div>
      )}

      <Tabs value={view} onValueChange={(v) => setView(v as TesterApplicationView)}>
        <TabsList className="overflow-x-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.view} value={t.view}>
              {t.label} {data?.counts[t.view] ?? ""}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}

      {list.isPending ? (
        <p className="text-sm text-muted-foreground">読み込み中…</p>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {describeError(list.error)}
        </p>
      ) : list.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">ありません</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card px-4">
          {list.data.items.map((item) => (
            <Row
              key={item.id}
              item={item}
              view={view}
              enabled={enabled}
              pending={pending}
              onInvite={() => void operate(item, "invite")}
              onDecline={() => setDeclining(item)}
              onRevert={() => void operate(item, "revert")}
              onRemoved={() => void operate(item, "removed")}
            />
          ))}
        </ul>
      )}

      {view !== "closed" ? (
        <button type="button" className="text-sm underline underline-offset-4" onClick={() => setView("closed")}>
          見送り・取り下げを見る
        </button>
      ) : (
        <button type="button" className="text-sm underline underline-offset-4" onClick={() => setView("pending")}>
          申し込み中に戻る
        </button>
      )}

      {full && (
        <ConfirmDialog
          title="テスター枠がいっぱいです"
          confirmLabel="続ける"
          pending={pending}
          onCancel={() => setFull(null)}
          onConfirm={async () => {
            if (await operate(full.item, "invite", { force: true })) setFull(null);
          }}
        >
          <p>
            テスター枠がいっぱいです（{full.used} / {full.capacity}）。Metaの枠に空きがあるときだけ続けてください。
          </p>
        </ConfirmDialog>
      )}

      {declining && (
        <DeclineDialog
          item={declining}
          pending={pending}
          onCancel={() => setDeclining(null)}
          onSubmit={async (reason) => {
            if (await operate(declining, "decline", reason ? { reason } : {})) setDeclining(null);
          }}
        />
      )}

      {capacityOpen && data && (
        <CapacityDialog
          initial={data.slots.capacity}
          onCancel={() => setCapacityOpen(false)}
          onSave={async (n) => {
            await api.setTesterSlotCapacity(n);
            await refresh();
            setCapacityOpen(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * 一覧の1行。
 * @param props - item：行、view：今のタブ、enabled：招待の管理がONか（OFFなら操作を出さない）、pending：送っている間、
 *   onInvite・onDecline・onRevert・onRemoved：操作
 * @returns 行
 */
function Row({
  item,
  view,
  enabled,
  pending,
  onInvite,
  onDecline,
  onRevert,
  onRemoved,
}: {
  item: OperatorTesterApplication;
  view: TesterApplicationView;
  enabled: boolean;
  pending: boolean;
  onInvite: () => void;
  onDecline: () => void;
  onRevert: () => void;
  onRemoved: () => void;
}) {
  const notes = [
    item.duplicate ? "同じユーザー名の申し込みがあります" : null,
    item.alreadyConnected ? "すでにつながっています" : null,
  ].filter((n): n is string => n !== null);
  return (
    <li className="flex flex-col gap-2 py-3.5">
      <div className="flex flex-col leading-normal">
        <span className="font-semibold">@{item.threadsUsername}</span>
        <span className="text-[13px] text-muted-foreground">
          {item.applicant ? `${item.applicant.name ?? "名前なし"}・${item.applicant.email}` : "退会した利用者"}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {ymd(item.createdAt)}に申し込み
          {item.statusChangedAt !== item.createdAt ? `・${ymd(item.statusChangedAt)}に更新` : ""}
        </span>
        {view === "removable" && item.removalReason && (
          <span className="text-[13px]">
            {TESTER_REMOVAL_REASON_LABELS[item.removalReason]}
            {item.removalReason === "username_mismatch" && item.connectedUsername ? `（@${item.connectedUsername}）` : ""}
          </span>
        )}
        {view === "closed" && item.declineReason && <span className="text-[13px]">見送りの理由：{item.declineReason}</span>}
        {notes.map((n) => (
          <span key={n} className="mt-0.5 inline-flex items-center gap-1.5 text-[13px]">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {n}
          </span>
        ))}
      </div>
      {enabled && view === "pending" && (
        <div className="flex gap-2">
          <Button variant="outline" className="h-10 rounded-full md:h-9" disabled={pending} onClick={onInvite}>
            招待した
          </Button>
          <Button variant="ghost" className="h-10 rounded-full md:h-9" disabled={pending} onClick={onDecline}>
            見送る
          </Button>
        </div>
      )}
      {enabled && view === "invited" && (
        <Button variant="ghost" className="-ml-4 h-10 self-start rounded-full md:h-9" disabled={pending} onClick={onRevert}>
          申し込み中に戻す
        </Button>
      )}
      {enabled && view === "removable" && (
        <Button variant="outline" className="h-10 self-start rounded-full md:h-9" disabled={pending} onClick={onRemoved}>
          外した
        </Button>
      )}
    </li>
  );
}

/**
 * 見送りの理由を入れるダイアログ。
 * @param props - item：行、pending：送っている間、onSubmit：見送る、onCancel：やめる
 * @returns ダイアログ
 */
function DeclineDialog({
  item,
  pending,
  onSubmit,
  onCancel,
}: {
  item: OperatorTesterApplication;
  pending: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md" aria-describedby={`${id}-desc`}>
        <DialogTitle>@{item.threadsUsername}の招待を見送りますか？</DialogTitle>
        <DialogDescription id={`${id}-desc`}>理由は申し込んだ人に見えます。</DialogDescription>
        <div className="space-y-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            理由（任意）
          </label>
          <Textarea id={id} value={reason} maxLength={DECLINE_REASON_MAX} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-10 rounded-full" onClick={onCancel}>
            キャンセル
          </Button>
          <Button className="h-10 rounded-full" disabled={pending} onClick={() => onSubmit(reason.trim())}>
            見送る
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * テスター枠の数を変えるダイアログ。
 * @param props - initial：今の数、onSave：保存、onCancel：やめる
 * @returns ダイアログ
 */
function CapacityDialog({ initial, onSave, onCancel }: { initial: number; onSave: (n: number) => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const [value, setValue] = useState(String(initial));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= TESTER_SLOT_CAPACITY_MIN && n <= TESTER_SLOT_CAPACITY_MAX;
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md" aria-describedby={`${id}-desc`}>
        <DialogTitle>テスター枠の数を変える</DialogTitle>
        <DialogDescription id={`${id}-desc`}>Metaのアプリのテスターの上限に合わせてください。</DialogDescription>
        <div className="space-y-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            テスター枠の数
          </label>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={TESTER_SLOT_CAPACITY_MIN}
            max={TESTER_SLOT_CAPACITY_MAX}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-10 w-28 rounded-full px-4"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-10 rounded-full" onClick={onCancel}>
            キャンセル
          </Button>
          <Button
            className="h-10 rounded-full"
            disabled={!valid || pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await onSave(n);
              } catch (err) {
                setError(describeError(err));
              } finally {
                setPending(false);
              }
            }}
          >
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
