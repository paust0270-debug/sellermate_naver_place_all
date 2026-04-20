/**
 * 네이버 플레이스 순위 체크 코어 로직
 * - checkPlaceRank: 배치에서 호출 가능한 순위 체크 함수
 */
import fs from 'node:fs';
import { humanScroll, humanClickWithWander } from './utils/humanBehavior.js';

const DEFAULT_KEYWORD = '강남맛집';
const CLEAN_NAME_REGEX = /(영업\s|리뷰\s*[\d,]+|서울\s*강남구|상세주소\s*열기|육류,고기요리|카페,디저트|한식|중식|일식|양식|24시간\s*영업|TV전지적참견시점|새로오픈|저장|예약|톡톡|쿠폰|네이버페이|주문|배달).*$/gi;
const SAFE_DELAY_MS = 2000;
const MAX_RANK_INLINE = 200;
const MAX_RANK_LIST = 150;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 리스트/검색 UI에서 붙는 "이미지수12" 등 접두 제거 */
export function sanitizePlaceDisplayName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const raw = String(name).trim().replace(/\s+/g, ' ');
  let s = raw.replace(/^이미지\s*수\s*\d+\s*/i, '').trim();
  s = s.replace(/^이미지수\s*\d+\s*/i, '').trim();
  return s || raw;
}

let cachedGuiDelays: Record<string, unknown> | null | undefined = undefined;

export function resetPlaceGuiDelaysCache(): void {
  cachedGuiDelays = undefined;
}

function getGuiDelays(): Record<string, unknown> | null {
  if (cachedGuiDelays !== undefined) return cachedGuiDelays;
  const p = process.env.PLACE_GUI_DELAYS_PATH;
  if (!p) {
    cachedGuiDelays = null;
    return null;
  }
  try {
    cachedGuiDelays = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    cachedGuiDelays = null;
  }
  return cachedGuiDelays;
}

function randMsFromSpec(spec: unknown, fbMin: number, fbMax: number): number {
  if (spec == null) return fbMin + Math.random() * (fbMax - fbMin);
  if (typeof spec === 'number' && Number.isFinite(spec)) return spec;
  if (typeof spec === 'object' && spec !== null && 'min' in spec && 'max' in spec) {
    const min = Number((spec as { min: unknown }).min);
    const max = Number((spec as { max: unknown }).max);
    if (Number.isFinite(min) && Number.isFinite(max))
      return Math.min(min, max) + Math.random() * Math.abs(max - min);
  }
  return fbMin + Math.random() * (fbMax - fbMin);
}

/** GUI(작업 딜레이 JSON) 값이 있으면 min~max 랜덤, 없으면 fb 범위 */
export async function delayFromGuiConfig(key: string, fbMin: number, fbMax: number): Promise<void> {
  const d = getGuiDelays();
  const spec = d?.[key];
  await delay(randMsFromSpec(spec, fbMin, fbMax));
}

