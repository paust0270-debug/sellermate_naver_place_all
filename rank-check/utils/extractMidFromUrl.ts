/**
 * 네이버 쇼핑 상품 URL에서 MID(상품 ID)를 추출하는 유틸 함수
 *
 * 지원하는 URL 패턴:
 * 1. 쿼리 파라미터: ?mid=... 또는 ?nvMid=... (모든 도메인)
 * 2. 스마트스토어: https://smartstore.naver.com/{storeId}/products/{MID}
 * 3. 브릿지 링크: https://cr3.shopping.naver.com/v2/bridge?nvMid={MID}
 * 4. 쇼핑 검색: https://search.shopping.naver.com/catalog/{MID}
 * 5. 모바일: https://m.shopping.naver.com/...
 * 6. Fallback: 경로에서 10자리 이상 숫자 추출
 *
 * @param url - 네이버 쇼핑 상품 URL (쿼리 파라미터 포함 가능)
 * @returns MID(숫자 문자열) 또는 null
 */
/** URL 쿼리의 nv_mid / nvMid 만 (스마트스토어 /products/ 숫자는 제외) */
export function extractNvMidFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const nvMidUnderscore = urlObj.searchParams.get('nv_mid');
    if (nvMidUnderscore) return nvMidUnderscore;
    const nvMid = urlObj.searchParams.get('nvMid');
    if (nvMid) return nvMid;
    const nvMidMatch = url.match(/[?&]nv_mid=(\d+)/i);
    if (nvMidMatch) return nvMidMatch[1];
    return null;
  } catch {
    return null;
  }
}

export function extractMidFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // 패턴 1: 쿼리 파라미터 우선 체크 (모든 도메인)
    const mid = urlObj.searchParams.get('mid');
    if (mid) return mid;

    const nvMidUnderscore = urlObj.searchParams.get('nv_mid');
    if (nvMidUnderscore) return nvMidUnderscore;

    const nvMid = urlObj.searchParams.get('nvMid');
    if (nvMid) return nvMid;

    // searchGate 등: query string에 nv_mid= 가 있는 경우
    const nvMidMatch = url.match(/[?&]nv_mid=(\d+)/i);
    if (nvMidMatch) return nvMidMatch[1];

    // 패턴 2: smartstore.naver.com/*/products/{MID}
    if (urlObj.hostname.includes('smartstore.naver.com')) {
      const match = urlObj.pathname.match(/\/products\/(\d+)/);
      return match ? match[1] : null;
    }

    // 패턴 3: search.shopping.naver.com/catalog/{MID}
    if (urlObj.hostname.includes('shopping.naver.com')) {
      const match = urlObj.pathname.match(/\/catalog\/(\d+)/);
      if (match) return match[1];
    }

    // 패턴 4: Fallback - 경로에서 10자리 이상 숫자 추출
    const pathMatch = urlObj.pathname.match(/\/(\d{10,})/);
    if (pathMatch) return pathMatch[1];

    return null;
  } catch {
    return null;
  }
}

/**
 * URL에서 MID를 추출하고 결과를 콘솔에 출력하는 테스트 함수
 */
export function testExtractMid(url: string): void {
  console.log(`\nURL: ${url}`);
  const mid = extractMidFromUrl(url);
  if (mid) {
    console.log(`✅ MID: ${mid}`);
  } else {
    console.log(`❌ MID를 추출할 수 없습니다`);
  }
}
