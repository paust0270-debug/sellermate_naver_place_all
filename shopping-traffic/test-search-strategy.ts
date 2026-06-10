#!/usr/bin/env npx tsx
/**
 * 쇼핑 트래픽 테스트 스크립트
 *
 * - 하드코딩된 상품 제목/URL을 출력
 * - unified-runner.ts와 동일한 2단 검색 조합을 시험
 * - 검색 결과에서 MID 우선, URL/제목 fallback 순으로 링크를 찾아 클릭
 *
 * 실행:
 *   npx tsx shopping-traffic/test-search-strategy.ts
 *   npx tsx shopping-traffic/test-search-strategy.ts 무선이어폰
 */

import { chromium } from 'patchright';
import { applyMobileStealth, MOBILE_CONTEXT_OPTIONS } from './shared/mobile-stealth';

const TARGET_TITLE = '프리미엄 블루투스 이어팟 차이팟 무선이어폰 충전케이스무료';
const TARGET_URL = 'https://smartstore.naver.com/sunsaem/products/5994983177?nl-au=5906e080b9554dd5b730d00a7fea052b&nl-query=%EC%84%A0%EC%83%98';
const TARGET_MID = normalizeNaverProductUrl(TARGET_URL)?.productId ?? null;
const FIRST_KEYWORD = (process.argv[2] || '무선이어폰').trim();
const SECOND_SEARCH_TAIL_WORDS = ['판매', '최저가', '최저', '구매', '비교', '판매처', '추천', '가격', '구매처', '가격비교'];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffleWords(text: string): string[] {
  const cleaned = text
    .replace(/[\[\](){}]/g, ' ')
    .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(' ').filter(Boolean);
  if (words.length <= 1) return words;

  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words;
}

function buildSecondSearchPhrase(firstKeyword: string, productTitle: string): { phrase: string; pickedWord: string; pickedTail: string } {
  const titleWords = shuffleWords(productTitle);
  const pickedWord = titleWords.length > 0
    ? titleWords[Math.floor(Math.random() * titleWords.length)]
    : firstKeyword;
  const pickedTail = SECOND_SEARCH_TAIL_WORDS[Math.floor(Math.random() * SECOND_SEARCH_TAIL_WORDS.length)];

  const parts = [firstKeyword || '상품', pickedWord || firstKeyword || '상품', pickedTail];
  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  return { phrase: parts.join(' '), pickedWord, pickedTail };
}

function normalizeNaverProductUrl(rawUrl: string): { origin: string; productId: string | null; pathname: string } | null {
  try {
    const url = new URL(rawUrl);
    const pathname = url.pathname.replace(/\/+$/, '');
    const productId = pathname.match(/\/products\/(\d+)/)?.[1] ?? null;
    return {
      origin: url.origin,
      productId,
      pathname,
    };
  } catch {
    return null;
  }
}

async function enterNaverSearch(page: any, keyword: string, label: string): Promise<boolean> {
  console.log(`🧭 ${label}: 모바일 검색 진입`);
  try {
    await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  } catch (error) {
    console.log(`⚠️ ${label}: 검색 진입 실패`, error);
    return false;
  }

  await delay(2500);
  return true;
}

async function overwriteSearchInput(page: any, keyword: string, label: string): Promise<boolean> {
  try {
    await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    console.log(`⏳ ${label}: 재검색 결과 대기 중...`);
    await delay(2500);
    return true;
  } catch (error) {
    console.log(`❌ ${label}: 재검색 실패`, error);
    return false;
  }
}

