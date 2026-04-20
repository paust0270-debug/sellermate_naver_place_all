/**
 * 네이버 플레이스 순위 체크 (모바일)
 *
 * 지원 URL:
 * - naver.me/xxx (단축 URL) → fetch로 리다이렉트 해석
 * - m.place.naver.com/restaurant/xxx/home (직접 URL)
 *
 * 흐름:
 * 1. URL에서 placeId 추출 (페이지 방문 없음)
 * 2. m.naver.com 접속 → 키워드 검색
 * 3. 200등 내에서 순위 검색
 * 4. 없으면 "펼쳐서 더보기" 클릭 → 재검색
 * 5. 여전히 없으면 "키워드+더보기" 클릭 → m.place.naver.com/restaurant/list 페이지에서 검색
 *
 * 봇우회: humanBehavior (humanType, humanScroll, humanClickWithWander) 참조
 */

import { connect } from 'puppeteer-real-browser';
import { humanScroll, humanType, humanClickWithWander, injectEvaluatePolyfill } from './utils/humanBehavior.js';

const DEFAULT_KEYWORD = '강남맛집';
// naver.me 또는 m.place.naver.com/restaurant/xxx 형식
// 미르차이9 (placeId: 2073971384) - 강남맛집 하위 순위
const TARGET_URL = 'https://m.place.naver.com/restaurant/2073971384/home?entry=pll&n_query=%EA%B0%95%EB%82%A8%EB%A7%9B%EC%A7%91';

