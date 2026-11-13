// 受付の手伝いの画面（主催者。specs/collect/001-event-day-collection User Story 3、FR-070・FR-072・FR-073、tasks.md T051）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ link: vi.fn(), createLink: vi.fn(), stopLink: vi.fn(), workers: vi.fn() }));
vi.mock("@/apps/collect/lib/api", () => ({
  collectApi: { link: mocks.link, createLink: mocks.createLink, stopLink: mocks.stopLink, updateLink: vi.fn(), workers: mocks.workers },
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const { HelpersPage } = await import("@/apps/collect/pages/HelpersPage");
const LINK = { url: "http://localhost:5173/collect/r/cr_abc", expiresAt: "2099-11-20T17:00:00.000Z", stoppedAt: null };

/**
 * 受付の手伝いの画面を描く。
 */
function renderPage() {
  const router = createMemoryRouter([{ path: "/collect/events/:eventId/helpers", element: <HelpersPage /> }], { initialEntries: ["/collect/events/e1/helpers"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.workers.mockResolvedValue({
    owner: { lastRecordedAt: null, recordCount: 2, cashAmount: 6000 },
    helpers: [{ id: "h1", name: "井上", joinedAt: "2026-11-20T09:50:00.000Z", lastRecordedAt: null, recordCount: 1, cashAmount: 3000, deviceCount: 2 }],
  });
});

describe("受付用リンク", () => {
  it("ないときは「受付用リンクを出す」→ QRとリンク", async () => {
    mocks.link.mockResolvedValue({ link: null });
    mocks.createLink.mockResolvedValue({ link: LINK });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "受付用リンクを出す" }));
    expect(await screen.findByRole("img", { name: "受付用リンクのQRコード" })).toBeInTheDocument();
    expect(screen.getByText(LINK.url)).toBeInTheDocument();
  });

  it("止めると確かめてから止める。受付をしている人の表に端末の数", async () => {
    mocks.link.mockResolvedValue({ link: LINK });
    mocks.stopLink.mockResolvedValue({ link: null });
    const user = userEvent.setup();
    renderPage();
    const row = await screen.findByRole("row", { name: /井上/ });
    expect(within(row).getByText("2台")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /あなた（主催者）/ })).toHaveTextContent("6,000円");
    await user.click(screen.getByRole("button", { name: "止める" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "止める" }));
    await waitFor(() => expect(mocks.stopLink).toHaveBeenCalledWith("e1"));
    expect(await screen.findByRole("button", { name: "受付用リンクを出す" })).toBeInTheDocument();
  });
});
