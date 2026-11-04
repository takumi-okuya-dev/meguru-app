// 投稿ストックと「投稿をつくる」の画面のテストの見本と組み立て（api-client の差し替えは各テストのファイルで行う）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { POST_LENGTH_DEFAULTS } from "@threads-grower/shared";
import type {
  AccountSummary,
  DraftBatchResult,
  PostDraft,
  PostDraftList,
  PromptResponse,
} from "@threads-grower/shared";
import type { ReactNode } from "react";
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from "react-router";
import { UnsavedChangesProvider } from "@/components/UnsavedChangesProvider";

export const account: AccountSummary = {
  id: "a1",
  name: "たくみ",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  connectionStatus: "connected",
  lastUsedAt: null,
  role: "owner" as const,
  ownerName: null,
};

export const PROMPT = "以下の情報をもとに、Threadsに投稿する文章を30件作ってください。";

export function promptResponse(
  overrides: Partial<PromptResponse["summary"]> = {},
  count = 30,
): PromptResponse {
  const prompt = count === 30 ? PROMPT : `${count}件のプロンプト`;
  return {
    prompt,
    parts: [`1つ目：${prompt}`, `2つ目：${prompt}`],
    count,
    length: [...prompt].length,
    splitRecommended: false,
    settings: { postCount: count, length: { ...POST_LENGTH_DEFAULTS }, version: 1 },
    materials: {
      strategy: { items: [], done: 11, review: 0, purposeDone: 0 },
      drafts: { profileBio: false, pinned: [false, false, false] },
      promotions: { included: 1, missingCta: 0 },
      research: { total: 3, included: 3, explained: 3, pending: 0 },
    },
    summary: {
      strategyFilledCount: 11,
      promotionCount: 1,
      referencePostCount: 3,
      recentDraftCount: 0,
      length: 100,
      coreRuleCount: 0,
      ngWordCount: 0,
      rejectedCount: 0,
      dailyPostCount: 0,
      poorPostCount: 0,
      trendCount: 0,
      ...overrides,
    },
  };
}

export function draft(overrides: Partial<PostDraft> = {}): PostDraft {
  return {
    id: "d1",
    batchId: "b1",
    position: 0,
    body: "下書きの本文",
    status: "needs_review",
    version: 1,
    reviewedAt: null,
    rejectReasons: [],
    rejectNote: null,
    prioritizedAt: null,
    carryover: false,
    publishedAt: null,
    threadsMediaId: null,
    threadsPermalink: null,
    publishFailedAt: null,
    publishError: null,
    blockedAt: null,
    blockedReason: null,
    blockedWords: [],
    createdBy: null,
    editedBy: null,
    editedAt: null,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

export function batchResult(
  drafts: PostDraft[],
  overrides: Partial<DraftBatchResult> = {},
): DraftBatchResult {
  return {
    batchId: "b1",
    draftCount: drafts.length,
    delimiterFound: true,
    overLimitCount: 0,
    drafts,
    ...overrides,
  };
}

export function listResponse(
  overrides: {
    items?: PostDraft[];
    approved?: PostDraft[];
    rejected?: PostDraft[];
    ngWords?: PostDraftList["ngWords"];
    canGeneratePrompt?: boolean;
    promptPostCount?: number;
    publishFailed?: PostDraft[];
    schedule?: PostDraftList["schedule"];
    autoPost?: PostDraftList["autoPost"];
  } = {},
): PostDraftList {
  const { items = [], approved = [], rejected = [], ngWords = [], ...rest } = overrides;
  return {
    needsReview: items,
    approved,
    rejected,
    publishFailed: [],
    schedule: {},
    autoPost: { enabled: false, slotCount: 0, stoppedReason: null },
    counts: {
      needsReview: items.length,
      approved: approved.length,
      rejected: rejected.length,
      published: 0,
      publishFailed: 0,
    },
    limits: { needsReview: 500, approved: 500 },
    ngWords,
    canGeneratePrompt: true,
    promptPostCount: 30,
    promptPostCountVersion: 1,
    people: {},
    ...rest,
  };
}


/**
 * アカウントの画面のルーターを描く（同じ QueryClient のまま移動できる）。
 * @param children - /accounts/:accountId の下のルート
 * @param initial - 初めに開くURL（state つきも可）
 * @param layout - アカウントの画面の枠（既定はホームと投稿ストックへのリンク）
 * @returns ルーター
 */
export function renderAccountRoutes(
  children: RouteObject[],
  initial: string | { pathname: string; state?: unknown },
  layout?: ReactNode,
) {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: layout ?? (
          <UnsavedChangesProvider>
            <Outlet context={{ account }} />
          </UnsavedChangesProvider>
        ),
        children,
      },
    ],
    { initialEntries: [initial] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
