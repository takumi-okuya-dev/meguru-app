// 設定 > 運営 > グループ（specs/016-test-groups contracts/ui-routes.md 3、US2、FR-009〜FR-011・FR-013）。
// 運営者だけ。一覧（作る）と、グループの詳しい画面（名前と上限・使える機能・招待リンク・人を外す・閉じる・記録）。
// 2026-11-04（specs/019）：本番でも組織の単位として使うので、項目名を「グループ」にし、「使える機能」を足した。
import {
  TEST_GROUP_CAPACITY_MAX,
  TEST_GROUP_CAPACITY_MIN,
  TEST_GROUP_NAME_MAX,
  type TestGroupDetail,
  type TestGroupEventAction,
} from "@meguru/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { FeatureSwitches } from "@/components/FeatureSwitches";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SwapLabel } from "@/components/SwapLabel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError, api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

/**
 * 日付の表示（例：2026年10月31日）。
 * @param iso - ISO 8601 の日時
 * @returns 表示の文字列
 */
function ymd(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 読み込めなかったときの表示。運営者でない（OPERATOR_ONLY）・仕組みがOFF（404）なら「運営者だけ」、
 * それ以外（通信の失敗・グループが見つからない など）はエラーの中身を出す。運営者本人に「運営者だけ」と見せない。
 * @param props - error：読み込みのエラー
 * @returns 表示
 */
function LoadError({ error }: { error: Error }) {
  const operatorOnly =
    error instanceof ApiError &&
    (error.code === "OPERATOR_ONLY" || (error.status === 404 && error.code !== "ITEM_NOT_FOUND"));
  return (
    <p role={operatorOnly ? undefined : "alert"} className="text-sm text-muted-foreground">
      {operatorOnly ? "この画面は運営者だけが使えます。" : describeError(error)}
    </p>
  );
}

/**
 * 名前と上限を入れるダイアログ（作る・変える）。
 * @param props - title：見出し、initial：初めの値、submitLabel：ボタン、hint：上限を下げたときの注意を出すための今の人数、
 *   onSubmit：送る、onClose：閉じる
 * @returns ダイアログ
 */
function GroupFormDialog({
  title,
  initial,
  submitLabel,
  memberCount,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: { name: string; capacity: number };
  submitLabel: string;
  memberCount?: number;
  onSubmit: (v: { name: string; capacity: number }) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [capacity, setCapacity] = useState(String(initial.capacity));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const n = Number(capacity);
  const lowered = memberCount !== undefined && Number.isInteger(n) && n < memberCount;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onSubmit({ name: name.trim(), capacity: n });
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">グループの名前と、人数の上限を決めます</DialogDescription>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">グループ名（組織やコミュニティの名前）</span>
            <Input value={name} maxLength={TEST_GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">
              人数の上限（{TEST_GROUP_CAPACITY_MIN}〜{TEST_GROUP_CAPACITY_MAX}人）
            </span>
            <Input
              type="number"
              inputMode="numeric"
              min={TEST_GROUP_CAPACITY_MIN}
              max={TEST_GROUP_CAPACITY_MAX}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              required
            />
          </label>
          {lowered && (
            <p className="text-sm text-muted-foreground">
              入っている人は外れません。人数が上限より少なくなるまで、新しい人は入れません。
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-10 rounded-full" onClick={onClose}>
              キャンセル
            </Button>
            <Button type="submit" className="h-10 rounded-full" disabled={pending || name.trim() === ""}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * テスト用のグループの一覧（/settings/test-groups）。
 * @returns 画面
 */
export function TestGroupsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: queryKeys.testGroups, queryFn: api.testGroups, retry: false });
  const [creating, setCreating] = useState(false);

  if (list.isPending) return <p className="text-sm text-muted-foreground">読み込み中…</p>;
  if (list.isError) return <LoadError error={list.error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold max-md:hidden">グループ</h1>
        <Button className="rounded-full" onClick={() => setCreating(true)}>
          グループを作る
        </Button>
      </div>
      {list.data.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          まだグループはありません。組織やコミュニティごとにグループを作り、招待リンクを送ってください。
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {list.data.groups.map((g) => (
            <li key={g.id}>
              <Link to={`/settings/test-groups/${g.id}`} className="flex min-h-[52px] items-center gap-3 px-4 py-3 hover:bg-accent">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{g.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {g.closedAt
                      ? "閉じています"
                      : `${g.memberCount}／${g.capacity}人${g.memberCount >= g.capacity ? "（定員）" : ""}`}
                  </span>
                </span>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <GroupFormDialog
          title="グループを作る"
          initial={{ name: "", capacity: 10 }}
          submitLabel="作る"
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            const g = await api.createTestGroup(v);
            await queryClient.invalidateQueries({ queryKey: queryKeys.testGroups });
            void navigate(`/settings/test-groups/${g.id}`);
          }}
        />
      )}
    </div>
  );
}

/**
 * 記録の文言（contracts/ui-routes.md 3）。
 * @param e - 記録
 * @returns 文言
 */
function eventText(e: TestGroupDetail["events"][number]): string {
  const subject = e.subjectName ?? "";
  const texts: Record<TestGroupEventAction, string> = {
    created: `${e.actorName}さんがグループを作りました`,
    renamed: `${e.actorName}さんが名前を変えました`,
    capacity_changed: `${e.actorName}さんが上限を変えました`,
    invite_rotated: `${e.actorName}さんが招待リンクを作り直しました`,
    closed: `${e.actorName}さんがグループを閉じました`,
    member_joined: `${subject}さんが入りました`,
    member_removed: `${e.actorName}さんが${subject}さんを外しました`,
  };
  return texts[e.action];
}

type Confirm = { kind: "rotate" } | { kind: "close" } | { kind: "remove"; userId: string; name: string };

/**
 * グループの詳しい画面（/settings/test-groups/:groupId）。
 * @returns 画面
 */
export function TestGroupDetailPage() {
  const { groupId = "" } = useParams<{ groupId: string }>();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: queryKeys.testGroup(groupId), queryFn: () => api.testGroup(groupId), retry: false });
  // 招待リンクの「テスト版を使えます」は、テスト版（招待制がON）でだけ出す（specs/019 contracts/ui-routes.md 5）
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const testVersion = Boolean(me.data?.testGroups.enabled);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [copied, setCopied] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  const apply = (g: TestGroupDetail) => {
    queryClient.setQueryData(queryKeys.testGroup(groupId), g);
    void queryClient.invalidateQueries({ queryKey: queryKeys.testGroups, exact: true });
  };
  const action = useMutation({
    mutationFn: (c: Confirm) =>
      c.kind === "rotate"
        ? api.rotateTestGroupInvite(groupId)
        : c.kind === "close"
          ? api.closeTestGroup(groupId)
          : api.removeTestGroupMember(groupId, c.userId),
    onSuccess: (g) => {
      apply(g);
      setConfirm(null);
      setCopied(false);
    },
  });

  if (detail.isPending) return <p className="text-sm text-muted-foreground">読み込み中…</p>;
  if (detail.isError) return <LoadError error={detail.error} />;
  const g = detail.data;
  const closed = g.closedAt !== null;

  const copy = async () => {
    if (!g.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(g.inviteUrl);
      setCopied(true);
    } catch {
      // コピーできない環境では、入力欄を選択して手でコピーしてもらう
      urlRef.current?.select();
    }
  };

  return (
    <div className="space-y-6">
      <Link to="/settings/test-groups" className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:underline">
        <ChevronLeftIcon className="size-4" /> グループの一覧
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold break-words">{g.name}</h1>
        <p className="text-sm text-muted-foreground">
          {closed ? `閉じています（${ymd(g.closedAt!)}）` : `${g.memberCount}／${g.capacity}人${g.memberCount >= g.capacity ? "（定員）" : ""}`}
        </p>
        {!closed && (
          <Button variant="outline" size="sm" className="mt-2 rounded-full" onClick={() => setEditing(true)}>
            名前と上限を変える
          </Button>
        )}
      </div>

      {!closed && (
        <section aria-labelledby="group-features-title" className="space-y-2 rounded-xl border bg-card px-4 py-3">
          <h2 id="group-features-title" className="text-sm font-medium">
            使える機能
          </h2>
          <FeatureSwitches
            key={g.id}
            label={`${g.name}の使える機能`}
            disabled={g.disabled}
            onSave={async (values) => {
              queryClient.setQueryData(queryKeys.testGroup(g.id), await api.putTestGroupFeatures(g.id, values));
              await queryClient.invalidateQueries({ queryKey: queryKeys.featureSettings });
            }}
          />
        </section>
      )}

      {!closed && g.inviteUrl && (
        <section aria-labelledby="invite-title" className="space-y-2 rounded-xl border bg-card p-4">
          <h2 id="invite-title" className="text-sm font-medium">
            招待リンク
          </h2>
          {testVersion && <p className="text-xs text-muted-foreground">このリンクから「参加する」を押した人が、テスト版を使えます。</p>}
          <div className="flex flex-wrap gap-2">
            <input
              ref={urlRef}
              readOnly
              value={g.inviteUrl}
              aria-label="招待リンク"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
            />
            <Button variant="outline" onClick={() => void copy()}>
              <SwapLabel labels={{ idle: "コピー", done: "コピーしました" }} show={copied ? "done" : "idle"} />
            </Button>
          </div>
          <Button variant="link" className="h-auto p-0 text-sm" onClick={() => setConfirm({ kind: "rotate" })}>
            リンクを作り直す
          </Button>
        </section>
      )}

      <section aria-labelledby="members-title" className="space-y-2">
        <h2 id="members-title" className="text-sm font-medium">
          入っている人
        </h2>
        {g.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ誰も入っていません。</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {g.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.email} · {ymd(m.joinedAt)}に入りました
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setConfirm({ kind: "remove", userId: m.userId, name: m.name })}
                >
                  外す
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!closed && (
        <div className="pt-2">
          <Button
            variant="outline"
            className="rounded-full border-destructive text-destructive hover:bg-destructive/10"
            onClick={() => setConfirm({ kind: "close" })}
          >
            グループを閉じる
          </Button>
        </div>
      )}

      <section aria-labelledby="events-title" className="space-y-2">
        <h2 id="events-title" className="text-sm font-medium">
          記録
        </h2>
        <ul className="space-y-1 text-sm">
          {g.events.map((e, i) => (
            <li key={`${e.createdAt}-${i}`} className="flex flex-wrap gap-x-2">
              <span className="text-muted-foreground">{ymd(e.createdAt)}</span>
              <span>{eventText(e)}</span>
            </li>
          ))}
        </ul>
      </section>

      {editing && (
        <GroupFormDialog
          title="名前と上限を変える"
          initial={{ name: g.name, capacity: g.capacity }}
          memberCount={g.memberCount}
          submitLabel="保存する"
          onClose={() => setEditing(false)}
          onSubmit={async (v) => apply(await api.updateTestGroup(groupId, v))}
        />
      )}

      {confirm?.kind === "rotate" && (
        <ConfirmDialog
          title="リンクを作り直しますか？"
          confirmLabel="作り直す"
          pending={action.isPending}
          error={action.isError ? describeError(action.error) : null}
          onConfirm={() => action.mutate(confirm)}
          onCancel={() => setConfirm(null)}
        >
          <p>前のリンクは使えなくなります。入っている人はそのままです。</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === "remove" && (
        <ConfirmDialog
          title={`${confirm.name}さんをグループから外しますか？`}
          confirmLabel="外す"
          destructive
          pending={action.isPending}
          error={action.isError ? describeError(action.error) : null}
          onConfirm={() => action.mutate(confirm)}
          onCancel={() => setConfirm(null)}
        >
          <p>この人はテスト版を使えなくなり、自動投稿も止まります。データは消えません。</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === "close" && (
        <ConfirmDialog
          title="グループを閉じますか？"
          confirmLabel="グループを閉じる"
          destructive
          pending={action.isPending}
          error={action.isError ? describeError(action.error) : null}
          onConfirm={() => action.mutate(confirm)}
          onCancel={() => setConfirm(null)}
        >
          <p>
            入っている{g.memberCount}人は全員テスト版を使えなくなり、自動投稿も止まります。招待リンクも使えなくなります。閉じたグループは開き直せません。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
