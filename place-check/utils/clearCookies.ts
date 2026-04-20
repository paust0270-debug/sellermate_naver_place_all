/**
 * 검색 완료 후 쿠키·캐시 초기화 (봇 감지 우회)
 * puppeteer-real-browser page 객체 사용
 */
export async function clearCookiesAndCache(page: {
  cookies?: () => Promise<{ name: string; value: string; domain?: string; path?: string }[]>;
  deleteCookie?: (...args: unknown[]) => Promise<void>;
  evaluate?: (fn: () => void) => Promise<void>;
}): Promise<void> {
  try {
    // 쿠키 삭제
    if (typeof page.cookies === 'function' && typeof page.deleteCookie === 'function') {
      const cookies = await page.cookies();
      if (cookies.length > 0) {
        await page.deleteCookie(...cookies);
        console.log('🧹 쿠키 삭제 완료');
      }
    }
    // localStorage / sessionStorage 초기화
    if (typeof page.evaluate === 'function') {
      await page.evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {
          // ignore
        }
      });
      console.log('🧹 캐시(localStorage/sessionStorage) 삭제 완료');
    }
  } catch (err: unknown) {
    console.warn('⚠️ 쿠키·캐시 초기화 실패:', (err as Error)?.message || err);
  }
}
