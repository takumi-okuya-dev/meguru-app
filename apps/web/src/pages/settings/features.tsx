// 設定 > 運営 > 使える機能（specs/019-feature-switches contracts/ui-routes.md 4、US1・US4、FR-002・FR-013・FR-014）。
// 運営者だけ。人を探して、まとまりごとにON/OFF（人の設定）。OFFの人の一覧と、最近の変更（人とグループ）。
// 画面はモック（https://claude.ai/artifact/XbnRAoVcfS7HCprqHfrrqi 、2026-11-04 OK）のとおり。
import { FEATURE_LABELS, type FeatureSettingsList, type OperatorUser } from "@threads-grower/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { FeatureSwitches, Toggle } from "@/components/settings/FeatureSwitches";
import { ConfirmDialog } from "@/components/team/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

/** 「この画面について」の箇条書き（contracts/ui-routes.md 4）。 */
const HELP = [
  "OFFにした機能は、その人のサイドバーから消えます",
  "書いた内容は消えません。ONに戻すとそのまま使えます",
  "チームでは、アカウントの持ち主の設定に従います",
  "グループでOFFの機能は、その人がONでも使えません",
  "自動投稿は、投稿をつくる・投稿ストック・パフォーマンスのまとまりです",
];

/**
 * 日付の表示（例：11/4）。
 * @param iso - ISO 8601 の日時
 * @returns 表示の文字列
 */
const md = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/**
 * 日時の表示（例：11/4 14:02）。
 * @param iso - ISO 8601 の日時
 * @returns 表示の文字列
 */
const mdhm = (iso: string) => {
  const d = new Date(iso);
  return `${md(iso)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const labels = (fs: readonly (keyof typeof FEATURE_LABELS)[]) => fs.map((f) => FEATURE_LABELS[f]).join("・");

/**
 * 使える機能（/settings/features）。
 * @returns 画面
 */
export function FeaturesPage() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: queryKeys.featureSettings, queryFn: api.featureSettings, retry: false });
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<OperatorUser | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<{ userId: string; name: string } | null>(null);
  const [resetPending, setResetPending] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.featureSettings });

  const search = async (e: FormEvent) => {
    e.preventDefault();
    setSearchError(null);
    setFound(null);
    try {
      setFound(await api.findOperatorUser(email.trim()));
    } catch (err) {
      setSearchError(err instanceof ApiError && err.code === "USER_NOT_FOUND" ? "見つかりません" : describeError(err));
    }
  };

  if (list.isError && list.error instanceof ApiError && list.error.code === "OPERATOR_ONLY") {
    return <p className="text-sm text-muted-foreground">この画面は運営者だけが使えます。</p>;
  }

  return (
    <div className="space-y-7">
      <h1 className="text-2xl font-semibold max-md:hidden">使える機能</h1>

      <section aria-labelledby="feature-search-title" className="space-y-2.5">
        <h2 id="feature-search-title" className="font-medium">
          人を探す
        </h2>
        <form className="flex gap-2" onSubmit={(e) => void search(e)}>
          <Input
            type="email"
            aria-label="メールアドレス"
            placeholder="メールアドレス"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-full px-4 md:h-9"
          />
          <Button type="submit" variant="outline" className="h-10 rounded-full md:h-9" disabled={email.trim() === ""}>
            探す
          </Button>
        </form>
        {searchError && (
          <p role="alert" className="text-sm text-muted-foreground">
            {searchError}
          </p>
        )}
        {found && (
          <div className="space-y-2 rounded-2xl border bg-card px-4 py-3.5">
            <div className="flex flex-col leading-snug">
              <span className="font-medium">{found.name}</span>
              <span className="text-[13px] text-muted-foreground">
                {found.email}
                {found.group ? ` · グループ：${found.group.name}` : ""}
              </span>
            </div>
            <FeatureSwitches
              key={found.userId}
              label={`${found.name}の使える機能`}
              disabled={found.disabled}
              notes={Object.fromEntries((found.group?.disabled ?? []).map((f) => [f, "グループでOFF"]))}
              onSave={async (values) => {
                setFound(await api.putFeatureSettings(found.userId, values));
                await refresh();
              }}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="feature-off-title" className="space-y-2.5">
        <h2 id="feature-off-title" className="font-medium">
          OFFの人
        </h2>
        {list.isPending ? (
          <p className="text-sm text-muted-foreground">読み込み中…</p>
        ) : list.isError ? (
          <p role="alert" className="text-sm text-muted-foreground">
            {describeError(list.error)}
          </p>
        ) : list.data.users.length === 0 ? (
          <p className="text-sm text-muted-foreground">OFFの人はいません</p>
        ) : (
          <OffList users={list.data.users} onReset={setResetting} />
        )}
      </section>

      {list.data && (
        <Toggle title="最近の変更" region="最近の変更">
          {list.data.events.length === 0 ? (
            <p className="text-muted-foreground">まだ変更はありません</p>
          ) : (
            <ul className="space-y-1">
              {list.data.events.map((e, i) => (
                <li key={`${e.createdAt}-${i}`} className="flex gap-2.5">
                  <span className="w-[76px] shrink-0 text-muted-foreground tabular-nums">{mdhm(e.createdAt)}</span>
                  <span className="min-w-0">
                    {e.subjectName}の{FEATURE_LABELS[e.feature]}を{e.action === "disabled" ? "OFF" : "ON"}（{e.actorName}）
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Toggle>
      )}

      <Toggle title="この画面について" region="この画面について">
        <ul className="space-y-0.5">
          {HELP.map((h) => (
            <li key={h}>・{h}</li>
          ))}
        </ul>
      </Toggle>

      {resetting && (
        <ConfirmDialog
          title={`${resetting.name}さんを、すべてONに戻しますか？`}
          confirmLabel="すべてONに戻す"
          pending={resetPending}
          onCancel={() => setResetting(null)}
          onConfirm={async () => {
            setResetPending(true);
            try {
              const after = await api.resetFeatureSettings(resetting.userId);
              if (found?.userId === after.userId) setFound(after);
              await refresh();
              setResetting(null);
            } finally {
              setResetPending(false);
            }
          }}
        >
          グループの設定は変わりません。
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * OFFの人の一覧。
 * @param props - users：OFFの人、onReset：「すべてONに戻す」を押した
 * @returns 一覧
 */
function OffList({
  users,
  onReset,
}: {
  users: FeatureSettingsList["users"];
  onReset: (u: { userId: string; name: string }) => void;
}) {
  return (
    <ul className="divide-y rounded-2xl border bg-card px-4">
      {users.map((u) => (
        <li key={u.userId} className="flex items-center gap-2.5 py-3">
          <span className="flex min-w-0 flex-1 flex-col leading-snug">
            <span className="truncate font-medium">{u.name}</span>
            <span className="truncate text-[13px] text-muted-foreground">{u.email}</span>
            <span className="text-[13px]">
              {labels(u.disabled)} · {md(u.updatedAt)}
            </span>
          </span>
          <Button variant="ghost" className="h-10 shrink-0 rounded-full md:h-9" onClick={() => onReset({ userId: u.userId, name: u.name })}>
            すべてONに戻す
          </Button>
        </li>
      ))}
    </ul>
  );
}
