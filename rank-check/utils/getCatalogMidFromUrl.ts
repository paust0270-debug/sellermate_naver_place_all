import { ReceiptCaptchaSolver } from './ReceiptCaptchaSolver';

// 캡챠 솔버 인스턴스 (재사용)
let captchaSolver: ReceiptCaptchaSolver | null = null;

function getCaptchaSolver(): ReceiptCaptchaSolver {
  if (!captchaSolver) {
    captchaSolver = new ReceiptCaptchaSolver();
  }
  return captchaSolver;
}

/**
 * 캡챠 감지 및 해결
 */
async function detectAndSolveCaptcha(page: any): Promise<boolean> {
  const pageContent = await page.evaluate(() => document.body.innerText || "");
  const pageTitle = await page.title();

  const hasCaptcha =
    pageContent.includes("보안 확인") ||
    pageContent.includes("영수증") ||
    pageTitle.includes("보안") ||
    pageTitle.includes("확인");

  if (!hasCaptcha) {
    return false; // 캡챠 없음
  }

  console.log(`🛑 캡챠 감지됨 - 해결 시도 중...`);

  const solver = getCaptchaSolver();
  const solved = await solver.solve(page);

  if (solved) {
    console.log(`✅ 캡챠 해결 성공!`);
    await new Promise(r => setTimeout(r, 2000));
    return true;
  } else {
    console.log(`❌ 캡챠 해결 실패`);
    return false;
  }
}

export interface CatalogMidResult {
  mid: string | null;
  captchaFailed: boolean;
}

/**
 * 스마트스토어 URL에서 실제 Catalog MID(nvMid)를 추출
 *
 * 스마트스토어 상품 페이지를 방문하여 네이버 카탈로그 MID를 추출합니다.
 * 이 MID가 검색 결과에서 사용되는 실제 ID입니다.
 *
 * @param page - Puppeteer Page 객체
 * @param productUrl - 스마트스토어 상품 URL
 * @returns Catalog MID 결과 (mid, captchaFailed)
 */