/** URL에서 n_query 또는 bk_query 추출, 없으면 DEFAULT_KEYWORD */
function getKeywordFromUrl(url: string): string {
  try {
    const m = url.match(/(?:n_query|bk_query)=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch {}
  return DEFAULT_KEYWORD;
}

/** 제목에서 리뷰/주소/영업/카테고리 등 제거 → 장소명만 (evaluate 내부에서 사용할 정규식) */
const CLEAN_NAME_REGEX = /(영업\s|리뷰\s*[\d,]+|서울\s*강남구|상세주소\s*열기|육류,고기요리|카페,디저트|한식|중식|일식|양식|24시간\s*영업|TV전지적참견시점|새로오픈|저장|예약|톡톡|쿠폰|네이버페이|주문|배달).*$/gi;

const SAFE_DELAY_MS = 2000;
const MAX_RANK_INLINE = 200; // 인라인 리스트에서 검색할 최대 순위
const MAX_RANK_LIST = 150; // list 페이지에서 찾을 최대 순위 (150등까지 스크롤)

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * URL에서 placeId 추출 (페이지 방문 없음)
 * - m.place.naver.com/restaurant/xxx: URL에서 직접 추출
 * - naver.me: fetch로 리다이렉트 따라가서 최종 URL에서 추출
 */
async function parsePlaceIdFromUrl(targetUrl: string): Promise<string | null> {
  if (targetUrl.includes('/restaurant/') || targetUrl.includes('/place/')) {
    const m = targetUrl.match(/\/restaurant\/(\d+)/) || targetUrl.match(/\/place\/(\d+)/);
    return m ? m[1] : null;
  }
  if (targetUrl.startsWith('https://naver.me/') || targetUrl.startsWith('http://naver.me/')) {
    try {
      const res = await fetch(targetUrl, { redirect: 'follow' });
      const finalUrl = res.url;
      const m = finalUrl.match(/\/restaurant\/(\d+)/) || finalUrl.match(/\/place\/(\d+)/) || finalUrl.match(/\/entry\/place\/(\d+)/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * m.search.naver.com으로 키워드 검색 (검색창 우회 - 직접 URL 이동)
 */
async function searchOnMobile(page: any, keyword: string): Promise<boolean> {
  console.log(`🧭 "${keyword}" 검색 (m.search.naver.com)`);
  try {
    const searchUrl = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  } catch (error) {
    console.log('⚠️ 검색 페이지 진입 실패', error);
    return false;
  }

  await delay(2500 + Math.random() * 1500);
  await humanScroll(page, 150 + Math.random() * 100);
  await delay(800);

  const url = page.url();
  if (!url.includes('naver.com')) {
    console.log('⚠️ 검색 결과 페이지 아님');
    return false;
  }

  console.log('✅ 검색 완료');
  return true;
}

/**
 * 모바일 리스트에서 순위 검색 (200등 내)
 */
async function findPlaceRankInMobileList(
  page: any,
  placeId: string | null,
  targetPlaceName: string | null,
  maxRank: number
): Promise<{ rank: number | null; placeName: string | null; listPreview: string[] }> {
  console.log(`🔍 플레이스 리스트에서 순위 검색 중 (상위 ${maxRank}위)...`);

  await delay(1500);

  // 스크롤 2~3번으로 버튼/리스트 노출 (과도한 스크롤 제거)
  for (let s = 0; s < 3; s++) {
    await page.evaluate(() => window.scrollBy(0, 400));
    await delay(300);
  }
  await delay(500);

  const searchNames = targetPlaceName ? [targetPlaceName, targetPlaceName.replace(/\s+/g, '')] : [];

  const result = await page.evaluate(
    (targetId: string | null, namesToMatch: string[], max: number, cleanRegex: string) => {
      const re = new RegExp(cleanRegex, 'gi');
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/restaurant/"], a[href*="place.naver.com"]'));
      const seen = new Set<string>();
      const items: { el: Element; id: string; name: string }[] = [];

      for (const a of links) {
        const href = a.href || '';
        const idMatch = href.match(/\/restaurant\/(\d+)/) || href.match(/\/place\/(\d+)/);
        if (!idMatch || seen.has(idMatch[1])) continue;
        seen.add(idMatch[1]);

        const item = a.closest('li') || a.closest('[class*="item"]') || a.parentElement?.parentElement || a;
        const nameEl = item?.querySelector('span, div, strong') || a;
        let name = (nameEl?.textContent || a.textContent || '').trim();
        name = name.replace(re, '').trim();
        if (name.length > 50) name = name.slice(0, 50);

        items.push({ el: item || a, id: idMatch[1], name });
        if (items.length >= max) break;
      }

      const listPreview: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const { id, name } = items[i];
        if (name) listPreview.push(`${i + 1}. ${name}`);

        let matched = false;
        if (targetId && id === targetId) matched = true;
        if (!matched && name && namesToMatch.length) {
          const n = name.replace(/\s+/g, '').toLowerCase();
          for (const t of namesToMatch) {
            const tn = t.replace(/\s+/g, '').toLowerCase();
            if (tn && (n.includes(tn) || tn.includes(n))) {
              matched = true;
              break;
            }
          }
        }

        if (matched) {
          return { rank: i + 1, placeName: name || '알 수 없음', listPreview: listPreview.slice(0, 50) };
        }
      }

      return { rank: null, placeName: null, listPreview: listPreview.slice(0, 50) };
    },
    placeId,
    searchNames,
    maxRank,
    CLEAN_NAME_REGEX.source
  );

  return result;
}

/**
 * "펼쳐서 더보기" 클릭
 * 구조: div.iLepm.UoLNU > a.FtXwJ[role="button"] > span.PNozS
 */
async function clickExpandMore(page: any): Promise<boolean> {
  console.log('📍 "펼쳐서 더보기" 클릭');
  const rect = await page.evaluate(() => {
    const btn = document.querySelector('a.FtXwJ[role="button"]');
    if (!btn || !(btn.textContent || '').includes('펼쳐서 더보기')) return null;
    (btn as HTMLElement).scrollIntoView({ block: 'center', behavior: 'auto' });
    const r = (btn as HTMLElement).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!rect) {
    console.log('   ⚠️ "펼쳐서 더보기" 버튼 없음');
    return false;
  }
  await humanClickWithWander(page, rect.x, rect.y);
  await delay(2000);
  return true;
}

/**
 * "키워드+더보기" 클릭 → 일반 검색 결과 list 페이지
 * 구조: div.M7vfr > a.cf8PL > span.UPDKY(키워드) + span.Zrelp(더보기), cru 속성에 list URL
 * ⚠️ "새로 오픈했어요" 섹션의 더보기(filterOpening)는 제외
 */
async function clickKeywordMore(page: any, keyword: string): Promise<boolean> {
  console.log(`📍 "${keyword} 더보기" 클릭 (일반 목록만, 새로오픈 필터 제외)`);
  let linkRect: { x: number; y: number } | null = null;
  try {
    linkRect = await page.evaluate((kw: string) => {
      const isNewOpen = (href: string, cru: string) =>
        /filterOpening|keywordFilter[^=]*=.*filterOpening/i.test(href || '') || /filterOpening/i.test(cru || '');

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
      const all = document.querySelectorAll('a[href*="restaurant/list"], a[href*="place.naver.com"][href*="list"]');
      for (const el of all) {
        const a = el as HTMLAnchorElement;
        if (isNewOpen(a.href || '', a.getAttribute('cru') || '')) continue;
        if ((el.textContent || '').includes('더보기')) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    }, keyword);
  } catch (e) {
    console.log('   ⚠️ evaluate 오류 → list URL 직접 이동:', (e as Error).message);
  }

  if (linkRect) {
    const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
    await humanClickWithWander(page, linkRect.x, linkRect.y);
    await navPromise;
    await delay(SAFE_DELAY_MS);
    const url = page.url();
    if (url.includes('restaurant/list') && !/filterOpening|keywordFilter[^=]*=.*filterOpening/i.test(url)) {
      return true;
    }
  }

  console.log('   📂 키워드+더보기 링크 없음 → 일반 list URL 직접 이동');
  try {
    const listUrl = `https://m.place.naver.com/restaurant/list?query=${encodeURIComponent(keyword)}&x=126.9783882&y=37.5666103&level=top&entry=pll`;
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await delay(5000);
    return page.url().includes('restaurant/list');
  } catch {
    return false;
  }
}

/**
 * list 페이지에서 스크롤 수행
 * - scrollIntoView: 마지막 항목을 뷰포트로 → 브라우저가 자동으로 적절한 스크롤 수행 (컨테이너 무관)
 * - 키보드 Page Down: lazy load 트리거
 * - scrollTop 직접 증가: overflow 컨테이너 fallback
 */
async function scrollListPage(page: any): Promise<boolean> {
  const scrolled = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/restaurant/"]'));
    if (links.length === 0) return false;

    // 1) 마지막 링크 scrollIntoView → 브라우저가 알아서 스크롤 (ul/div/body 어떤 구조든 동작)
    const last = links[links.length - 1];
    const item = last.closest('li') || last.closest('[class*="item"]') || last.parentElement?.parentElement || last;
    (item || last).scrollIntoView({ block: 'end', behavior: 'auto' });
    return true;
  });

  if (scrolled) {
    await delay(800);
    return true;
  }
  return false;
}

/** 스크롤 보조: 키보드 Page Down (lazy load 트리거) */
async function scrollListPageByKeyboard(page: any): Promise<void> {
  await page.keyboard.press('PageDown');
  await delay(400);
  await page.keyboard.press('PageDown');
  await delay(400);
}

/**
 * m.place.naver.com/restaurant/list 페이지에서 순위 검색
 * 스크롤 내려가면서 찾기 (lazy load 대응)
 */
async function findPlaceRankInListPage(
  page: any,
  placeId: string | null,
  targetPlaceName: string | null
): Promise<{ rank: number | null; placeName: string | null; listPreview: string[] }> {
  console.log(`🔍 restaurant/list 페이지에서 순위 검색 중 (${MAX_RANK_LIST}등까지 스크롤)...`);

  // list 페이지 콘텐츠 로딩 대기
  try {
    await page.waitForSelector('a[href*="/restaurant/"]', { timeout: 15000 });
  } catch {
    console.log('   ⚠️ restaurant 링크 대기 시간 초과');
  }
  await delay(3000);

  const searchNames = targetPlaceName ? [targetPlaceName, targetPlaceName.replace(/\s+/g, '')] : [];
  const MAX_SCROLL_ROUNDS = 30; // 무한 스크롤 방지
  let noNewContentCount = 0;

  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    const result = await page.evaluate(
    (targetId: string | null, namesToMatch: string[], cleanRegex: string) => {
      const re = new RegExp(cleanRegex, 'gi');
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/restaurant/"]'));
      const seen = new Set<string>();
      const listPreview: string[] = [];
      let rank = 0;

      for (const a of links) {
        const href = a.href || '';
        const idMatch = href.match(/\/restaurant\/(\d+)/);
        if (!idMatch || seen.has(idMatch[1])) continue;
        seen.add(idMatch[1]);
        rank++;

        const item = a.closest('li') || a.closest('[class*="item"]') || a.parentElement?.parentElement || a;
        let name = (item?.querySelector('span, div, strong')?.textContent || a.textContent || '').trim();
        name = name.replace(re, '').trim();
        if (name) listPreview.push(`${rank}. ${name}`);

        let matched = false;
        if (targetId && idMatch[1] === targetId) matched = true;
        if (!matched && name && namesToMatch.length) {
          const n = name.replace(/\s+/g, '').toLowerCase();
          for (const t of namesToMatch) {
            const tn = t.replace(/\s+/g, '').toLowerCase();
            if (tn && (n.includes(tn) || tn.includes(n))) {
              matched = true;
              break;
            }
          }
        }

        if (matched) return { rank, placeName: name || '알 수 없음', listPreview: listPreview.slice(0, 50), itemCount: rank };
      }

      return { rank: null, placeName: null, listPreview: listPreview.slice(0, 50), itemCount: rank };
    },
    placeId,
    searchNames,
    CLEAN_NAME_REGEX.source
  );

    if (result.rank !== null) return { rank: result.rank, placeName: result.placeName, listPreview: result.listPreview };

    const prevCount = result.itemCount ?? 0;

    // 150등까지 검색 완료 → 종료 (지정 URL 못 찾음)
    if (prevCount >= MAX_RANK_LIST) {
      console.log(`📌 ${MAX_RANK_LIST}등까지 검색 완료, 대상 미발견`);
      break;
    }

    // 최소 3라운드는 무조건 스크롤 시도 (초기 "끝 도달" 오탐 방지)
    const minScrollRounds = 3;
    if (round >= minScrollRounds) {
      const scrollState = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/restaurant/"]');
        if (links.length === 0) return true;
        const last = links[links.length - 1];
        const scrollEl = last.closest('ul') || last.closest('[class*="list"]') || document.documentElement;
        const el = scrollEl as HTMLElement;
        const st = el === document.documentElement ? window.scrollY : el.scrollTop;
        const sh = el === document.documentElement ? document.documentElement.scrollHeight : el.scrollHeight;
        const ch = el === document.documentElement ? window.innerHeight : el.clientHeight;
        return st + ch >= sh - 20;
      });
      if (scrollState) {
        console.log('📌 리스트 끝 도달, 검색 종료');
        break;
      }
    }

    // scrollIntoView(마지막 항목) + 키보드 Page Down (lazy load 트리거)
    console.log(`   스크롤 시도 (라운드 ${round + 1}, 현재 ${prevCount}개 검색됨 → ${MAX_RANK_LIST}등까지)`);
    await scrollListPage(page);
    await scrollListPageByKeyboard(page);

    // 스크롤 후 항목 수: 늘어나지 않으면 카운트
    const afterCount = await page.evaluate(() => {
      const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/restaurant/"]');
      const seen = new Set<string>();
      links.forEach((a) => {
        const m = (a.href || '').match(/\/restaurant\/(\d+)/);
        if (m) seen.add(m[1]);
      });
      return seen.size;
    });
    if (afterCount <= prevCount) {
      noNewContentCount++;
      if (noNewContentCount >= 2) {
        console.log('📌 스크롤해도 새 항목 없음, 검색 종료');
        break;
      }
    } else {
      noNewContentCount = 0;
    }
  }

  return { rank: null, placeName: null, listPreview: [] };
}

/**
 * 장소 상세 페이지 접속 후 방문자 리뷰수, 블로그 리뷰수, 별점, 1번째 이미지 추출
 */
async function extractReviewsFromPlacePage(page: any, placeId: string): Promise<{
  visitorReviewCount: number | null;
  blogReviewCount: number | null;
  starRating: number | null;
  firstImageUrl: string | null;
}> {
  const placeUrl = `https://m.place.naver.com/restaurant/${placeId}/home`;
  try {
    await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await delay(2500);

    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    const visitor = bodyText.match(/방문자\s*리뷰\s*([\d,]+)/)?.[1]?.replace(/,/g, '');
    const blog = bodyText.match(/블로그\s*리뷰\s*([\d,]+)/)?.[1]?.replace(/,/g, '');
    const starMatch = bodyText.match(/별점\s*([\d.]+)/);
    let starRating: number | null = starMatch ? parseFloat(starMatch[1]) : null;
    if (starRating == null) {
      const fromEl = await page.evaluate(() => {
        const el = document.querySelector('.h69bs.orXYY, span.h69bs, [class*="h69bs"]');
        const text = el?.textContent?.trim() || '';
        const m = text.match(/([\d.]+)/);
        return m ? m[1] : null;
      });
      starRating = fromEl ? parseFloat(fromEl) : null;
    }

    const firstImageUrl = await page.evaluate(() => {
      const img = document.querySelector('a.place_thumb img, .place_thumb.QX0J7 img, #_autoPlayable img') as HTMLImageElement | null;
      return img?.src || null;
    });

    return {
      visitorReviewCount: visitor ? parseInt(visitor, 10) : null,
      blogReviewCount: blog ? parseInt(blog, 10) : null,
      starRating: starRating != null && starRating >= 0 && starRating <= 5 ? starRating : null,
      firstImageUrl,
    };
  } catch (e) {
    console.log('   ⚠️ 장소 페이지 접속/추출 실패:', e);
    return { visitorReviewCount: null, blogReviewCount: null, starRating: null, firstImageUrl: null };
  }
}

async function main() {
  const KEYWORD = getKeywordFromUrl(TARGET_URL);
  console.log('═══════════════════════════════════════');
  console.log('  네이버 플레이스 순위 체크 (모바일)');
  console.log('  키워드:', KEYWORD);
  console.log('  대상:', TARGET_URL);
  console.log('═══════════════════════════════════════\n');

  const placeId = await parsePlaceIdFromUrl(TARGET_URL);
  if (!placeId) {
    console.log('❌ URL에서 placeId를 추출할 수 없습니다.');
    return;
  }
  console.log(`   placeId: ${placeId}\n`);

  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
  });
  await page.setViewport({ width: 1280, height: 900 });
  await injectEvaluatePolyfill(page);

  try {
    const searched = await searchOnMobile(page, KEYWORD);
    if (!searched) {
      console.log('❌ 검색 실패');
      return;
    }

    let rank: number | null = null;
    let foundName: string | null = null;
    let listPreview: string[] = [];

    // 1) 200등 내 검색 (placeId로만 매칭, 장소명은 검색 결과에서 추출)
    let result = await findPlaceRankInMobileList(page, placeId, null, MAX_RANK_INLINE);
    rank = result.rank;
    foundName = result.placeName;
    listPreview = result.listPreview;

    // 2) 없으면 "펼쳐서 더보기" 클릭 후 재검색
    if (rank === null) {
      const expanded = await clickExpandMore(page);
      if (expanded) {
        result = await findPlaceRankInMobileList(page, placeId, null, MAX_RANK_INLINE);
        rank = result.rank;
        foundName = result.placeName;
        listPreview = result.listPreview;
      }
    }

    // 3) 여전히 없으면 "키워드+더보기" 클릭 → list 페이지에서 검색
    if (rank === null) {
      const listEntered = await clickKeywordMore(page, KEYWORD);
      if (listEntered) {
        const listResult = await findPlaceRankInListPage(page, placeId, null);
        rank = listResult.rank;
        foundName = listResult.placeName;
        listPreview = listResult.listPreview;
      }
    }

    if (rank !== null) {
      console.log('\n📍 장소 페이지 접속 중...');
      const { visitorReviewCount, blogReviewCount, starRating, firstImageUrl } = await extractReviewsFromPlacePage(page, placeId);

      console.log('\n═══════════════════════════════════════');
      console.log(`  ✅ 순위: ${rank}위`);
      if (foundName) console.log(`  장소명: ${foundName}`);
      console.log(`  placeId: ${placeId}`);
      if (starRating != null) console.log(`  별점: ${starRating}`);
      if (visitorReviewCount != null) console.log(`  방문자 리뷰: ${visitorReviewCount.toLocaleString()}개`);
      if (blogReviewCount != null) console.log(`  블로그 리뷰: ${blogReviewCount.toLocaleString()}개`);
      if (firstImageUrl) console.log(`  1번째 이미지: ${firstImageUrl}`);
      console.log('═══════════════════════════════════════');
    } else {
      console.log('\n⚠️ 리스트에서 대상 장소를 찾지 못했습니다.');
      if (listPreview?.length) {
        console.log('\n   리스트 상위:');
        listPreview.forEach((line: string) => console.log('   ', line));
      }
    }

    await delay(3000);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