function getKeywordFromUrl(url: string): string {
  try {
    const m = url.match(/(?:n_query|bk_query)=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch {}
  return DEFAULT_KEYWORD;
}

/** place.naver.com/(세그먼트)/(숫자) 에서 세그먼트(restaurant, place, hospital, hairshop 등) */
export type PlaceType = string;

export interface ParsedPlaceUrl {
  placeId: string;
  placeType: PlaceType;
}

/** URL에서 place.naver.com/아무값/숫자 패턴 추출 - hospital, restaurant, place, hairshop 등 모든 세그먼트 통과 */
const PLACE_URL_REGEX = /place\.naver\.com\/([^/]+)\/(\d+)/;

async function parsePlaceUrl(targetUrl: string): Promise<ParsedPlaceUrl | null> {
  const m = targetUrl.match(PLACE_URL_REGEX);
  if (m) return { placeId: m[2], placeType: m[1] };
  if (targetUrl.startsWith('https://naver.me/') || targetUrl.startsWith('http://naver.me/')) {
    try {
      const res = await fetch(targetUrl, { redirect: 'follow' });
      const url = res.url;
      const nm = url.match(PLACE_URL_REGEX);
      if (nm) return { placeId: nm[2], placeType: nm[1] };
      const entry = url.match(/\/entry\/place\/(\d+)/);
      if (entry) return { placeId: entry[1], placeType: 'place' };
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/** 반대 list 재시도 시 사용할 타입 목록 (hospital, restaurant 등 모두 포함) */
const ALL_PLACE_TYPES: string[] = ['restaurant', 'place', 'hairshop', 'hospital'];
function getOtherPlaceTypes(current: string): string[] {
  return ALL_PLACE_TYPES.filter((p) => p !== current);
}

async function searchOnMobile(page: any, keyword: string): Promise<boolean> {
  try {
    await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  } catch {
    return false;
  }
  await delayFromGuiConfig('browserLoad', 2500, 4000);
  await humanScroll(page, 150 + Math.random() * 100);
  await delayFromGuiConfig('explorationBetweenScrolls', 600, 1000);
  return page.url().includes('naver.com');
}

async function findPlaceRankInMobileList(
  page: any,
  placeId: string | null,
  maxRank: number
): Promise<{ rank: number | null; placeName: string | null; category: string | null; listPreview: string[] }> {
  await delayFromGuiConfig('afterFirstSearchLoad', 2000, 3000);
  for (let s = 0; s < 3; s++) {
    await page.evaluate(() => window.scrollBy(0, 400));
    await delayFromGuiConfig('explorationBetweenScrolls', 300, 500);
  }
  await delayFromGuiConfig('explorationBetweenScrolls', 400, 800);

  const evaluated = await page.evaluate(
    (targetId: string | null, max: number, cleanRegex: string, placeUrlRe: string) => {
      const re = new RegExp(cleanRegex, 'gi');
      const placeRe = new RegExp(placeUrlRe);
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="place.naver.com"]'));
      const seen = new Set<string>();
      const items: { id: string; name: string; category: string | null }[] = [];
      for (const a of links) {
        const href = a.href || '';
        const idMatch = href.match(placeRe);
        const id = idMatch ? idMatch[2] : null;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const item = a.closest('li') || a.closest('[class*="item"]') || a.parentElement?.parentElement || a;
        const nameEl = item?.querySelector('span, div, strong') || a;
        let name = (nameEl?.textContent || a.textContent || '').trim().replace(re, '').trim();
        if (name.length > 50) name = name.slice(0, 50);
        const catEl = a.querySelector('.KCMnt') || item?.querySelector('.KCMnt');
        const category = (catEl?.textContent || '').trim() || null;
        items.push({ id, name, category });
        if (items.length >= max) break;
      }
      const listPreview = items.map((x, i) => `${i + 1}. ${x.name}`).slice(0, 50);
      for (let i = 0; i < items.length; i++) {
        if (targetId && items[i].id === targetId) {
          return { rank: i + 1, placeName: items[i].name || '알 수 없음', category: items[i].category, listPreview };
        }
      }
      return { rank: null, placeName: null, category: null, listPreview };
    },
    placeId,
    maxRank,
    CLEAN_NAME_REGEX.source,
    PLACE_URL_REGEX.source
  );
  return {
    ...evaluated,
    placeName: evaluated.placeName ? sanitizePlaceDisplayName(evaluated.placeName) : null,
  };
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
  await delayFromGuiConfig('afterSecondSearchLoad', 2000, 3000);
  return true;
}

/**
 * "키워드+더보기" 클릭 → 일반 검색 결과 list 페이지로 이동
 * restaurant/list, place/list, hospital/list, hairshop/list 등 모든 세그먼트 지원
 */
async function clickKeywordMore(page: any, keyword: string, listType: PlaceType = 'restaurant'): Promise<boolean> {
  let linkRect: { x: number; y: number } | null = null;
  try {
    linkRect = await page.evaluate((kw: string, seg: string) => {
      const isNewOpen = (href: string, cru: string) =>
        /filterOpening|keywordFilter[^=]*=.*filterOpening/i.test(href || '') || /filterOpening/i.test(cru || '');

      const tryCru = (sel: string) => {
        const el = document.querySelector(sel) as HTMLAnchorElement | null;
        if (!el || isNewOpen(el.href || '', el.getAttribute('cru') || '')) return null;
        const hasKw = (el.textContent || '').includes(kw);
        if (hasKw) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const segSafe = seg.replace(/"/g, '');
      if (segSafe) {
        const bySeg = tryCru('a.cf8PL[cru*="' + segSafe + '/list"]');
        if (bySeg) return bySeg;
      }
      for (const t of ['restaurant', 'place', 'hospital', 'hairshop']) {
        const by = tryCru('a.cf8PL[cru*="' + t + '/list"]');
        if (by) return by;
      }

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
      const all = document.querySelectorAll('a[href*="place.naver.com"][href*="list"]');
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
    }, keyword, listType);
  } catch {
    linkRect = null;
  }

  if (linkRect) {
    const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
    await humanClickWithWander(page, linkRect.x, linkRect.y);
    await navPromise;
    await delay(SAFE_DELAY_MS);
    const url = page.url();
    const isListPage = /place\.naver\.com\/[^/]+\/list/.test(url) && !/filterOpening|keywordFilter[^=]*=.*filterOpening/i.test(url);
    if (isListPage) return true;
  }

  // 3) fallback: listType에 따라 list URL 직접 이동
  console.log(`   📂 키워드+더보기 링크 없음 → ${listType}/list URL 직접 이동`);
  try {
    const listUrl = `https://m.place.naver.com/${listType}/list?query=${encodeURIComponent(keyword)}&x=126.9783882&y=37.5666103&level=top&entry=pll`;
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delayFromGuiConfig('afterFirstSearchLoad', 3500, 4500);
    return page.url().includes(`${listType}/list`);
  } catch {
    return false;
  }
}

async function scrollListPage(page: any): Promise<boolean> {
  const ok = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="place.naver.com"]'));
    if (links.length === 0) return false;
    const last = links[links.length - 1];
    const item = last.closest('li') || last.closest('[class*="item"]') || last.parentElement?.parentElement || last;
    (item || last).scrollIntoView({ block: 'end', behavior: 'auto' });
    return true;
  });
  if (ok) await delayFromGuiConfig('explorationBetweenScrolls', 600, 1000);
  return ok;
}

async function scrollListPageByKeyboard(page: any): Promise<void> {
  await page.keyboard.press('PageDown');
  await delayFromGuiConfig('explorationBetweenScrolls', 300, 500);
  await page.keyboard.press('PageDown');
  await delayFromGuiConfig('explorationBetweenScrolls', 300, 500);
}

async function findPlaceRankInListPage(
  page: any,
  placeId: string | null
): Promise<{ rank: number | null; placeName: string | null; category: string | null; listPreview: string[] }> {
  await delayFromGuiConfig('afterFirstSearchLoad', 2000, 3000);
  const MAX_SCROLL_ROUNDS = 30;
  let noNewContentCount = 0;

  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    const result = await page.evaluate(
      (targetId: string | null, cleanRegex: string, placeUrlRe: string) => {
        const re = new RegExp(cleanRegex, 'gi');
        const placeRe = new RegExp(placeUrlRe);
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="place.naver.com"]'));
        const seen = new Set<string>();
        let rank = 0;
        const listPreview: string[] = [];
        for (const a of links) {
          const href = a.href || '';
          const idMatch = href.match(placeRe);
          const id = idMatch ? idMatch[2] : null;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          rank++;
          const item = a.closest('li') || a.closest('[class*="item"]') || a.parentElement?.parentElement || a;
          let name = (item?.querySelector('span, div, strong')?.textContent || a.textContent || '').trim().replace(re, '').trim();
          if (name) listPreview.push(`${rank}. ${name}`);
          const catEl = a.querySelector('.KCMnt') || item?.querySelector('.KCMnt');
          const category = (catEl?.textContent || '').trim() || null;
          if (targetId && id === targetId) return { rank, placeName: name || '알 수 없음', category, listPreview: listPreview.slice(0, 50), itemCount: rank };
        }
        return { rank: null, placeName: null, category: null, listPreview: listPreview.slice(0, 50), itemCount: rank };
      },
      placeId,
      CLEAN_NAME_REGEX.source,
      PLACE_URL_REGEX.source
    );

    if (result.rank !== null)
      return {
        rank: result.rank,
        placeName: result.placeName ? sanitizePlaceDisplayName(result.placeName) : null,
        category: result.category ?? null,
        listPreview: result.listPreview,
      };
    const prevCount = result.itemCount ?? 0;
    if (prevCount >= MAX_RANK_LIST) break;
    if (round >= 3) {
      const atEnd = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="place.naver.com"]');
        if (links.length === 0) return true;
        const last = links[links.length - 1];
        const el = last.closest('ul') || last.closest('[class*="list"]') || document.documentElement;
        const st = el === document.documentElement ? window.scrollY : (el as HTMLElement).scrollTop;
        const sh = el === document.documentElement ? document.documentElement.scrollHeight : (el as HTMLElement).scrollHeight;
        const ch = el === document.documentElement ? window.innerHeight : (el as HTMLElement).clientHeight;
        return st + ch >= sh - 20;
      });
      if (atEnd) break;
    }
    await scrollListPage(page);
    await scrollListPageByKeyboard(page);
    const afterCount = await page.evaluate((placeUrlRe: string) => {
      const placeRe = new RegExp(placeUrlRe);
      const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="place.naver.com"]');
      const seen = new Set<string>();
      links.forEach((a) => {
        const m = (a.href || '').match(placeRe);
        if (m) seen.add(m[2]);
      });
      return seen.size;
    }, PLACE_URL_REGEX.source);
    if (afterCount <= prevCount) {
      noNewContentCount++;
      if (noNewContentCount >= 2) break;
    } else noNewContentCount = 0;
  }
  return { rank: null, placeName: null, category: null, listPreview: [] };
}