export async function getCatalogMidFromUrl(
  page: any,
  productUrl: string
): Promise<CatalogMidResult> {
  let captchaFailed = false;

  try {
    console.log(`📦 상품 페이지 방문: ${productUrl.substring(0, 80)}...`);

    // API 요청/응답 인터셉트 설정
    let catalogMid: string | null = null;

    // request에서 nvMid 찾기
    const requestHandler = (request: any) => {
      const url = request.url();
      // nvMid 파라미터 (10자리 이상)
      let match = url.match(/[?&]nvMid=(\d{10,})/);
      if (match && !catalogMid) {
        catalogMid = match[1];
        return;
      }
      // productId 파라미터
      match = url.match(/[?&]productId=(\d{10,})/);
      if (match && !catalogMid) {
        catalogMid = match[1];
        return;
      }
      // catalog URL 패턴
      match = url.match(/\/catalog\/(\d{10,})/);
      if (match && !catalogMid) {
        catalogMid = match[1];
      }
    };

    // response에서도 nvMid 찾기
    const responseHandler = (response: any) => {
      const url = response.url();
      const match = url.match(/[?&]nvMid=(\d{10,})/);
      if (match && !catalogMid) {
        catalogMid = match[1];
      }
    };

    page.on('request', requestHandler);
    page.on('response', responseHandler);

    // 상품 페이지로 이동 (domcontentloaded - Puppeteer/Playwright 호환)
    await page.goto(productUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    // 추가 대기 (느린 네트워크 대응)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 캡챠 감지 및 해결
    const pageContent = await page.evaluate(() => document.body.innerText || "");
    const pageTitle = await page.title();
    const hasCaptcha =
      pageContent.includes("보안 확인") ||
      pageContent.includes("영수증") ||
      pageTitle.includes("보안") ||
      pageTitle.includes("확인");

    if (hasCaptcha) {
      const captchaSolved = await detectAndSolveCaptcha(page);
      if (captchaSolved) {
        // 캡챠 해결 후 페이지 새로고침
        console.log(`🔄 페이지 새로고침 중...`);
        await page.goto(productUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        // 캡챠 해결 실패
        captchaFailed = true;
        console.log(`🛑 캡챠 해결 실패 - 재시도 큐로 이동 예정`);
      }
    }

    // 스크롤하여 추가 API 트리거
    await page.evaluate(() => window.scrollBy(0, 500));
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 리스너 제거
    page.off('request', requestHandler);
    page.off('response', responseHandler);

    if (catalogMid) {
      console.log(`✅ API 요청에서 Catalog MID 추출: ${catalogMid}`);
      return { mid: catalogMid, captchaFailed };
    }

    // 대체 방법 1: URL에서 리다이렉트된 catalog MID 확인
    const currentUrl = page.url();
    if (currentUrl.includes("/catalog/")) {
      const match = currentUrl.match(/\/catalog\/(\d+)/);
      if (match) {
        console.log(`✅ 리다이렉트 URL에서 MID 추출: ${match[1]}`);
        return { mid: match[1], captchaFailed };
      }
    }

    // 대체 방법 2: 페이지 소스에서 nvMid 검색 (여러 패턴 시도)
    const sourceMid = await page.evaluate(() => {
      const html = document.documentElement.outerHTML;

      // 패턴 1: nvMid 파라미터
      let match = html.match(/nvMid["\s:=]+(\d{10,})/);
      if (match) return match[1];

      // 패턴 2: catalogId
      match = html.match(/catalogId["\s:=]+(\d{10,})/);
      if (match) return match[1];

      // 패턴 3: productId (네이버 쇼핑용)
      match = html.match(/"productId"\s*:\s*"?(\d{10,})"?/);
      if (match) return match[1];

      // 패턴 4: channelProductNo와 연관된 nvMid
      match = html.match(/nvMid[=:](\d{10,})/);
      if (match) return match[1];

      return null;
    });

    if (sourceMid) {
      console.log(`✅ 페이지 소스에서 MID 추출: ${sourceMid}`);
      return { mid: sourceMid, captchaFailed };
    }

    // 대체 방법 3: 네이버 쇼핑 연동 API에서 추출 (스크립트 태그)
    const scriptMid = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const content = script.textContent || '';
        // __PRELOADED_STATE__ 또는 window.__INITIAL_STATE__ 에서 찾기
        const match = content.match(/(?:nvMid|catalogNo|productId)["\s:=]+["']?(\d{10,})["']?/);
        if (match) return match[1];
      }
      return null;
    });

    if (scriptMid) {
      console.log(`✅ 스크립트에서 MID 추출: ${scriptMid}`);
      return { mid: scriptMid, captchaFailed };
    }

    // 대체 방법 4: meta 태그에서 추출
    const metaMid = await page.evaluate(() => {
      // og:url에서 catalog ID 추출
      const ogUrl = document.querySelector('meta[property="og:url"]');
      if (ogUrl) {
        const content = ogUrl.getAttribute('content') || '';
        const match = content.match(/catalog\/(\d+)/);
        if (match) return match[1];
      }
      return null;
    });

    if (metaMid) {
      console.log(`✅ 메타 태그에서 MID 추출: ${metaMid}`);
      return { mid: metaMid, captchaFailed };
    }

    // 디버깅: 실제 로드된 페이지 정보 출력
    const debugTitle = await page.title();
    const finalUrl = page.url();
    console.log(`⚠️ Catalog MID를 찾을 수 없습니다`);
    console.log(`   📍 최종 URL: ${finalUrl.substring(0, 100)}...`);
    console.log(`   📄 페이지 제목: ${debugTitle}`);

    // 차단 페이지 감지
    if (debugTitle.includes('보안') || debugTitle.includes('확인') ||
        finalUrl.includes('captcha') || finalUrl.includes('security')) {
      console.log(`   🛑 차단/보안 페이지 감지됨!`);
      captchaFailed = true;
    }

    return { mid: null, captchaFailed };
  } catch (error: any) {
    console.error(`❌ Catalog MID 추출 실패: ${error.message}`);
    return { mid: null, captchaFailed };
  }
}

/**
 * 스마트스토어 URL인지 확인
 */
export function isSmartStoreUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes("smartstore.naver.com");
  } catch {
    return false;
  }
}
