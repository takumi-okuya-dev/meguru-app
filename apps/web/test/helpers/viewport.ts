// 画面幅の切り替え（matchMedia の min-width だけを評価する簡易版）
export function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const m = /min-width:\s*(\d+)px/.exec(query);
    const matches = m ? width >= Number(m[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  }) as typeof window.matchMedia;
}

export function resetViewport() {
  // @ts-expect-error テストの後に元へ戻す（jsdom には matchMedia がない）
  delete window.matchMedia;
}
