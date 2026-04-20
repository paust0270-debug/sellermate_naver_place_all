/**
 * 테스트: "키워드+더보기" 클릭 → list 페이지(restaurant/list)에서 상위 20개 추출 → 각 상점 상세페이지 방문
 * ⚠️ 인라인 검색결과가 아닌 list 페이지에서만 추출
 */
import 'dotenv/config';
import { connect } from 'puppeteer-real-browser';
import { humanScroll, humanClickWithWander, injectEvaluatePolyfill } from './utils/humanBehavior.js';

const KEYWORD = '강남맛집';
const MAX_ITEMS = 20;
const getListUrl = (q: string) =>
  `https://m.place.naver.com/restaurant/list?query=${encodeURIComponent(q)}&x=126.9783882&y=37.5666103&level=top&entry=pll`;

const CLEAN_NAME_REGEX = /(영업\s|리뷰\s*[\d,]+|서울\s*강남구|상세주소\s*열기|육류,고기요리|카페,디저트|한식|중식|일식|양식|24시간\s*영업|새로오픈|저장|예약|톡톡|쿠폰|네이버페이|주문|배달).*$/gi;
const CATEGORY_PATTERN = '육류,고기요리|요리주점|일식당|중식당|한식|양식|카페,디저트|냉면|장어,먹장어요리|버섯칼국수';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function clickExpandMore(page: any): Promise<boolean> {
  const rect = await page.evaluate(() => {
    const btn = document.querySelector('a.FtXwJ[role="button"]');
    if (!btn || !(btn.textContent || '').includes('펼쳐서 더보기')) return null;
    (btn as HTMLElement).scrollIntoView({ block: 'center', behavior: 'auto' });
    const r = (btn as HTMLElement).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!rect) return false;
  await humanClickWithWander(page, rect.x, rect.y);
  await delay(2000);
  return true;
}

/**
 * "키워드+더보기" 클릭 → list 페이지 이동
 * 구조: div.M7vfr > a.cf8PL > span.UPDKY(키워드) + span.Zrelp(더보기)
 * href는 /p/crd/rd 리다이렉트, cru 속성에 실제 list URL
 */
async function goToListPage(page: any, keyword: string): Promise<boolean> {
  console.log(`📍 "${keyword} 더보기" 클릭 → list 페이지 진입 시도...`);
  let linkRect: { x: number; y: number } | null = null;
  try {
    linkRect = await page.evaluate((kw: string) => {
      const isNewOpen = (href: string, cru: string) =>
        /filterOpening/i.test(href || '') || /filterOpening/i.test(cru || '');

      // 1) cru 속성으로 list 링크 (가장 정확)
      const byCru = document.querySelector('a.cf8PL[cru*="restaurant/list"]');
      if (byCru) {
        const a = byCru as HTMLAnchorElement;
        if (!isNewOpen(a.href || '', a.getAttribute('cru') || '')) {
          byCru.scrollIntoView({ block: 'center', behavior: 'auto' });
          const r = byCru.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }

      // 2) div.M7vfr > a.cf8PL (UPDKY=키워드, Zrelp=더보기)
      const links = document.querySelectorAll('a.cf8PL, a[class*="cf8PL"]');
      for (const link of links) {
        const a = link as HTMLAnchorElement;
        if (isNewOpen(a.href || '', a.getAttribute('cru') || '')) continue;
        const updky = link.querySelector('.UPDKY');
        const updkyText = (updky && (updky as HTMLElement).textContent) || '';
        const hasMore = (link.textContent || '').includes('더보기');
        if (hasMore && (updkyText.includes(kw) || (link.textContent || '').includes(kw))) {
          link.scrollIntoView({ block: 'center', behavior: 'auto' });
          const r = link.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    }, keyword);
  } catch (e) {
    console.log('   ⚠️ evaluate 오류 → list URL 직접 이동');
  }

  if (linkRect) {
    const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
    await humanClickWithWander(page, linkRect.x, linkRect.y);
    await navPromise;
    await delay(3000);
    const url = page.url();
    if (url.includes('restaurant/list') && !/filterOpening/i.test(url)) {
      console.log('   ✅ list 페이지 진입');
      return true;
    }
  }

  console.log('   📂 list URL 직접 이동');
  try {
    const listUrl = getListUrl(keyword);
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(5000);
    const finalUrl = page.url();
    const ok = finalUrl.includes('restaurant/list');
    if (!ok) console.log(`   ⚠️ 최종 URL: ${finalUrl}`);
    return ok;
  } catch (e) {
    console.log('   ⚠️ goto 실패:', (e as Error).message);
    return false;
  }
}

interface ListItem {
  rank: number;
  placeId: string;
  placeName: string;
  category: string | null;
}

/** restaurant/list 페이지에서 추출 (새로오픈 매장 제외) */
async function extractListItemsFromListPage(page: any, maxItems: number): Promise<ListItem[]> {
  return page.evaluate(
    (max: number, cleanRegex: string, catPat: string) => {
      const re = new RegExp(cleanRegex, 'gi');
      const catRe = new RegExp(catPat);
      const newOpenRe = /새로\s*오픈|새로오픈/i;
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/restaurant/"]'));
      const seen = new Set<string>();
      const items: ListItem[] = [];
      for (const a of links) {
        const href = a.href || '';
        const idMatch = href.match(/\/restaurant\/(\d+)/);
        if (!idMatch || seen.has(idMatch[1])) continue;
        const item = a.closest('li') || a.closest('[class*="item"]') || a.parentElement?.parentElement || a;
        const fullText = (item?.textContent || a.textContent || '').trim();
        if (newOpenRe.test(fullText)) {
          seen.add(idMatch[1]);
          continue;
        }
        seen.add(idMatch[1]);
        const nameEl = a.querySelector('.TYaxT, [class*="place_name"]') || item?.querySelector('.TYaxT, [class*="place_name"]');
        let name = (nameEl?.textContent || item?.querySelector('span, div, strong')?.textContent || a.textContent || '').trim().replace(re, '').trim();
        if (!name) {
          const full = (item?.textContent || a.textContent || '').trim();
          const cm = full.match(catRe);
          name = cm ? full.slice(0, full.indexOf(cm[0])).trim() : full.split(/리뷰|영업|저장/)[0].trim();
        }
        const catEl = a.querySelector('.KCMnt') || item?.querySelector('.KCMnt');
        let category = (catEl?.textContent || '').trim() || null;
        if (!category) {
          const cm = (item?.textContent || a.textContent || '').match(catRe);
          category = cm ? cm[0] : null;
        }
        items.push({
          rank: items.length + 1,
          placeId: idMatch[1],
          placeName: name.slice(0, 80) || '알 수 없음',
          category,
        });
        if (items.length >= max) break;
      }
      return items;
    },
    maxItems,
    CLEAN_NAME_REGEX.source,
    CATEGORY_PATTERN
  );
}

async function extractFromDetailPage(page: any, placeId: string): Promise<{
  placeName: string | null;
  starRating: number | null;
  visitorReviewCount: number | null;
  blogReviewCount: number | null;
}> {
  try {
    await page.goto(`https://m.place.naver.com/restaurant/${placeId}/home`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await delay(2000);

    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    const visitor = bodyText.match(/방문자\s*리뷰\s*([\d,]+)/)?.[1]?.replace(/,/g, '');
    const blog = bodyText.match(/블로그\s*리뷰\s*([\d,]+)/)?.[1]?.replace(/,/g, '');
    let starMatch = bodyText.match(/별점\s*([\d.]+)/);
    let starRating: number | null = starMatch ? parseFloat(starMatch[1]) : null;
    if (starRating == null) {
      const fromEl = await page.evaluate(() => {
        const el = document.querySelector('.h69bs.orXYY, span.h69bs, [class*="h69bs"]');
        const m = (el?.textContent || '').trim().match(/([\d.]+)/);
        return m ? m[1] : null;
      });
      starRating = fromEl ? parseFloat(fromEl) : null;
    }
    if (starRating != null && (starRating < 0 || starRating > 5)) starRating = null;

    // 상점명: 상세페이지에서 추출 (list에서 미추출 시 보완)
    let placeName: string | null = await page.evaluate(() => {
      const fromTitle = (t: string) => {
        const m = t.match(/^(.+?)\s*[-–:]\s*네이버/);
        return m ? m[1].trim() : null;
      };
      let n = fromTitle(document.title || '');
      if (n) return n.slice(0, 80);
      const sel = document.querySelector('.FKA1U, .TYaxT, [class*="place_name"], .place_section_content h1, .place_section_content strong');
      n = (sel?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      return n || null;
    });

    return {
      placeName,
      starRating,
      visitorReviewCount: visitor ? parseInt(visitor, 10) : null,
      blogReviewCount: blog ? parseInt(blog, 10) : null,
    };
  } catch {
    return { placeName: null, starRating: null, visitorReviewCount: null, blogReviewCount: null };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  테스트: 키워드+더보기 → list 페이지에서 상위 20개 추출');
  console.log('  URL: restaurant/list?query=... (인라인 아님)');
  console.log('═══════════════════════════════════════════════════════\n');

  const { page, browser } = await connect({ headless: false, turnstile: true });
  await page.setViewport({ width: 1280, height: 900 });
  await injectEvaluatePolyfill(page);

  try {
    // 1. 검색
    console.log(`🔍 "${KEYWORD}" 검색 중...`);
    await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KEYWORD)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await delay(2500);
    await humanScroll(page, 200);
    await delay(800);

    // 2. "펼쳐서 더보기" 클릭 (키워드+더보기 링크 노출용)
    console.log('📂 "펼쳐서 더보기" 클릭...');
    await clickExpandMore(page);
    await delay(2000);

    // 3. "키워드+더보기" 클릭 → list 페이지 진입
    const listOk = await goToListPage(page, KEYWORD);
    if (!listOk) {
      console.log('❌ list 페이지 진입 실패');
      return;
    }

    // 4. list 페이지 로딩 대기
    try {
      await page.waitForSelector('a[href*="/restaurant/"]', { timeout: 15000 });
    } catch {
      console.log('   ⚠️ restaurant 링크 대기 시간 초과');
    }
    await delay(3000);
    for (let s = 0; s < 3; s++) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await delay(500);
    }
    await delay(1000);

    // 5. list 페이지에서 20개 추출 (새로오픈 제외)
    console.log(`\n📋 list 페이지에서 ${MAX_ITEMS}개 항목 추출 (새로오픈 제외)...`);
    const items = await extractListItemsFromListPage(page, MAX_ITEMS);
    console.log(`   ✅ ${items.length}개 추출\n`);

    // 6. 각 상점 상세페이지 방문하여 별점/리뷰수 추출
    const results: (ListItem & { starRating: number | null; visitorReviewCount: number | null; blogReviewCount: number | null })[] = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      console.log(`[${i + 1}/${items.length}] ${it.placeName} (${it.placeId}) 상세페이지 방문 중...`);
      const detail = await extractFromDetailPage(page, it.placeId);
      const finalName = it.placeName !== '알 수 없음' ? it.placeName : (detail.placeName || it.placeName);
      results.push({
        ...it,
        placeName: finalName,
        starRating: detail.starRating,
        visitorReviewCount: detail.visitorReviewCount,
        blogReviewCount: detail.blogReviewCount,
      });
      console.log(`   별점: ${detail.starRating ?? '-'} | 방문자: ${detail.visitorReviewCount?.toLocaleString() ?? '-'} | 블로그: ${detail.blogReviewCount?.toLocaleString() ?? '-'}`);
      if (i < items.length - 1) {
        await delay(1500 + Math.random() * 1000);
      }
    }

    // 7. 최종 결과 출력
    console.log('\n' + '─'.repeat(80));
    console.log('📊 최종 결과\n');
    for (const r of results) {
      console.log(`[${r.rank}] ${r.placeName}`);
      console.log(`    카테고리: ${r.category ?? '-'} | 별점: ${r.starRating ?? '-'} | 방문자리뷰: ${r.visitorReviewCount?.toLocaleString() ?? '-'} | 블로그리뷰: ${r.blogReviewCount?.toLocaleString() ?? '-'}`);
    }

    const withStar = results.filter((r) => r.starRating != null).length;
    const withVisitor = results.filter((r) => r.visitorReviewCount != null).length;
    const withBlog = results.filter((r) => r.blogReviewCount != null).length;
    console.log('\n' + '─'.repeat(80));
    console.log('📈 요약:');
    console.log(`   상점명: ${results.length}/${MAX_ITEMS}`);
    console.log(`   별점: ${withStar}/${MAX_ITEMS}`);
    console.log(`   방문자리뷰: ${withVisitor}/${MAX_ITEMS}`);
    console.log(`   블로그리뷰: ${withBlog}/${MAX_ITEMS}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