async function findMatchingLink(
  page: any,
  targetUrl: string,
  title: string,
  targetMid: string | null
): Promise<{ title: string; href: string; matchedBy: string; index: number } | null> {
  const target = title.replace(/\s+/g, ' ').trim().substring(0, 40);
  if (!target) return null;

  let targetOrigin = '';
  let targetPathname = '';
  let targetProductId: string | null = null;
  try {
    const u = new URL(targetUrl);
    targetOrigin = u.origin;
    targetPathname = u.pathname.replace(/\/+$/, '');
    const m = targetPathname.match(/\/products\/(\d+)/);
    targetProductId = m ? m[1] : null;
  } catch {
    return null;
  }

  const anchors = page.locator('a[href*="smartstore"], a[href*="brand.naver"], a[href*="shopping.naver"], a[href*="nv_mid="]');
  const count = await anchors.count();

  for (let i = 0; i < count; i++) {
    const anchor = anchors.nth(i);
    const href = (await anchor.getAttribute('href')) || '';
    if (!href) continue;

    let hrefOrigin = '';
    let hrefPathname = '';
    let hrefProductId: string | null = null;
    try {
      const u = new URL(href, targetUrl);
      hrefOrigin = u.origin;
      hrefPathname = u.pathname.replace(/\/+$/, '');
      const m = hrefPathname.match(/\/products\/(\d+)/);
      hrefProductId = m ? m[1] : null;
    } catch {
      continue;
    }

    let urlMatched = false;
    if (targetMid && (href.includes(`nv_mid=${targetMid}`) || href.includes(`nvMid=${targetMid}`) || href.includes(`nv_mid%3D${targetMid}`))) {
      urlMatched = true;
    } else if (targetProductId && hrefProductId && targetProductId === hrefProductId) {
      urlMatched = true;
    } else if (targetOrigin === hrefOrigin && targetPathname === hrefPathname) {
      urlMatched = true;
    }
    if (!urlMatched) continue;

    const text = ((await anchor.textContent()) || '').replace(/\s+/g, ' ').trim();
    return {
      title: text.substring(0, 120),
      href: href,
      matchedBy: targetMid ? 'mid' : targetProductId ? 'productId' : 'normalizedUrl',
      index: i,
    };
  }

  return null;
}

async function clickMatchedLink(page: any, href: string): Promise<boolean> {
  try {
    const links = page.locator('a[href*="smartstore"], a[href*="brand.naver"], a[href*="shopping.naver"], a[href*="nv_mid="]');
    const count = await links.count();
    let locator = null;
    for (let i = 0; i < count; i++) {
      const candidate = links.nth(i);
      const candidateHref = (await candidate.getAttribute('href')) || '';
      if (!candidateHref) continue;
      if (candidateHref === href || candidateHref.includes(href) || href.includes(candidateHref)) {
        locator = candidate;
        break;
      }
    }
    if (!locator) return false;
    await locator.click({ force: true });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🧪 쇼핑 트래픽 테스트 스크립트');
  console.log('='.repeat(70));
  console.log(`📝 하드코딩 제목: ${TARGET_TITLE}`);
  console.log(`🔗 하드코딩 URL: ${TARGET_URL}`);
  console.log(`🆔 하드코딩 MID: ${TARGET_MID || 'N/A'}`);
  console.log(`🔑 1차 검색어: ${FIRST_KEYWORD}`);

  const { phrase: secondPhrase, pickedWord, pickedTail } = buildSecondSearchPhrase(FIRST_KEYWORD, TARGET_TITLE);
  console.log(`🔁 2차 검색어: ${secondPhrase}`);
  console.log(`   └ 선택된 제목 단어: ${pickedWord}`);
  console.log(`   └ 선택된 꼬리어: ${pickedTail}`);

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1200,900',
      '--window-position=80,80',
    ],
  });

  const context = await browser.newContext(MOBILE_CONTEXT_OPTIONS);
  await applyMobileStealth(context);

  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  try {
    const firstStepOk = await enterNaverSearch(page, FIRST_KEYWORD, '1차 검색');
    if (!firstStepOk) return;

    const secondStepOk = await overwriteSearchInput(page, secondPhrase, '2차 검색');
    if (!secondStepOk) return;

    console.log('🔎 MID 우선 링크 탐색 중...');
    const matched = await findMatchingLink(page, TARGET_URL, TARGET_TITLE, TARGET_MID);

    if (!matched) {
      console.log('❌ URL 매칭 링크를 찾지 못했습니다.');
      console.log(`🔗 하드코딩 URL: ${TARGET_URL}`);
      return;
    }

    console.log(`✅ URL 매칭 발견: ${matched.title}`);
    console.log(`🔗 하드코딩 URL: ${TARGET_URL}`);
    console.log(`🧷 DOM에서 확인된 href: ${matched.href}`);
    console.log(`🧷 매칭 기준: ${matched.matchedBy}`);

    const clicked = await clickMatchedLink(page, matched.href);
    if (clicked) {
      await delay(3000);
      console.log(`📍 클릭 후 URL: ${page.url()}`);
    } else {
      console.log('⚠️ 제목 매칭 링크 클릭 실패');
    }
  } catch (error: any) {
    console.error(`❌ 테스트 실행 중 에러: ${error.message}`);
  } finally {
    console.log('⏳ 10초 후 브라우저 종료...');
    await delay(10000);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    console.log('👋 완료');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
