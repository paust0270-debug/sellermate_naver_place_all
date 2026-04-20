/**
 * 카탈로그 URL에서 상품명(풀네임)을 추출
 *
 * API 방식 사용 (브라우저 불필요, 캡챠 없음)
 *
 * @param catalogUrl - 네이버 쇼핑 카탈로그 URL
 * @returns 상품명 풀네임 또는 null
 *
 * @example
 * const productName = await getProductNameFromUrl(
 *   "https://search.shopping.naver.com/catalog/56629990514?query=장난감"
 * );
 * // "레고 프렌즈 하트레이크시티 미아의 동물구조센터 41727 블록..."
 */
export async function getProductNameFromUrl(catalogUrl: string): Promise<string | null> {
  try {
    // HTTP 요청 (fetch 사용)
    const response = await fetch(catalogUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://search.naver.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      console.log(`⚠️ HTTP ${response.status}: ${catalogUrl}`);
      return null;
    }

    const html = await response.text();

    // 방법 1: og:title meta 태그에서 추출
    const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
    if (ogTitleMatch) {
      const productName = ogTitleMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      return productName;
    }

    // 방법 2: title 태그에서 추출
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      // " : 네이버 쇼핑" 제거
      const productName = title.replace(/\s*:\s*네이버.*$/, '').trim();
      if (productName && productName.length > 3) {
        return productName;
      }
    }

    // 방법 3: JSON-LD 스크립트에서 추출
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);
    if (jsonLdMatch) {
      try {
        const jsonData = JSON.parse(jsonLdMatch[1]);
        if (jsonData.name) {
          return jsonData.name.trim();
        }
      } catch (e) {
        // JSON 파싱 실패 무시
      }
    }

    console.log('⚠️ 상품명을 찾을 수 없습니다');
    return null;

  } catch (error: any) {
    console.error(`❌ 상품명 추출 실패: ${error.message}`);
    return null;
  }
}

/**
 * 테스트 함수
 */
export async function testGetProductName(catalogUrl: string): Promise<void> {
  console.log(`\n📦 상품명 추출 테스트`);
  console.log(`URL: ${catalogUrl.substring(0, 80)}...`);

  const productName = await getProductNameFromUrl(catalogUrl);

  if (productName) {
    console.log(`✅ 상품명: ${productName}`);
  } else {
    console.log(`❌ 상품명 추출 실패`);
  }
}
