// 参加者のセルフ受付（/collect/s/:token。ログインなし。specs/collect/002-self-check-in User Story 1・4、FR-010〜FR-023、tasks.md T018）。
// 自分の名前か受付番号を入れる → 見つかったら払い方を選ぶ → 案内（現金は受付で払う・PayPayはQR・振込は振込先）。
// 名簿にいなければ名前を送って申し出る。会場の共有にはつながず、画面が見えている間だけ3秒ごとに自分の状態を読む（research.md R5）。
// ほかの参加者の名前は出さない（完全に一致した1人だけをAPIが返す）。
// 名簿なしのイベント（specs/collect/004）では、探す代わりに名前・ふりがな・媒体・紹介してくれた人を入れて名簿に入り、払い方を選ぶ。
// 区分が未定の人には、区分ごとの金額を並べる（区分は受付の人が確かめる）。
import {
  COLLECT_LIMITS,
  COLLECT_MEDIA_LABELS,
  SELF_CHECK_IN_LIMITS,
  type CollectMedia,
  type SelfLinkInfo,
  type SelfMe,
  type SelfMethod,
  type SelfPerson,
} from "@meguru/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { formatJstWithWeekday } from "@/lib/format";
import { CenteredLayout } from "@/shell";
import { useObjectUrl } from "../components/reception/PaySheets";
import { collectErrorText } from "../lib/errors";
import { collectQueryKeys } from "../lib/query-keys";
import { yen } from "../lib/reception-model";
import { selfApi } from "../lib/self-api";

/** 払い方の言葉（参加者向け）。 */
const METHOD_LABELS: Record<SelfMethod, string> = { cash: "現金", paypay: "PayPay", transfer_today: "振込（今日）", transfer_later: "振込（後日）" };

/**
 * 本人の料金の言い方。区分が未定なら区分ごとの金額を並べる（0円の区分は出さない。specs/collect/004 FR-012）。
 * @param person - 本人
 * @param link - リンク（区分ごとの金額）
 * @returns 料金の言い方
 */
function priceText(person: SelfPerson, link: SelfLinkInfo): string {
  if (!person.tierUndecided || link.tiers.length === 0) return `${person.tierName} ${yen(person.amount)}`;
  return link.tiers.map((t) => `${t.name} ${yen(t.amount)}`).join("・");
}

/** 区分が未定の人に出す一言。 */
const TIER_NOTE = "受付の人が区分を確かめます。";

/**
 * 案内だけの画面。
 * @param props - title：見出し、children：本文
 * @returns 画面
 */
function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <CenteredLayout>
      <div className="max-w-sm space-y-2 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
      </div>
    </CenteredLayout>
  );
}

/**
 * 参加者のセルフ受付の画面。
 * @returns 画面
 */