async function extractReviewsFromPlacePage(page: any, placeId: string, placeType: PlaceType = 'restaurant'): Promise<{
  placeName: string | null;
  visitorReviewCount: number | null;
  blogReviewCount: number | null;
  starRating: number | null;
  firstImageUrl: string | null;
  category: string | null;
}> {
  try {
    const path = (placeType && typeof placeType === 'string') ? placeType : 'restaurant';
    await page.goto(`https://m.place.naver.com/${path}/${placeId}/home`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await delayFromGuiConfig('browserLoad', 2500, 4000);
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    const visitor = bodyText.match(/방문자\s*리뷰\s*([\d,]+)/)?.[1]?.replace(/,/g, '');
    const blog = bodyText.match(/블로그\s*리뷰\s*([\d,]+)/)?.[1]?.replace(/,/g, '');
    const starMatch = bodyText.match(/별점\s*([\d.]+)/);
    let starRating: number | null = starMatch ? parseFloat(starMatch[1]) : null;
    if (starRating == null) {
      const fromEl = await page.evaluate(() => {
        const el = document.querySelector('.h69bs.orXYY, span.h69bs, [class*="h69bs"]');
        const m = (el?.textContent || '').trim().match(/([\d.]+)/);
        return m ? m[1] : null;
      });
      starRating = fromEl ? parseFloat(fromEl) : null;
    }
    const firstImageUrl = await page.evaluate(() => {
      const img = document.querySelector('a.place_thumb img, .place_thumb.QX0J7 img, #_autoPlayable img') as HTMLImageElement | null;
      return img?.src || null;
    });
    const category = await page.evaluate(() => {
      const el = document.querySelector('.KCMnt');
      return (el?.textContent || '').trim() || null;
    });
    const placeName = await page.evaluate(() => {
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
      placeName: sanitizePlaceDisplayName(placeName),
      visitorReviewCount: visitor ? parseInt(visitor, 10) : null,
      blogReviewCount: blog ? parseInt(blog, 10) : null,
      starRating: starRating != null && starRating >= 0 && starRating <= 5 ? starRating : null,
      firstImageUrl,
      category,
    };
  } catch {
    return { placeName: null, visitorReviewCount: null, blogReviewCount: null, starRating: null, firstImageUrl: null, category: null };
  }
}

export interface PlaceRankResult {
  rank: number | null;
  placeName: string | null;
  placeId: string;
  visitorReviewCount: number | null;
  blogReviewCount: number | null;
  starRating: number | null;
  firstImageUrl: string | null;
  category: string | null;
}

/** 상위 N개 리스트 항목 (상세페이지 방문 후 추출 데이터 포함) */
export interface TopListItem {
  rank: number;
  placeId: string;
  placeName: string;
  category: string | null;
  starRating: number | null;
  visitorReviewCount: number | null;
  blogReviewCount: number | null;
  linkUrl: string;
  placeType: PlaceType;
}

function getListPathFromUrl(url: string): PlaceType {
  const m = url.match(/place\.naver\.com\/([^/]+)\/list/);
  return m ? m[1] : 'restaurant';
}

/**
 * 상위 20개 리스트 추출 (기존 더보기 로직 사용)
 * - targetUrl 있으면 해당 타입(restaurant/place/hairshop) list로 진입
 */
export async function fetchTop20List(
  page: any,
  keyword: string,
  targetUrl?: string
): Promise<TopListItem[]> {
  console.log(`   🔍 "${keyword}" 검색 중...`);
  const searched = await searchOnMobile(page, keyword);
  if (!searched) {
    console.log(`   ⚠️ 검색 실패`);
    return [];
  }
  console.log(`   ✅ 검색 완료`);

  await delay(1500);

  console.log(`   📂 펼쳐서 더보기 클릭...`);
  const expanded = await clickExpandMore(page);
  if (expanded) {
    console.log(`   ✅ 더보기 클릭 완료`);
    await delay(2000);
  } else {
    console.log(`   (더보기 없음 또는 이미 펼쳐짐)`);
  }

  const initialListType: PlaceType = targetUrl ? (await parsePlaceUrl(targetUrl))?.placeType ?? 'restaurant' : 'restaurant';

  let items = await extractListItemsFromPage(page, 20);
  if (items.length > 0) {
    console.log(`   📋 리스트 ${items.length}개 추출`);
  }
  if (items.length < 20) {
    console.log(`   📂 리스트 ${items.length}개 → 키워드+더보기 클릭 (일반 목록만)...`);
    const listEntered = await clickKeywordMore(page, keyword, initialListType);
    if (listEntered) {
      const url = page.url();
      const listPath = getListPathFromUrl(url);
      if (/filterOpening|keywordFilter[^=]*=.*filterOpening/i.test(url)) {
        console.log(`   ⚠️ 새로오픈 필터 페이지 감지 → 일반 list로 재이동`);
        await page.goto(`https://m.place.naver.com/${listPath}/list?query=${encodeURIComponent(keyword)}`, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await delay(3000);
      }
      console.log(`   ✅ list 페이지 진입`);
      await delay(3000);
      // 리스트 페이지 로딩 대기: 스크롤로 콘텐츠 로드
      for (let s = 0; s < 3; s++) {
        await page.evaluate(() => window.scrollBy(0, 400));
        await delay(500);
      }
      await delay(1000);
      items = await extractListItemsFromListPage(page, 20);
      if (items.length === 0) {
        console.log(`   📂 list 페이지 추출 0건 → 인라인 추출 방식으로 재시도...`);
        items = await extractListItemsFromPage(page, 20);
      }
      if (items.length === 0) {
        console.log(`   📂 인라인 추출 0건 → 최소 추출 방식으로 재시도...`);
        items = await extractListItemsMinimal(page, 20);
      }
      if (items.length > 0) {
        console.log(`   📋 list 페이지에서 ${items.length}개 추출`);
      }
    }
  }

  if (items.length === 0) return [];

  const listUrl = page.url();
  const listPath = getListPathFromUrl(listUrl);
  const results: TopListItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const placeType = it.placeType ?? listPath;
    console.log(`   [${i + 1}/${items.length}] ${it.placeName} (${it.placeId}) 상세페이지 방문 중...`);
    const detail = await extractReviewsFromPlacePage(page, it.placeId, placeType);
    const finalName = it.placeName !== '알 수 없음' ? it.placeName : (detail.placeName || it.placeName);
    const pathStr = (placeType && typeof placeType === 'string') ? placeType : 'restaurant';
    const r = {
      rank: i + 1,
      placeId: it.placeId,
      placeName: finalName,
      category: it.category ?? detail.category,
      starRating: detail.starRating,
      visitorReviewCount: detail.visitorReviewCount,
      blogReviewCount: detail.blogReviewCount,
      linkUrl: `https://m.place.naver.com/${pathStr}/${it.placeId}/home`,
      placeType,
    };
    results.push(r);
    console.log(`      → 별점: ${r.starRating ?? '-'} | 방문자: ${r.visitorReviewCount?.toLocaleString() ?? '-'} | 블로그: ${r.blogReviewCount?.toLocaleString() ?? '-'} | 카테고리: ${r.category ?? '-'}`);
    if (i < items.length - 1) await delay(1500 + Math.random() * 1000);
  }
  return results;
}

const CATEGORY_PATTERN = '육류,고기요리|요리주점|일식당|중식당|한식|양식|카페,디저트|냉면|장어,먹장어요리|버섯칼국수';

/** 현재 페이지(인라인 검색결과)에서 리스트 항목 추출 - place.naver.com/세그먼트/숫자 모두 지원 */
async function extractListItemsFromPage(page: any, maxItems: number): Promise<{ placeId: string; placeName: string; category: string | null; placeType: PlaceType }[]> {
  return page.evaluate((max: number, catPat: string, placeUrlRe: string) => {
    const placeRe = new RegExp(placeUrlRe);
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="place.naver.com"]'));
    const seen = new Set<string>();
    const items: { placeId: string; placeName: string; category: string | null; placeType: string }[] = [];
    const re = new RegExp('(.+?)(' + catPat + ')');
    for (const a of links) {
      const href = a.href || '';
      const m = href.match(placeRe);
      const id = m ? m[2] : null;
      const placeType = m ? m[1] : null;
      if (!id || !placeType || seen.has(id)) continue;
      seen.add(id);
      const item = a.closest('li') || a.closest('[class*="item"]') || a.parentElement?.parentElement || a;
      const container = item || a;
      const nameEl = a.querySelector('.TYaxT') || container.querySelector('.TYaxT');
      let placeName = (nameEl?.textContent || '').trim();
      if (!placeName) {
        const full = (a.textContent || container.textContent || '').trim();
        const mm = full.match(re);
        placeName = mm ? mm[1].trim() : full.split('강남구')[0].trim() || full.slice(0, 50);
      }
      const catEl = a.querySelector('.KCMnt') || container.querySelector('.KCMnt');
      let category = (catEl?.textContent || '').trim() || null;
      if (!category) {
        const cm = (container.textContent || '').match(new RegExp(catPat));
        category = cm ? cm[0] : null;
      }
      items.push({ placeId: id, placeName: placeName.slice(0, 80) || '알 수 없음', category, placeType });
      if (items.length >= max) break;
    }
    return items;
  }, maxItems, CATEGORY_PATTERN, PLACE_URL_REGEX.source);
}

/** place.naver.com/세그먼트/list 페이지에서 리스트 항목 추출 - 새로오픈 매장 제외 */
async function extractListItemsFromListPage(page: any, maxItems: number): Promise<{ placeId: string; placeName: string; category: string | null; placeType: PlaceType }[]> {
  return page.evaluate((max: number, cleanRegex: string, catPat: string, placeUrlRe: string) => {
    const re = new RegExp(cleanRegex, 'gi');
    const placeRe = new RegExp(placeUrlRe);
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="place.naver.com"]'));
    const seen = new Set<string>();
    const items: { placeId: string; placeName: string; category: string | null; placeType: string }[] = [];
    const catRe = new RegExp(catPat);
    const newOpenRe = /새로\s*오픈|새로오픈/i;
    for (const a of links) {
      const href = a.href || '';
      const m = href.match(placeRe);
      const id = m ? m[2] : null;
      const placeType = m ? m[1] : null;
      if (!id || !placeType || seen.has(id)) continue;
      const item = a.closest('li') || a.closest('[class*="item"]') || a.parentElement?.parentElement || a;
      const fullText = (item?.textContent || a.textContent || '').trim();
      if (newOpenRe.test(fullText)) {
        seen.add(id);
        continue;
      }
      seen.add(id);
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
      items.push({ placeId: id, placeName: name.slice(0, 80) || '알 수 없음', category, placeType });
      if (items.length >= max) break;
    }
    return items;
  }, maxItems, CLEAN_NAME_REGEX.source, CATEGORY_PATTERN, PLACE_URL_REGEX.source);
}