export function SelfCheckInPublicPage() {
  const { token = "" } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: collectQueryKeys.selfInfo(token), queryFn: () => selfApi.info(token), retry: false });
  // 画面が見えている間だけ読む（TanStack Query は隠れている間は間隔の読み直しを止める）
  const me = useQuery({
    queryKey: collectQueryKeys.selfMe(token),
    queryFn: () => selfApi.me(token),
    enabled: info.isSuccess,
    refetchInterval: SELF_CHECK_IN_LIMITS.pollMs,
  });
  const [selected, setSelected] = useState<SelfPerson | null>(null);
  const [searching, setSearching] = useState(false);
  const refreshMe = () => void queryClient.invalidateQueries({ queryKey: collectQueryKeys.selfMe(token) });

  if (info.isPending) return <LoadingSkeleton />;
  if (info.isError) return <Notice title="このQRは使えません">受付の人に声をかけてください。</Notice>;
  const link = info.data;
  const status = me.data?.status ?? link.status;
  const declaration = me.data?.declaration ?? null;
  const request = me.data?.request ?? null;

  let body: ReactNode;
  if (selected && status === "active") {
    body = (
      <ChooseMethod
        token={token}
        link={link}
        person={selected}
        onDone={() => {
          setSelected(null);
          setSearching(false);
          refreshMe();
        }}
        onBack={() => setSelected(null)}
      />
    );
  } else if (declaration && !searching) {
    body = (
      <Declared
        token={token}
        link={link}
        declaration={declaration}
        canChange={status === "active" && declaration.record.paymentStatus !== "paid"}
        onChange={() => setSelected(declaration.person)}
        onOther={() => setSearching(true)}
      />
    );
  } else if (status !== "active") {
    body = (
      <section className="space-y-2 text-center">
        <h2 className="font-semibold">{status === "stopped" ? "セルフ受付は止まりました" : "セルフ受付の期限が過ぎました"}</h2>
        <p className="text-sm text-muted-foreground">受付の人に声をかけてください。</p>
      </section>
    );
  } else if (request && !searching && request.status !== "rejected") {
    body = <RequestState link={link} request={request} onChoose={setSelected} onRetry={() => setSearching(true)} />;
  } else if (link.checkInMode === "rosterless") {
    body = (
      <EntryForm
        token={token}
        link={link}
        onEntered={(person) => {
          setSearching(false);
          setSelected(person);
          refreshMe();
        }}
        onModeChanged={() => void info.refetch()}
      />
    );
  } else {
    body = (
      <SearchStep
        token={token}
        rejected={request?.status === "rejected" && !searching}
        onFound={setSelected}
        onRequested={() => {
          setSearching(false);
          refreshMe();
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-6">
      <header className="min-w-0 space-y-0.5">
        <p className="text-xs text-muted-foreground">セルフ受付</p>
        <h1 className="text-lg font-semibold break-words">{link.event.name}</h1>
        <p className="text-sm text-muted-foreground">
          {formatJstWithWeekday(link.event.startsAt)}
          {link.event.venue ? `・${link.event.venue}` : ""}
        </p>
      </header>
      {body}
    </div>
  );
}

/**
 * 自分を探す。見つからなければ、名簿にいない人として申し出られる。
 * @param props - token：リンク、rejected：前の申し出が断られた、onFound：見つかった（受付していない）、onRequested：申し出た
 * @returns 画面
 */
function SearchStep({
  token,
  rejected,
  onFound,
  onRequested,
}: {
  token: string;
  rejected: boolean;
  onFound: (person: SelfPerson) => void;
  onRequested: () => void;
}) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [requesting, setRequesting] = useState(false);

  if (requesting) return <RequestForm token={token} initialName={/^\d+$/.test(query.trim()) ? "" : query.trim()} onDone={onRequested} onBack={() => setRequesting(false)} />;

  const search = async () => {
    if (!query.trim() || pending) return;
    setPending(true);
    setMessage(null);
    setNotFound(false);
    try {
      const res = await selfApi.search(token, query);
      if (res.result === "found") {
        if (res.record) setMessage(`No.${res.person.number} ${res.person.name}さんは、もう受付が済んでいます。違うときは受付の人に声をかけてください。`);
        else onFound(res.person);
      } else if (res.result === "ambiguous") {
        setMessage("同じ名前の人がいます。受付番号で探してください（申込のメールなどに書いてあります）。");
      } else {
        setMessage("見つかりませんでした。名前の書き方を変えるか、受付番号で探してください。");
        setNotFound(true);
      }
    } catch (err) {
      setMessage(err instanceof ApiError && err.code === "RATE_LIMITED" ? "続けて探しすぎました。1分ほど待ってから探してください。" : collectErrorText(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="search-title">
      <h2 id="search-title" className="font-medium">
        名前か受付番号を入れてください
      </h2>
      {rejected && <p className="rounded-md border p-3 text-sm">前の申し出は受付できませんでした。受付の人に声をかけてください。</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Input
          aria-label="名前か受付番号"
          placeholder="例：松本 れい・12"
          className="h-11 min-w-0 flex-1"
          value={query}
          maxLength={COLLECT_LIMITS.personName}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" className="h-11" disabled={!query.trim() || pending}>
          探す
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">申込のときの名前をそのまま入れてください（ふりがなでも探せます）。ほかの人の名前は出ません。</p>
      {message && (
        <p className="text-sm" role="status">
          {message}
        </p>
      )}
      {notFound && (
        <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setRequesting(true)}>
          名簿にないので、受付の人に知らせる
        </Button>
      )}
    </section>
  );
}

/**
 * 名簿にいない人の申し出の入力。
 * @param props - token：リンク、initialName：はじめの名前、onDone：送った、onBack：戻る
 * @returns 画面
 */
function RequestForm({ token, initialName, onDone, onBack }: { token: string; initialName: string; onDone: () => void; onBack: () => void }) {
  const [name, setName] = useState(initialName);
  const [kana, setKana] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="space-y-4" aria-labelledby="request-title">
      <h2 id="request-title" className="font-medium">
        受付の人に知らせる
      </h2>
      <p className="text-sm text-muted-foreground">名前を送ると、受付の人が確かめて名簿に入れます。入ったら、この画面で払い方を選べます。</p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || pending) return;
          setPending(true);
          setError(null);
          try {
            await selfApi.request(token, { name: name.trim(), kana: kana.trim() || null });
            onDone();
          } catch (err) {
            if (err instanceof ApiError && err.code === "REQUEST_PENDING") onDone();
            else setError(err instanceof ApiError && err.code === "RATE_LIMITED" ? "受付が混んでいます。受付の人に直接声をかけてください。" : collectErrorText(err));
          } finally {
            setPending(false);
          }
        }}
      >
        <Input aria-label="名前" placeholder="名前" className="h-11" value={name} maxLength={COLLECT_LIMITS.personName} onChange={(e) => setName(e.target.value)} />
        <Input aria-label="ふりがな（なくてもよい）" placeholder="ふりがな（なくてもよい）" className="h-11" value={kana} maxLength={COLLECT_LIMITS.kana} onChange={(e) => setKana(e.target.value)} />
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="h-11" onClick={onBack}>
            戻る
          </Button>
          <Button type="submit" className="h-11 flex-1" disabled={!name.trim() || pending}>
            送る
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * 名簿なしの入れる欄（specs/collect/004 User Story 1）。名前（必須）・ふりがな・どこで申し込んだか（必須）・紹介してくれた人。
 * 紹介してくれた人の候補は出さない（ほかの人の名前が見えるため）。
 * @param props - token・link：リンク、onEntered：名簿に入った、onModeChanged：受付のしかたが変わった
 * @returns 画面
 */
function EntryForm({
  token,
  link,
  onEntered,
  onModeChanged,
}: {
  token: string;
  link: SelfLinkInfo;
  onEntered: (person: SelfPerson) => void;
  onModeChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [kana, setKana] = useState("");
  const [media, setMedia] = useState<CollectMedia | null>(null);
  const [referrer, setReferrer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 1回の入力に1つ（送り直しても同じ人になる）
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const ready = name.trim() !== "" && media !== null;
  return (
    <section className="space-y-4" aria-labelledby="entry-title">
      <h2 id="entry-title" className="font-medium">
        受付をする
      </h2>
      <p className="text-sm text-muted-foreground">名前と、どこで申し込んだかを入れてください。ほかの人の名前は出ません。</p>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready || media === null || pending) return;
          setPending(true);
          setError(null);
          try {
            const { person } = await selfApi.entry(token, { name: name.trim(), kana: kana.trim() || null, media, referrer: referrer.trim() || null, clientRequestId });
            onEntered(person);
          } catch (err) {
            if (err instanceof ApiError && err.code === "CHECK_IN_MODE_MISMATCH") onModeChanged();
            else setError(err instanceof ApiError && err.code === "RATE_LIMITED" ? "受付が混んでいます。受付の人に声をかけてください。" : collectErrorText(err));
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="space-y-2">
          <Input aria-label="名前" placeholder="名前（申し込んだときの名前）" className="h-11" value={name} maxLength={COLLECT_LIMITS.personName} onChange={(e) => setName(e.target.value)} />
          <Input aria-label="ふりがな（なくてもよい）" placeholder="ふりがな（なくてもよい）" className="h-11" value={kana} maxLength={COLLECT_LIMITS.kana} onChange={(e) => setKana(e.target.value)} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">どこで申し込みましたか</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="どこで申し込みましたか">
            {link.media.map((m) => (
              <Button
                key={m}
                type="button"
                role="radio"
                aria-checked={media === m}
                variant={media === m ? "default" : "outline"}
                className="h-11 rounded-full"
                onClick={() => setMedia(m)}
              >
                {COLLECT_MEDIA_LABELS[m]}
              </Button>
            ))}
          </div>
        </fieldset>
        <Input
          aria-label="紹介してくれた人（なくてもよい）"
          placeholder="紹介してくれた人（なくてもよい）"
          className="h-11"
          value={referrer}
          maxLength={COLLECT_LIMITS.referrer}
          onChange={(e) => setReferrer(e.target.value)}
        />
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="h-12 w-full" disabled={!ready || pending}>
          受付をする
        </Button>
      </form>
    </section>
  );
}

/**
 * 申し出の状態（待ち・名簿に入った）。
 * @param props - request：申し出、onChoose：名簿の人として払い方を選ぶ
 * @returns 画面
 */
function RequestState({
  link,
  request,
  onChoose,
  onRetry,
}: {
  link: SelfLinkInfo;
  request: NonNullable<SelfMe["request"]>;
  onChoose: (person: SelfPerson) => void;
  onRetry: () => void;
}) {
  // 名簿に入ったあとで受付の人が名簿から外した（名簿なしの二重の受付など。specs/collect/004 FR-024）
  if (request.status !== "pending" && !request.person) {
    return (
      <section className="space-y-3 text-center" aria-live="polite">
        <h2 className="font-medium">受付の人に声をかけてください</h2>
        <p className="text-sm text-muted-foreground">名簿から外されました。間違いのときは、受付の人に伝えてください。</p>
        <Button type="button" variant="outline" className="h-11" onClick={onRetry}>
          最初からやり直す
        </Button>
      </section>
    );
  }
  if (request.status === "pending" || !request.person) {
    return (
      <section className="space-y-3 text-center" aria-live="polite">
        <Loader2Icon className="mx-auto size-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <h2 className="font-medium">受付の人が確かめています</h2>
        <p className="text-sm text-muted-foreground">名簿に入ったら、この画面が進みます。このままお待ちください。</p>
      </section>
    );
  }
  const person = request.person;
  return (
    <section className="space-y-3" aria-live="polite">
      <h2 className="font-medium">名簿に入りました</h2>
      <p className="text-sm">
        受付番号 <span className="font-semibold tabular-nums">{person.number}</span>・{person.name}さん（{priceText(person, link)}）
      </p>
      {person.tierUndecided && <p className="text-xs text-muted-foreground">{TIER_NOTE}</p>}
      <Button type="button" className="h-11 w-full" onClick={() => onChoose(person)}>
        払い方を選ぶ
      </Button>
    </section>
  );
}

/**
 * 払い方を選ぶ（0円の区分は「来場を伝える」だけ）。
 * @param props - token・link：リンク、person：本人、onDone：申告した、onBack：戻る
 * @returns 画面
 */
function ChooseMethod({ token, link, person, onDone, onBack }: { token: string; link: SelfLinkInfo; person: SelfPerson; onDone: () => void; onBack: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 1回の選択に1つ（送り直しでも同じもの）
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const methods: SelfMethod[] = [
    ...(link.event.methods.includes("cash") ? (["cash"] as const) : []),
    ...(link.event.methods.includes("paypay") ? (["paypay"] as const) : []),
    ...(link.event.methods.includes("transfer") ? (["transfer_today", "transfer_later"] as const) : []),
  ];
  const declare = async (method: SelfMethod | undefined) => {
    setPending(true);
    setError(null);
    try {
      await selfApi.declare(token, person.id, method, clientRequestId);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "ALREADY_RECORDED" ? "もう受付が済んでいます。違うときは受付の人に声をかけてください。" : collectErrorText(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="space-y-4" aria-labelledby="choose-title">
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">受付番号</p>
        <p className="text-2xl font-semibold tabular-nums">{person.number}</p>
        <p className="font-medium">{person.name}さん</p>
        <p className="text-sm text-muted-foreground">{priceText(person, link)}</p>
        {person.tierUndecided && <p className="text-xs text-muted-foreground">{TIER_NOTE}</p>}
      </div>
      <h2 id="choose-title" className="font-medium">
        {person.amount === 0 ? "来場を伝えてください" : "払い方を選んでください"}
      </h2>
      <div className="grid gap-2">
        {person.amount === 0 ? (
          <Button type="button" className="h-12" disabled={pending} onClick={() => void declare(undefined)}>
            来場を伝える
          </Button>
        ) : (
          methods.map((m) => (
            <Button key={m} type="button" className="h-12" disabled={pending} onClick={() => void declare(m)}>
              {METHOD_LABELS[m]}
            </Button>
          ))
        )}
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="button" variant="ghost" className="h-11" onClick={onBack}>
        戻る（自分ではない）
      </Button>
    </section>
  );
}

/**
 * 申告したあとの案内（確かめ待ち・振込待ち・済み）。
 * @param props - token・link：リンク、declaration：自分の申告、canChange：選び直せるか、onChange：選び直す、onOther：ほかの人の受付をする
 * @returns 画面
 */
function Declared({
  token,
  link,
  declaration,
  canChange,
  onChange,
  onOther,
}: {
  token: string;
  link: SelfLinkInfo;
  declaration: NonNullable<SelfMe["declaration"]>;
  canChange: boolean;
  onChange: () => void;
  onOther: () => void;
}) {
  const { person, record } = declaration;
  const paid = record.paymentStatus === "paid";
  // 区分が未定のあいだは、仮の金額の代わりに区分ごとの金額を出す（specs/collect/004 FR-013）
  const undecided = person.tierUndecided && link.tiers.length > 0;
  const amountText = undecided ? priceText(person, link) : yen(record.amount);
  return (
    <section className="space-y-4" aria-live="polite">
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">受付番号</p>
        <p className="text-2xl font-semibold tabular-nums">{person.number}</p>
        <p className="font-medium">{person.name}さん</p>
      </div>
      {paid ? (
        <div className="space-y-1 text-center">
          <CheckCircle2Icon className="mx-auto size-10 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold">受付が済みました</h2>
          <p className="text-sm text-muted-foreground">楽しんでください。</p>
        </div>
      ) : record.paymentStatus === "awaiting_transfer" ? (
        <div className="space-y-2">
          <h2 className="font-semibold">振込をお願いします（{amountText}）</h2>
          {undecided && <p className="text-xs text-muted-foreground">申し込んだときの区分の金額を振り込んでください。わからなければ受付の人に聞いてください。</p>}
          <p className="text-sm">
            振込の名義の前に、受付番号「{person.number}」を付けてください（例：{person.number}ヤマダタロウ）。
          </p>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{link.settings.bankText ?? "振込先は受付の人に聞いてください。"}</div>
          <p className="text-xs text-muted-foreground">受付は済んでいます。入金は主催者があとで確かめます。</p>
        </div>
      ) : record.method === "paypay" ? (
        <PaypayGuide token={token} amountText={amountText} undecided={undecided} hasQr={link.settings.hasPaypayQr} />
      ) : (
        <div className="space-y-2">
          <h2 className="font-semibold">{undecided ? `受付で払ってください（${amountText}）` : `受付で${amountText}を払ってください`}</h2>
          {undecided && <p className="text-xs text-muted-foreground">{TIER_NOTE}</p>}
          <p className="text-sm text-muted-foreground">受付の人に、この画面と受付番号を見せてください。受け取ったら、この画面が「受付が済みました」に変わります。</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {canChange && (
          <Button type="button" variant="outline" className="h-11" onClick={onChange}>
            払い方を選び直す
          </Button>
        )}
        <Button type="button" variant="ghost" className="h-11" onClick={onOther}>
          ほかの人の受付をする
        </Button>
      </div>
    </section>
  );
}

/**
 * PayPay の案内（主催者のQRと金額）。
 * @param props - token：リンク、amountText：金額（区分が未定なら区分ごとの金額）、undecided：区分が未定、hasQr：QRがあるか
 * @returns 案内
 */
function PaypayGuide({ token, amountText, undecided, hasQr }: { token: string; amountText: string; undecided: boolean; hasQr: boolean }) {
  const qr = useQuery({ queryKey: collectQueryKeys.selfPaypayQr(token), queryFn: () => selfApi.paypayQr(token), enabled: hasQr, staleTime: 60_000 });
  const url = useObjectUrl(qr.data);
  return (
    <div className="space-y-2">
      <h2 className="font-semibold">{undecided ? `PayPayで送ってください（${amountText}）` : `PayPayで${amountText}を送ってください`}</h2>
      {undecided && <p className="text-xs text-muted-foreground">申し込んだときの区分の金額を送ってください。{TIER_NOTE}</p>}
      <div className="flex justify-center">
        {!hasQr ? (
          <p className="text-sm text-muted-foreground">QRは受付で見せてもらってください。</p>
        ) : url ? (
          <img src={url} alt="PayPayの受け取り用QR" className="aspect-square w-full max-w-72 rounded-lg border object-contain" />
        ) : qr.isError ? (
          <p className="text-sm text-muted-foreground">QRを読めませんでした。受付で見せてもらってください。</p>
        ) : (
          <div className="aspect-square w-full max-w-72 animate-pulse rounded-lg bg-muted" aria-busy="true" />
        )}
      </div>
      <p className="text-sm text-muted-foreground">送ったら、受付の人に送った画面を見せてください。受付の人が確かめると、この画面が「受付が済みました」に変わります。</p>
    </div>
  );
}