/** 최소한의 추출 (리스트/인라인 공통) - place.naver.com/세그먼트/숫자 모두 지원 */
async function extractListItemsMinimal(page: any, maxItems: number): Promise<{ placeId: string; placeName: string; category: string | null; placeType: PlaceType }[]> {
  return page.evaluate((max: number, placeUrlRe: string) => {
    const placeRe = new RegExp(placeUrlRe);
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="place.naver.com"]'));
    const seen = new Set<string>();
    const items: { placeId: string; placeName: string; category: string | null; placeType: string }[] = [];
    for (const a of links) {
      const href = a.href || '';
      const m = href.match(placeRe);
      const id = m ? m[2] : null;
      const placeType = m ? m[1] : null;
      if (!id || !placeType || seen.has(id)) continue;
      seen.add(id);
      const item = a.closest('li') || a.closest('[class*="item"]') || a.parentElement?.parentElement || a;
      const container = item || a;
      const nameEl = container.querySelector('.TYaxT, [class*="place_name"], strong, span');
      let placeName = (nameEl?.textContent || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!placeName) placeName = container.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || '알 수 없음';
      const catEl = container.querySelector('.KCMnt, [class*="category"]');
      const category = (catEl?.textContent || '').trim() || null;
      items.push({ placeId: id, placeName: placeName || '알 수 없음', category, placeType });
      if (items.length >= max) break;
    }
    return items;
  }, maxItems, PLACE_URL_REGEX.source);
}

export async function checkPlaceRank(
  page: any,
  targetUrl: string,
  keywordOverride?: string
): Promise<PlaceRankResult | null> {
  const keyword = keywordOverride ?? getKeywordFromUrl(targetUrl);
  const parsed = await parsePlaceUrl(targetUrl);
  if (!parsed) return null;
  const { placeId, placeType } = parsed;

  console.log(`   🔍 타겟 순위 검색: "${keyword}" (placeId: ${placeId}, 타입: ${placeType})`);
  const searched = await searchOnMobile(page, keyword);
  if (!searched) return null;

  let rank: number | null = null;
  let foundName: string | null = null;
  let category: string | null = null;

  let result = await findPlaceRankInMobileList(page, placeId, MAX_RANK_INLINE);
  rank = result.rank;
  foundName = result.placeName;
  category = result.category;
  if (rank !== null) console.log(`   ✅ 인라인 리스트에서 순위 발견: ${rank}위`);

  if (rank === null) {
    const expanded = await clickExpandMore(page);
    if (expanded) {
      result = await findPlaceRankInMobileList(page, placeId, MAX_RANK_INLINE);
      rank = result.rank;
      foundName = result.placeName;
      category = result.category;
      if (rank !== null) console.log(`   ✅ 더보기 후 순위 발견: ${rank}위`);
    }
  }

  /** URL 타입과 실제 노출 list가 다를 수 있음(예: restaurant URL인데 place list에 노출). 상세 진입 시 사용 */
  let effectivePlaceType: PlaceType = placeType;

  if (rank === null) {
    console.log(`   📂 키워드+더보기 → list 페이지 검색...`);
    const listEntered = await clickKeywordMore(page, keyword, placeType);
    if (listEntered) {
      const listResult = await findPlaceRankInListPage(page, placeId);
      rank = listResult.rank;
      foundName = listResult.placeName;
      category = listResult.category;
      if (rank !== null) console.log(`   ✅ list 페이지에서 순위 발견: ${rank}위`);
    }

    // 다른 업종 list에만 노출되는 경우 → 나머지 list 타입 순차 재시도
    if (rank === null) {
      for (const otherListType of getOtherPlaceTypes(placeType)) {
        if (rank !== null) break;
        console.log(`   📂 list에서 미발견 → ${otherListType}/list 재시도...`);
        try {
          const fallbackListUrl = `https://m.place.naver.com/${otherListType}/list?query=${encodeURIComponent(keyword)}&x=126.9783882&y=37.5666103&level=top&entry=pll`;
          await page.goto(fallbackListUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await delayFromGuiConfig('afterFirstSearchLoad', 3500, 4500);
          if (page.url().includes(`${otherListType}/list`)) {
            const listResult = await findPlaceRankInListPage(page, placeId);
            if (listResult.rank !== null) {
              rank = listResult.rank;
              foundName = listResult.placeName;
              category = listResult.category;
              effectivePlaceType = otherListType;
              console.log(`   ✅ ${otherListType}/list에서 순위 발견: ${rank}위`);
              break;
            }
          }
        } catch {
          // fallback 실패 시 무시
        }
      }
    }
  }

  let visitorReviewCount: number | null = null;
  let blogReviewCount: number | null = null;
  let starRating: number | null = null;
  let firstImageUrl: string | null = null;

  if (rank !== null) {
    console.log(`   📄 타겟 상세페이지 추출 중...`);
    const extracted = await extractReviewsFromPlacePage(page, placeId, effectivePlaceType);
    visitorReviewCount = extracted.visitorReviewCount;
    blogReviewCount = extracted.blogReviewCount;
    starRating = extracted.starRating;
    firstImageUrl = extracted.firstImageUrl;
    if (!category && extracted.category) category = extracted.category;
    if ((!foundName || foundName === '알 수 없음') && extracted.placeName) foundName = extracted.placeName;
    foundName = sanitizePlaceDisplayName(foundName) ?? foundName;
    console.log(`   → 별점: ${starRating ?? '-'} | 방문자: ${visitorReviewCount?.toLocaleString() ?? '-'} | 블로그: ${blogReviewCount?.toLocaleString() ?? '-'} | 카테고리: ${category ?? '-'}`);
  } else {
    console.log(`   ⚠️ 순위 미발견`);
  }

  return {
    rank,
    placeName: sanitizePlaceDisplayName(foundName),
    placeId,
    visitorReviewCount,
    blogReviewCount,
    starRating,
    firstImageUrl,
    category,
  };
}

/**
 * 순위만 체크 (상세페이지 진입 없음). 무료 플레이스용.
 * 검색 → 인라인/더보기/리스트에서 순위 찾기까지만 수행하고 반환.
 * - URL 타입: restaurant / place / hairshop 지원 (parsePlaceUrl)
 * - list 미발견 시 다른 list 타입(restaurant↔place↔hairshop) 순차 재시도
 */
export async function checkPlaceRankRankOnly(
  page: any,
  targetUrl: string,
  keywordOverride?: string
): Promise<PlaceRankResult | null> {
  const keyword = keywordOverride ?? getKeywordFromUrl(targetUrl);
  const parsed = await parsePlaceUrl(targetUrl);
  if (!parsed) return null;
  const { placeId, placeType } = parsed;

  console.log(`   🔍 [무료] 순위만 검색: "${keyword}" (placeId: ${placeId}, 타입: ${placeType})`);
  const searched = await searchOnMobile(page, keyword);
  if (!searched) return null;

  let rank: number | null = null;
  let foundName: string | null = null;
  let category: string | null = null;

  let result = await findPlaceRankInMobileList(page, placeId, MAX_RANK_INLINE);
  rank = result.rank;
  foundName = result.placeName;
  category = result.category;
  if (rank !== null) console.log(`   ✅ 인라인 리스트에서 순위 발견: ${rank}위`);

  if (rank === null) {
    const expanded = await clickExpandMore(page);
    if (expanded) {
      result = await findPlaceRankInMobileList(page, placeId, MAX_RANK_INLINE);
      rank = result.rank;
      foundName = result.placeName;
      category = result.category;
      if (rank !== null) console.log(`   ✅ 더보기 후 순위 발견: ${rank}위`);
    }
  }

  if (rank === null) {
    console.log(`   📂 키워드+더보기 → list 페이지 검색...`);
    const listEntered = await clickKeywordMore(page, keyword, placeType);
    if (listEntered) {
      const listResult = await findPlaceRankInListPage(page, placeId);
      rank = listResult.rank;
      foundName = listResult.placeName;
      category = listResult.category;
      if (rank !== null) {
        console.log(`   ✅ list 페이지에서 순위 발견: ${rank}위`);
      }
    }

    // 다른 list 타입 순차 재시도
    if (rank === null) {
      for (const otherListType of getOtherPlaceTypes(placeType)) {
        if (rank !== null) break;
        console.log(`   📂 list에서 미발견 → ${otherListType}/list 재시도...`);
        try {
          const fallbackListUrl = `https://m.place.naver.com/${otherListType}/list?query=${encodeURIComponent(keyword)}&x=126.9783882&y=37.5666103&level=top&entry=pll`;
          await page.goto(fallbackListUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await delayFromGuiConfig('afterFirstSearchLoad', 3500, 4500);
          if (page.url().includes(`${otherListType}/list`)) {
            const listResult = await findPlaceRankInListPage(page, placeId);
            if (listResult.rank !== null) {
              rank = listResult.rank;
              foundName = listResult.placeName;
              category = listResult.category;
              console.log(`   ✅ ${otherListType}/list에서 순위 발견: ${rank}위`);
              break;
            }
          }
        } catch {
          // fallback 실패 시 무시
        }
      }
    }
  }

  if (rank === null) {
    console.log(`   ⚠️ 순위 미발견 (상세 진입 없음)`);
  }

  return {
    rank,
    placeName: sanitizePlaceDisplayName(foundName),
    placeId,
    visitorReviewCount: null,
    blogReviewCount: null,
    starRating: null,
    firstImageUrl: null,
    category,
  };
}
