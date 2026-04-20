import { chromium, Browser, Page } from 'patchright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';

// 환경 변수 로드 (.env.local 우선)
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config(); // 기본 .env도 시도

// Supabase 클라이언트 초기화
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase 환경 변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// PC 고유 ID 생성 (환경 변수 또는 호스트명 사용)
const PC_ID = process.env.PC_ID || process.env.COMPUTERNAME || process.env.HOSTNAME || `PC-${Date.now()}`;
console.log(`🖥️ PC ID: ${PC_ID}`);

// 인터페이스 정의
interface KeywordItem {
  id: number;
  slot_id: number;
  slot_sequence: number;
  slot_type: string;
  keyword: string;
  link_url: string | null;
}

/** 무료 쿠팡 순위체크용: sellermate_keywords (free_coupang_id not null) */
interface FreeKeywordItem {
  id: number;
  free_coupang_id: number;
  keyword: string;
  link_url: string | null;
}

interface ProductInfo {
  imageUrl: string | null;
  totalOptions: number;
  soldoutOptions: number;
  price: number | null;           // 쿠팡 판매가
  priceSale: number | null;        // 할인 판매가
  reviewCount: number;
}

interface SearchResult {
  success: boolean;
  rank: number | null;
  productInfo?: ProductInfo;
  error?: string;
  isAccessDenied?: boolean; // Access Denied 에러 여부
  pageAccessFailed?: boolean; // 2페이지 이상 접속 실패 여부
  maxPageReached?: number; // 실제 접속한 최대 페이지 번호
}

/**
 * URL에서 상품번호 추출
 */
function extractProductId(url: string | null): string | null {
  if (!url) return null;
  
  const patterns = [
    /\/products\/(\d+)/,           // /products/숫자
    /\/vp\/products\/(\d+)/,       // /vp/products/숫자
    /productId=(\d+)/,             // productId=숫자
    /itemId=(\d+)/                 // itemId=숫자
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * sellermate_keywords 테이블에서 1개 항목 조회 (원자적 락)
 */
async function fetchKeywordItem(): Promise<KeywordItem | null> {
  // assigned_to가 null인 항목 조회
  const { data: availableData, error: selectError } = await supabase
    .from('sellermate_keywords')
    .select('id, slot_id, slot_sequence, slot_type, keyword, link_url')
    .in('slot_type', ['쿠팡', '쿠팡VIP', '쿠팡APP', '쿠팡순위체크'])
    .is('assigned_to', null) // assigned_to가 null인 것만 조회
    .order('id', { ascending: false })
    .limit(1);

  if (selectError) {
    console.error(`❌ sellermate_keywords 테이블 조회 실패: ${selectError.message}`);
    throw selectError;
  }

  if (!availableData || availableData.length === 0) {
    return null;
  }

  const item = availableData[0];

  // assigned_to를 자신의 ID로 업데이트 (다른 PC가 동시에 가져가지 않도록)
  const { data: updatedData, error: updateError } = await supabase
    .from('sellermate_keywords')
    .update({ assigned_to: PC_ID })
    .eq('id', item.id)
    .is('assigned_to', null) // assigned_to가 null인 것만 업데이트 (원자적)
    .select('id, slot_id, slot_sequence, slot_type, keyword, link_url')
    .single();

  if (updateError) {
    if (updateError.code === 'PGRST116') {
      // 다른 PC가 이미 가져간 경우
      return null;
    }
    console.error(`❌ sellermate_keywords 항목 마킹 실패: ${updateError.message}`);
    throw updateError;
  }

  if (!updatedData) {
    return null;
  }

  return updatedData as KeywordItem;
}

/**
 * sellermate_keywords 테이블에서 무료 쿠팡 1건 조회 (free_coupang_id not null, 원자적 락)
 */
async function fetchFreeKeywordItem(): Promise<FreeKeywordItem | null> {
  const { data: availableData, error: selectError } = await supabase
    .from('sellermate_keywords')
    .select('id, free_coupang_id, keyword, link_url')
    .not('free_coupang_id', 'is', null)
    .not('keyword', 'is', null)
    .is('assigned_to', null)
    .order('id', { ascending: false })
    .limit(1);

  if (selectError) {
    console.error(`❌ sellermate_keywords(무료 쿠팡) 조회 실패: ${selectError.message}`);
    throw selectError;
  }

  if (!availableData || availableData.length === 0) {
    return null;
  }

  const item = availableData[0];

  const { data: updatedData, error: updateError } = await supabase
    .from('sellermate_keywords')
    .update({ assigned_to: PC_ID })
    .eq('id', item.id)
    .is('assigned_to', null)
    .select('id, free_coupang_id, keyword, link_url')
    .single();

  if (updateError) {
    if (updateError.code === 'PGRST116') return null;
    console.error(`❌ sellermate_keywords(무료 쿠팡) 마킹 실패: ${updateError.message}`);
    throw updateError;
  }

  if (!updatedData) return null;
  return updatedData as FreeKeywordItem;
}

/**
 * sellermate_keywords 테이블에서 항목이 여전히 존재하는지 확인
 */
async function checkKeywordItemExists(itemId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('sellermate_keywords')
    .select('id')
    .eq('id', itemId)
    .single();

  if (error && error.code === 'PGRST116') {
    return false; // 레코드 없음
  }
  
  return data !== null;
}

/**
 * 쿠팡 상품 페이지에서 상품 정보 추출
 */
async function extractProductInfo(
  page: Page,
  productUrl: string,
  productId: string
): Promise<ProductInfo> {
  try {
    console.log(`📦 상품 페이지로 이동: ${productUrl}`);
    
    // 상품 페이지로 이동
    await page.goto(productUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    
    // 리뷰수 먼저 추출 (옵션 선택 전에 추출해야 정확함)
    let reviewCount = 0;
    try {
      // 리뷰수 영역이 로드될 때까지 대기 (여러 셀렉터 병렬 시도, 타임아웃 짧게)
      let selectorFound = false;
      const selectorsToWait = [
        '#prod-review-nav-link .rating-count-txt',
        'a[href="#sdpReview"] .rating-count-txt',
        '.review-atf .rating-count-txt',
        '.rating-count-txt',
        '#prod-review-nav-link',
        'a[href="#sdpReview"]',
      ];
      
      // 첫 번째 셀렉터만 빠르게 시도 (가장 정확한 셀렉터)
      try {
        await page.waitForSelector(selectorsToWait[0], { timeout: 1500 });
        selectorFound = true;
        console.log(`✅ 리뷰수 셀렉터 발견: ${selectorsToWait[0]}`);
      } catch (e) {
        // 나머지 셀렉터 빠르게 시도
        for (let i = 1; i < selectorsToWait.length; i++) {
          try {
            await page.waitForSelector(selectorsToWait[i], { timeout: 500 });
            selectorFound = true;
            console.log(`✅ 리뷰수 셀렉터 발견: ${selectorsToWait[i]}`);
            break;
          } catch (e) {
            // 다음 셀렉터 시도
          }
        }
      }
      
      if (!selectorFound) {
        console.log('⚠️ 리뷰수 셀렉터를 찾지 못했습니다. 직접 검색 시도...');
      }
      
      // 최소 대기 (동적 로드 대기) - 리뷰수 영역이 완전히 로드될 때까지 충분히 대기
      await page.waitForTimeout(2000);
      
      // 리뷰수 영역이 실제로 로드되었는지 확인 (최대 3번 재시도)
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries && reviewCount === 0) {
        const extractionResult = await page.evaluate(() => {
          // 정확한 셀렉터 우선 시도 (제공된 HTML 구조 기반)
          const selectors = [
            '#prod-review-nav-link .rating-count-txt',
            'a[href="#sdpReview"] .rating-count-txt',
            '.review-atf .rating-count-txt',
            '.rating-count-txt',
          ];
          
          const debugInfo: { selector: string; found: boolean; text?: string; innerText?: string; extracted?: number }[] = [];
          
          for (const selector of selectors) {
            const reviewEl = document.querySelector(selector);
            const info: any = { selector, found: !!reviewEl };
            
            if (reviewEl) {
              // textContent 사용 (HTML 주석 포함)
              const text = reviewEl.textContent?.trim() || '';
              // innerText도 시도 (주석 제거된 버전)
              const innerText = (reviewEl as HTMLElement).innerText?.trim() || '';
              
              info.text = text;
              info.innerText = innerText;
              
              // 두 텍스트 모두 확인
              const textsToCheck = [innerText, text].filter(t => t.length > 0);
              
              for (const targetText of textsToCheck) {
                // 패턴 0: 괄호 안의 숫자만 있는 경우 "(209)", "(216)" 등 (우선순위 최상)
                const bracketPattern = /\((\d{1,3}(?:,\d{3})*)\)/;
                const bracketMatch = targetText.match(bracketPattern);
                if (bracketMatch && bracketMatch[1]) {
                  const count = parseInt(bracketMatch[1].replace(/,/g, ''), 10);
                  if (count > 0) {
                    info.extracted = count;
                    debugInfo.push(info);
                    return { count, debugInfo };
                  }
                }
                
                // 패턴 1: "숫자개 상품평" 또는 "숫자<!-- --> <!-- -->개 상품평"
                const pattern1 = /(\d{1,3}(?:,\d{3})*)\s*(?:<!--\s*-->)?\s*(?:<!--\s*-->)?\s*개\s*상품평/;
                const match1 = targetText.match(pattern1);
                if (match1 && match1[1]) {
                  const count = parseInt(match1[1].replace(/,/g, ''), 10);
                  if (count > 0) {
                    info.extracted = count;
                    debugInfo.push(info);
                    return { count, debugInfo };
                  }
                }
                
                // 패턴 2: "숫자개 리뷰"
                const pattern2 = /(\d{1,3}(?:,\d{3})*)\s*(?:<!--\s*-->)?\s*(?:<!--\s*-->)?\s*개\s*리뷰/;
                const match2 = targetText.match(pattern2);
                if (match2 && match2[1]) {
                  const count = parseInt(match2[1].replace(/,/g, ''), 10);
                  if (count > 0) {
                    info.extracted = count;
                    debugInfo.push(info);
                    return { count, debugInfo };
                  }
                }
                
                // 패턴 3: "상품평" 또는 "리뷰"가 포함된 경우, "개" 단위가 있는 숫자만 추출
                if (targetText.includes('상품평') || targetText.includes('리뷰')) {
                  // "개" 단위가 있는 숫자만 추출 (평점 등 다른 숫자 제외)
                  // 예: "209개 상품평", "563개 상품평" 등
                  const numberWithUnitMatch = targetText.match(/(\d{1,3}(?:,\d{3})*)\s*개\s*(?:상품평|리뷰)/);
                  if (numberWithUnitMatch && numberWithUnitMatch[1]) {
                    const count = parseInt(numberWithUnitMatch[1].replace(/,/g, ''), 10);
                    if (count > 0) {
                      info.extracted = count;
                      debugInfo.push(info);
                      return { count, debugInfo };
                    }
                  }
                  
                  // "개" 단위가 없지만, 텍스트가 숫자로 시작하고 "상품평" 또는 "리뷰"로 끝나는 경우만 추출
                  // 예: "209 상품평" (공백으로 구분)
                  const simpleMatch = targetText.match(/^(\d{1,3}(?:,\d{3})*)\s+(?:상품평|리뷰)/);
                  if (simpleMatch && simpleMatch[1]) {
                    const count = parseInt(simpleMatch[1].replace(/,/g, ''), 10);
                    if (count > 0 && count > 10) { // 10 이상인 경우만 (평점 4.5점 같은 경우 제외)
                      info.extracted = count;
                      debugInfo.push(info);
                      return { count, debugInfo };
                    }
                  }
                }
              }
            }
            
            debugInfo.push(info);
          }
          
          // 셀렉터로 찾지 못한 경우, #prod-review-nav-link의 전체 텍스트에서 괄호 패턴 시도
          const parentEl = document.querySelector('#prod-review-nav-link');
          if (parentEl) {
            const parentText = parentEl.textContent?.trim() || '';
            const parentInnerText = (parentEl as HTMLElement).innerText?.trim() || '';
            const parentTextsToCheck = [parentInnerText, parentText].filter(t => t.length > 0);
            
            for (const targetText of parentTextsToCheck) {
              // 괄호 안의 숫자만 있는 경우 "(209)", "(216)" 등
              const bracketPattern = /\((\d{1,3}(?:,\d{3})*)\)/;
              const bracketMatch = targetText.match(bracketPattern);
              if (bracketMatch && bracketMatch[1]) {
                const count = parseInt(bracketMatch[1].replace(/,/g, ''), 10);
                if (count > 0) {
                  return { count, debugInfo: [...debugInfo, { selector: '#prod-review-nav-link (괄호 패턴)', found: true, text: parentText.substring(0, 80), extracted: count }] };
                }
              }
            }
          }
          
          // 셀렉터로 찾지 못한 경우, 페이지 전체에서 리뷰수 관련 텍스트 검색
          const allElements = document.querySelectorAll('*');
          let foundCount = 0;
          for (const el of Array.from(allElements)) {
            const text = el.textContent?.trim() || '';
            if ((text.includes('상품평') || text.includes('리뷰')) && /[\d,]+/.test(text) && text.length < 100) {
              foundCount++;
              
              // 괄호 패턴 우선 시도
              const bracketPattern = /\((\d{1,3}(?:,\d{3})*)\)/;
              const bracketMatch = text.match(bracketPattern);
              if (bracketMatch && bracketMatch[1]) {
                const count = parseInt(bracketMatch[1].replace(/,/g, ''), 10);
                if (count > 0 && count < 10000000) {
                  return { count, debugInfo: [...debugInfo, { selector: '전체 검색 (괄호)', found: true, text: text.substring(0, 80), extracted: count }] };
                }
              }
              
              const pattern1 = /(\d{1,3}(?:,\d{3})*)\s*(?:<!--\s*-->)?\s*(?:<!--\s*-->)?\s*개\s*상품평/;
              const match1 = text.match(pattern1);
              if (match1 && match1[1]) {
                const count = parseInt(match1[1].replace(/,/g, ''), 10);
                if (count > 0 && count < 10000000) {
                  return { count, debugInfo: [...debugInfo, { selector: '전체 검색', found: true, text: text.substring(0, 80), extracted: count }] };
                }
              }
              
              const numberMatch = text.match(/^(\d{1,3}(?:,\d{3})*)/);
              if (numberMatch && numberMatch[1]) {
                const count = parseInt(numberMatch[1].replace(/,/g, ''), 10);
                if (count > 0 && count < 10000000 && count > 10) {
                  return { count, debugInfo: [...debugInfo, { selector: '전체 검색', found: true, text: text.substring(0, 80), extracted: count }] };
                }
              }
            }
          }
          
          return { count: 0, debugInfo };
        });
        
        reviewCount = extractionResult.count;
        
        // 디버깅 정보 출력 (항상 출력하여 문제 파악)
        if (retryCount === 0) {
          console.log('🔍 리뷰수 추출 디버깅 정보:');
          extractionResult.debugInfo.forEach((info: any) => {
            if (info.found) {
              console.log(`  [${info.selector}] textContent: "${info.text || ''}", innerText: "${info.innerText || ''}"`);
              if (info.extracted) {
                console.log(`    ✅ 추출된 값: ${info.extracted}개`);
              } else {
                console.log(`    ❌ 추출 실패 (패턴 매칭 안됨)`);
              }
            } else {
              console.log(`  [${info.selector}] 요소 없음`);
            }
          });
          
          if (reviewCount > 0 && reviewCount < 10) {
            console.warn(`⚠️ 주의: 리뷰수가 ${reviewCount}개로 추출되었습니다. 평점(4.5점 등)이 잘못 추출되었을 수 있습니다.`);
          }
        }
        
        if (reviewCount === 0 && retryCount < maxRetries - 1) {
          retryCount++;
          console.log(`⚠️ 리뷰수 추출 실패, ${retryCount * 0.5}초 후 재시도... (${retryCount}/${maxRetries})`);
          await page.waitForTimeout(500 * retryCount); // 재시도마다 대기 시간 증가 (더 빠르게)
        } else {
          break;
        }
      }
      
      if (reviewCount > 0) {
        console.log(`📊 리뷰수 추출 (옵션 선택 전): ${reviewCount}개`);
      } else {
        console.warn('⚠️ 리뷰수를 추출하지 못했습니다. (0개)');
      }
    } catch (e) {
      console.warn('⚠️ 리뷰수 추출 실패:', e);
    }
    
    // 장바구니 담기 버튼 클릭 (옵션 선택 전, 4가지 방법 순차 시도)
    try {
      await page.waitForTimeout(800); // 버튼 로드 대기
      const cartSelectors = [
        { type: 'selector', value: '.prod-cart-btn' },
        { type: 'selector', value: '[data-gaclick*="cart"]' },
        { type: 'selector', value: 'button[data-gaclick]' },
        { type: 'text', value: '장바구니 담기' },
      ];
      let cartClicked = false;
      for (const { type, value } of cartSelectors) {
        try {
          if (type === 'selector') {
            const btn = await page.$(value);
            if (btn) {
              await btn.scrollIntoViewIfNeeded();
              await page.waitForTimeout(200);
              await btn.click();
              cartClicked = true;
              console.log(`✅ 장바구니 담기 클릭 완료 (셀렉터: ${value})`);
              break;
            }
          } else {
            const clicked = await page.evaluate((text) => {
              const els = Array.from(document.querySelectorAll('button, a, [role="button"], .prod-cart-btn, [class*="cart"]'));
              const el = els.find((e) => (e.textContent || '').trim().includes(text));
              if (el && !(el as HTMLElement).hasAttribute('disabled')) {
                (el as HTMLElement).click();
                return true;
              }
              return false;
            }, value);
            if (clicked) {
              cartClicked = true;
              console.log(`✅ 장바구니 담기 클릭 완료 (텍스트: ${value})`);
              break;
            }
          }
        } catch {
          continue;
        }
      }
      if (cartClicked) {
        await page.waitForTimeout(600); // 담기 처리·모달 표시 대기
        // 장바구니 담기 모달의 X(닫기) 버튼 클릭
        try {
          await page.waitForTimeout(400); // 모달 애니메이션 대기
          const closeSelectors = [
            '[aria-label="닫기"]',
            '[aria-label="Close"]',
            '.modal-close',
            '.popup-close',
            '[class*="modal"] button[class*="close"]',
            '[class*="Modal"] button',
            'button[class*="close"]',
            '.cart-modal button[aria-label]',
            '[class*="cart"] [class*="close"]',
          ];
          let modalClosed = false;
          for (const sel of closeSelectors) {
            try {
              const closeBtn = await page.$(sel);
              if (closeBtn) {
                await closeBtn.scrollIntoViewIfNeeded();
                await page.waitForTimeout(150);
                await closeBtn.click();
                modalClosed = true;
                console.log('✅ 장바구니 모달 X(닫기) 클릭 완료');
                break;
              }
            } catch {
              continue;
            }
          }
          if (!modalClosed) {
            // X 아이콘만 있는 버튼 (텍스트가 없거나 'X' 형태)
            const clicked = await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button, [role="button"], a[href="#"]'));
              const closeBtn = buttons.find((b) => {
                const t = (b.textContent || '').trim();
                return t === '×' || t === 'X' || t === '✕' || t === '닫기' || (t.length <= 2 && b.closest('[class*="modal"], [class*="popup"], [class*="Modal"]'));
              });
              if (closeBtn) {
                (closeBtn as HTMLElement).click();
                return true;
              }
              return false;
            });
            if (clicked) console.log('✅ 장바구니 모달 X(닫기) 클릭 완료');
            else console.log('⚠️ 모달 닫기 버튼을 찾지 못했습니다. (스킵)');
          }
          await page.waitForTimeout(300); // 모달 닫힘 대기
        } catch (e) {
          console.warn('⚠️ 모달 닫기 실패 (스킵):', (e as Error).message);
        }
      } else {
        console.log('⚠️ 장바구니 담기 버튼을 찾지 못했습니다. (스킵)');
      }
    } catch (e) {
      console.warn('⚠️ 장바구니 담기 클릭 실패 (스킵):', (e as Error).message);
    }
    
    // 옵션 선택 버튼 클릭 시도 (드롭다운 열기)
    try {
      // 옵션 선택 버튼 찾기 (여러 셀렉터 시도)
      const optionSelectors = [
        '.option-picker-select .twc-cursor-pointer',
        '.option-picker-select div[class*="cursor-pointer"]',
        '[class*="option-picker"] [class*="cursor-pointer"]',
      ];
      
      let optionBtnClicked = false;
      for (const selector of optionSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn) {
            await btn.scrollIntoViewIfNeeded();
            await page.waitForTimeout(200); // 대기 시간 단축
            await btn.click();
            await page.waitForTimeout(500); // 드롭다운 열림 대기 (단축)
            console.log(`✅ 옵션 선택 버튼 클릭 완료 (셀렉터: ${selector})`);
            optionBtnClicked = true;
            break;
          }
        } catch (e) {
          // 다음 셀렉터 시도
          continue;
        }
      }
      
      if (!optionBtnClicked) {
        console.log('⚠️ 옵션 선택 버튼을 찾을 수 없습니다. 기본 옵션만 추출합니다.');
      }
    } catch (e) {
      console.warn('⚠️ 옵션 선택 버튼 클릭 실패:', e);
    }
    
    // "모든 옵션 보기" 버튼 클릭 시도 (기존 팝업 방식)
    try {
      const allOptionsBtn = await page.$('.option-table-list__see-all-btn');
      if (allOptionsBtn) {
        await allOptionsBtn.click();
        await page.waitForTimeout(500); // 팝업 열림 대기 (단축)
        console.log('✅ "모든 옵션 보기" 버튼 클릭 완료');
      }
    } catch (e) {
      // 무시 (새로운 구조에서는 없을 수 있음)
    }
    
    // 데이터 추출 (옵션 선택 전에 추출한 리뷰수 전달)
    const data = await page.evaluate((preExtractedReviewCount) => {
      const result: ProductInfo = {
        imageUrl: null,
        totalOptions: 0,
        soldoutOptions: 0,
        price: null,
        priceSale: null,
        reviewCount: preExtractedReviewCount || 0, // 옵션 선택 전에 추출한 리뷰수만 사용 (옵션 선택 후에는 추출하지 않음)
      };
      
      // 옵션 선택 전에 리뷰수를 이미 추출했으면 여기서는 추출하지 않음 (정확도 보장)
      const shouldExtractReviewCount = preExtractedReviewCount === 0;
      
      // 1. 이미지 추출 (사용자 제공 셀렉터)
      const img = document.querySelector('img.twc-w-full.twc-max-h-\\[546px\\]') as HTMLImageElement;
      if (img?.src) {
        let imageUrl = img.src;
        // 프로토콜 상대 URL 처리
        if (imageUrl.startsWith('//')) {
          imageUrl = `https:${imageUrl}`;
        }
        result.imageUrl = imageUrl;
      }
      
      // 2. 쿠팡 판매가 추출
      const salesPriceEl = document.querySelector('.sales-price .price-amount.sales-price-amount');
      if (salesPriceEl) {
        const text = salesPriceEl.textContent?.trim() || '';
        const priceText = text.replace(/[^0-9]/g, '');
        if (priceText) {
          result.price = parseInt(priceText, 10);
        }
      }
      
      // 3. 할인 판매가 추출
      const finalPriceEl = document.querySelector('.final-price .price-amount.final-price-amount');
      if (finalPriceEl) {
        const text = finalPriceEl.textContent?.trim() || '';
        const priceText = text.replace(/[^0-9]/g, '');
        if (priceText) {
          result.priceSale = parseInt(priceText, 10);
        }
      }
      
      // 4. 옵션 수 및 품절 옵션 수 추출 (coupang-inventory-scraper 로직 참고)
      let totalOptions = 0;
      let soldoutOptions = 0;

      // 방법 1: 새로운 옵션 구조 (ul.custom-scrollbar > li 구조) - 우선순위 1
      // ul.custom-scrollbar 안의 li 요소만 찾기 (중복 방지)
      const optionList = document.querySelector('ul.custom-scrollbar');
      
      if (optionList) {
        // li 요소만 직접 찾기 (자식 요소 제외)
        const optionItems = optionList.querySelectorAll(':scope > li');
        
        if (optionItems.length > 0) {
          optionItems.forEach((item) => {
            // li 안의 .select-item에서 텍스트 추출
            const selectItem = item.querySelector('.select-item');
            const text = selectItem ? selectItem.textContent?.trim() || '' : item.textContent?.trim() || '';
            const classes = item.className || '';
            
            // 옵션인지 확인
            const hasPrice = /\d+원/.test(text);
            const hasOptionPattern = /×/.test(text); // "×" 문자가 있어야 함
            const hasValidContent = text.length > 10;
            
            // 헤더 제외 ("색상 × 사이즈 × 수량" 제외)
            const isNotHeader = !text.includes('옵션 선택') && 
                               !text.includes('색상 × 사이즈 × 수량') &&
                               item.tagName !== 'BUTTON';
            
            if (hasPrice && hasOptionPattern && hasValidContent && isNotHeader) {
              totalOptions++;
              
              // 품절 확인 (품절임박은 품절이 아님!)
              const isSoldout = 
                classes.includes('soldout') ||
                classes.includes('sold-out') ||
                classes.includes('disabled') ||
                (text.includes('품절') && !text.includes('품절임박')) ||
                text.includes('일시품절');
              
              if (isSoldout) {
                soldoutOptions++;
              }
            }
          });
          
          if (totalOptions > 0) {
            console.log(`✅ 새로운 구조에서 옵션 ${totalOptions}개 추출 (품절: ${soldoutOptions}개)`);
          }
        }
      }
      
      // 방법 2: 기존 옵션 팝업 구조 (위에서 찾지 못한 경우)
      if (totalOptions === 0) {
        const optionPopup = document.querySelector('.option-table__popup--visible, .option-table__popup');
        if (optionPopup) {
          console.log('✅ 옵션 팝업 발견, 내부 옵션 개수 확인 중...');
          
          // 정확한 옵션 아이템 찾기 (.option-table__popup__option-item__main)
          const optionItems = optionPopup.querySelectorAll('.option-table__popup__option-item__main');
          
          if (optionItems.length > 0) {
            optionItems.forEach((item) => {
              const text = item.textContent?.trim() || '';
              const classes = item.className || '';
              
              // 옵션으로 인정 (이미 정확한 구조이므로 모두 옵션)
              totalOptions++;
              
              // 품절 확인
              const isSoldout = 
                classes.includes('soldout') ||
                classes.includes('sold-out') ||
                classes.includes('disabled') ||
                (text.includes('품절') && !text.includes('품절임박')) ||
                text.includes('일시품절') ||
                item.querySelector('[class*="soldout"]') ||
                item.querySelector('[class*="disabled"]');
              
              if (isSoldout) {
                soldoutOptions++;
              }
            });
            
            console.log(`✅ 옵션 팝업에서 옵션 ${totalOptions}개 추출 (품절: ${soldoutOptions}개)`);
          } else {
            // 기존 방식으로 폴백
            const optionSelectors = [
              '.option-table__popup tbody tr',
              '.option-table__popup tr:not(:first-child)',
              '.option-table__popup [class*="option-row"]:not([class*="header"])',
              '.option-table__popup [class*="option-item"]',
            ];
            
            let optionRows: NodeListOf<Element> | null = null;
            for (const selector of optionSelectors) {
              const rows = optionPopup.querySelectorAll(selector);
              if (rows.length > 0) {
                console.log(`✅ 셀렉터 "${selector}"로 ${rows.length}개 옵션 행 발견`);
                optionRows = rows;
                break;
              }
            }
            
            // 셀렉터로 찾지 못한 경우, 직접 확인
            if (!optionRows || optionRows.length === 0) {
              // 팝업 내 모든 tr, li, div를 확인하되, 실제 옵션만 필터링
              const allElements = optionPopup.querySelectorAll('tr, li, div');
              const validOptions: Element[] = [];
              
              allElements.forEach((element) => {
                const text = element.textContent?.trim() || '';
                const classes = element.className || '';
                
                // 실제 옵션인지 확인:
                // 1. "× N개" 패턴이 있고
                // 2. 가격 정보가 있고 (예: "6,650원")
                // 3. 너무 긴 텍스트가 아니고 (헤더/설명 제외)
                // 4. 버튼이나 헤더가 아님
                const hasOptionPattern = /\s×\s*\d+개/.test(text);
                const hasPrice = /\d+원/.test(text);
                const isReasonableLength = text.length > 20 && text.length < 300;
                const isNotHeader = !text.includes('옵션 선택') && 
                                   !text.includes('전체') && 
                                   !classes.includes('header') &&
                                   element.tagName !== 'BUTTON';
                
                if (hasOptionPattern && hasPrice && isReasonableLength && isNotHeader) {
                  // 중복 체크: 같은 부모 내에서 이미 추가된 옵션이 아닌지 확인
                  const parent = element.parentElement;
                  const isDuplicate = validOptions.some(opt => {
                    return opt === element || 
                           (parent && opt.parentElement === parent && opt.textContent === text);
                  });
                  
                  if (!isDuplicate) {
                    validOptions.push(element);
                    
                    // 품절 확인
                    const isSoldout = 
                      classes.includes('soldout') ||
                      classes.includes('sold-out') ||
                      classes.includes('disabled') ||
                      text.includes('품절') ||
                      text.includes('일시품절') ||
                      text.includes('품절임박') ||
                      element.querySelector('[class*="soldout"]') ||
                      element.querySelector('[class*="disabled"]');
                    
                    if (isSoldout) {
                      soldoutOptions++;
                    }
                  }
                }
              });
              
              if (validOptions.length > 0) {
                console.log(`✅ 필터링된 실제 옵션: ${validOptions.length}개`);
                totalOptions = validOptions.length;
              }
            } else {
              // 셀렉터로 찾은 행들 처리 (헤더 제외 및 필터링)
              const validOptionRows: Element[] = [];
              
              // 첫 번째 행은 헤더일 가능성이 높으므로 제외
              const rowsArray = Array.from(optionRows);
              
              rowsArray.forEach((row, index) => {
                // 첫 번째 행은 헤더로 간주하고 제외
                if (index === 0) {
                  return;
                }
                const text = row.textContent?.trim() || '';
                const classes = row.className || '';
                
                // 헤더 행 제외 조건 (더 엄격하게)
                const isHeader = 
                  text.includes('옵션 선택') ||
                  text.includes('전체') ||
                  text.includes('옵션명') ||
                  text.includes('가격') ||
                  text.includes('수량') ||
                  text.includes('재고') ||
                  text.includes('상태') ||
                  classes.includes('header') ||
                  classes.includes('thead') ||
                  classes.includes('table-header') ||
                  row.tagName === 'TH' ||
                  row.querySelector('th') !== null ||
                  (!text.includes('원') && !text.includes('×') && text.length < 15);
                
                // 실제 옵션인지 확인 (더 엄격한 조건)
                // 가격 정보가 반드시 있어야 함 (예: "10,000원", "10000원")
                const hasPrice = /[\d,]+원/.test(text);
                // 옵션 정보가 있어야 함 (예: "× 1개", "1개", 옵션명 등)
                const hasOptionPattern = /\s×\s*\d+개/.test(text) || /\d+개/.test(text) || text.length > 20;
                // 최소한의 정보가 있어야 함
                const hasValidContent = text.length > 15;
                
                // 헤더가 아니고 실제 옵션인 경우만 추가
                // 가격 정보가 반드시 있어야 하고, 옵션 패턴이나 충분한 텍스트가 있어야 함
                if (!isHeader && hasPrice && hasOptionPattern && hasValidContent) {
                  validOptionRows.push(row);
                  
                  // 품절 확인
                  const isSoldout = 
                    classes.includes('soldout') ||
                    classes.includes('sold-out') ||
                    classes.includes('disabled') ||
                    (text.includes('품절') && !text.includes('품절임박')) ||
                    text.includes('일시품절') ||
                    row.querySelector('[class*="soldout"]') ||
                    row.querySelector('[class*="disabled"]');
                  
                  if (isSoldout) {
                    soldoutOptions++;
                  }
                }
              });
              
              totalOptions = validOptionRows.length;
              console.log(`✅ 필터링된 옵션: ${totalOptions}개 (원본: ${optionRows.length}개, 품절: ${soldoutOptions}개)`);
            }
          }
        }
      }
      
      // 방법 3: 기본 페이지에서 옵션 찾기 (위에서 찾지 못한 경우)
      if (totalOptions === 0) {
        console.log('⚠️ 팝업/새 구조에서 옵션을 찾지 못함, 기본 페이지에서 검색...');
        
        const optionSelectors = [
          'ul.custom-scrollbar li', // 새로운 구조
          '.option-picker-select ul li', // 새로운 구조
          '.select-item', // 새로운 구조
          'li.prod-option__item',
          '.prod-option__item',
          '.prod-option-item',
          '.option-item',
          '[class*="option"] li',
        ];
        
        for (const selector of optionSelectors) {
          const options = document.querySelectorAll(selector);
          if (options.length > 0) {
            const validOptions: Element[] = [];
            
            options.forEach(opt => {
              const text = opt.textContent?.trim() || '';
              const classes = opt.className || '';
              
              // 실제 옵션인지 확인
              const hasPrice = /\d+원/.test(text);
              const hasOptionPattern = /×/.test(text) || text.length > 15;
              const hasValidContent = text.length > 10;
              const isNotHeader = !text.includes('옵션 선택') && 
                                 !text.includes('색상 × 사이즈 × 수량') &&
                                 opt.tagName !== 'BUTTON';
              
              if (hasPrice && hasOptionPattern && hasValidContent && isNotHeader) {
                validOptions.push(opt);
                
                // 품절 확인 (품절임박은 품절이 아님)
                const isSoldout = 
                  classes.includes('soldout') ||
                  classes.includes('sold-out') ||
                  classes.includes('disabled') ||
                  (text.includes('품절') && !text.includes('품절임박')) ||
                  text.includes('일시품절');
                
                if (isSoldout) {
                  soldoutOptions++;
                }
              }
            });
            
            if (validOptions.length > totalOptions) {
              totalOptions = validOptions.length;
            }
          }
        }
      }

      result.totalOptions = totalOptions;
      result.soldoutOptions = soldoutOptions;
      
      // 5. 리뷰수 추출 (옵션 선택 전에 추출하지 못한 경우에만 폴백)
      // shouldExtractReviewCount가 true이고 result.reviewCount가 0인 경우만 추출
      // 옵션 선택 전에 이미 추출한 값이 있으면 덮어쓰지 않음 (정확도 보장)
      if (shouldExtractReviewCount && result.reviewCount === 0) {
        // 정확한 셀렉터 우선 시도
        const selectors = [
          '#prod-review-nav-link .rating-count-txt',
          'a[href="#sdpReview"] .rating-count-txt',
          '.review-atf .rating-count-txt',
          '.rating-count-txt',
          '.rating-count',
          '[class*="rating-count"]',
          '[class*="review-count"]',
        ];
        
        for (const selector of selectors) {
          const reviewEl = document.querySelector(selector);
          if (reviewEl) {
            const text = reviewEl.textContent?.trim() || '';
            const innerText = (reviewEl as HTMLElement).innerText?.trim() || '';
            const textsToCheck = [innerText, text].filter(t => t.length > 0);
            
            for (const targetText of textsToCheck) {
              // 패턴 1: "숫자개 상품평" 또는 "숫자<!-- --> <!-- -->개 상품평"
              const pattern1 = /(\d{1,3}(?:,\d{3})*)\s*(?:<!--\s*-->)?\s*(?:<!--\s*-->)?\s*개\s*상품평/;
              const match1 = targetText.match(pattern1);
              if (match1 && match1[1]) {
                const count = parseInt(match1[1].replace(/,/g, ''), 10);
                if (count > 0) {
                  result.reviewCount = count;
                  break;
                }
              }
              
              // 패턴 2: "숫자개 리뷰"
              const pattern2 = /(\d{1,3}(?:,\d{3})*)\s*(?:<!--\s*-->)?\s*(?:<!--\s*-->)?\s*개\s*리뷰/;
              const match2 = targetText.match(pattern2);
              if (match2 && match2[1]) {
                const count = parseInt(match2[1].replace(/,/g, ''), 10);
                if (count > 0) {
                  result.reviewCount = count;
                  break;
                }
              }
              
              // 패턴 3: "상품평" 또는 "리뷰"가 포함된 경우, "개" 단위가 있는 숫자만 추출 (평점 제외)
              if (targetText.includes('상품평') || targetText.includes('리뷰')) {
                // "개" 단위가 있는 숫자만 추출 (평점 등 다른 숫자 제외)
                const numberWithUnitMatch = targetText.match(/(\d{1,3}(?:,\d{3})*)\s*개\s*(?:상품평|리뷰)/);
                if (numberWithUnitMatch && numberWithUnitMatch[1]) {
                  const count = parseInt(numberWithUnitMatch[1].replace(/,/g, ''), 10);
                  if (count > 0) {
                    result.reviewCount = count;
                    break;
                  }
                }
                
                // "개" 단위가 없지만, 텍스트가 숫자로 시작하고 "상품평" 또는 "리뷰"로 끝나는 경우만 추출
                const simpleMatch = targetText.match(/^(\d{1,3}(?:,\d{3})*)\s+(?:상품평|리뷰)/);
                if (simpleMatch && simpleMatch[1]) {
                  const count = parseInt(simpleMatch[1].replace(/,/g, ''), 10);
                  if (count > 0 && count > 10) { // 10 이상인 경우만 (평점 4.5점 같은 경우 제외)
                    result.reviewCount = count;
                    break;
                  }
                }
              }
            }
            
            if (result.reviewCount > 0) {
              break;
            }
          }
        }
      }
      
      return result;
    }, reviewCount); // 옵션 선택 전에 추출한 리뷰수 전달
    
    // 리뷰수 최종 결정: 옵션 선택 전 값이 있으면 우선 사용, 없으면 evaluate 내부에서 추출한 값 사용
    if (reviewCount > 0) {
      // 옵션 선택 전에 추출한 값이 있으면 그것을 사용 (더 정확함)
      data.reviewCount = reviewCount;
    } else if (data.reviewCount > 0) {
      // 옵션 선택 전 추출 실패했지만 evaluate 내부에서 추출 성공한 경우
      console.log(`📊 리뷰수 추출 (옵션 선택 후 폴백): ${data.reviewCount}개`);
    }
    
    console.log(`✅ 상품 정보 추출 완료:`, {
      이미지: data.imageUrl ? '있음' : '없음',
      옵션수: data.totalOptions,
      품절옵션: data.soldoutOptions,
      쿠팡판매가: data.price,
      할인판매가: data.priceSale,
      리뷰수: data.reviewCount,
    });
    
    return data;
    
  } catch (error: any) {
    console.error(`❌ 상품 정보 추출 실패: ${error.message}`);
    // 실패해도 기본값 반환
    return {
      imageUrl: null,
      totalOptions: 0,
      soldoutOptions: 0,
      price: null,
      priceSale: null,
      reviewCount: 0,
    };
  }
}

/**
 * Access Denied 에러 체크 함수
 */
async function checkAccessDenied(page: Page): Promise<boolean> {
  try {
    const pageTitle = await page.title();
    const pageContent = await page.content();
    const pageUrl = page.url();
    
    return (
      pageTitle.includes('Access Denied') ||
      pageContent.includes('Access Denied') ||
      pageContent.includes('Reference #') ||
      pageContent.includes('errors.edgesuite.net') ||
      pageUrl.includes('errors.edgesuite.net') ||
      pageUrl.includes('access-denied')
    );
  } catch {
    return false;
  }
}

/**
 * 작업 완료 후 브라우저 컨텍스트 쿠키·캐시 초기화
 */
async function clearContextCookiesAndCache(context: any): Promise<void> {
  try {
    if (context && typeof context.clearCookies === 'function') {
      await context.clearCookies();
      console.log('🧹 쿠키/캐시 삭제 완료');
    }
  } catch (_) {
    // 무시
  }
}

/**
 * 쿠팡에서 상품 순위 검색 (Access Denied 재시도 로직 포함)
 * @param windowIndex 창 인덱스 (0 또는 1) - 창 위치 결정
 * @param rankOnly true면 상세 진입(extractProductInfo) 없이 순위만 반환 (무료용)
 */
async function searchCoupangRank(
  keyword: string,
  linkUrl: string | null,
  retryCount: number = 0,
  windowIndex: number = 0,
  rankOnly: boolean = false
): Promise<SearchResult> {
  const MAX_RETRIES = 10;
  let browser: Browser | null = null;
  let context: any = null;
  
  try {
    if (retryCount > 0) {
      console.log(`🔄 [창${windowIndex + 1}] 재시도 ${retryCount}/${MAX_RETRIES}: "${keyword}"`);
    } else {
      console.log(`🔍 [창${windowIndex + 1}] 쿠팡 순위 검색 시작: "${keyword}"`);
    }
    
    // URL에서 상품번호 추출
    const targetProductId = extractProductId(linkUrl);
    if (!targetProductId) {
      throw new Error(`URL에서 상품번호를 추출할 수 없습니다: ${linkUrl}`);
    }
    
    console.log(`🎯 [창${windowIndex + 1}] 타겟 상품번호: ${targetProductId}`);
    
    // 창 위치 계산 (1920x1080 화면 기준)
    // 창 1: x=0, width=710
    // 창 2: x=710, width=710
    // CMD 창: x=1420부터 (오른쪽)
    const windowWidth = 710;
    const windowHeight = 1080;
    const windowX = windowIndex * windowWidth;
    const windowY = 0;
    
    // 브라우저 실행
    try {
      browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
        args: [
          `--window-size=${windowWidth},${windowHeight}`,
          `--window-position=${windowX},${windowY}`,
        ],
      });
      console.log(`✅ [창${windowIndex + 1}] Chrome 브라우저 실행 성공 (위치: ${windowX},${windowY}, 크기: ${windowWidth}x${windowHeight})`);
    } catch (chromeError) {
      console.warn(`⚠️ [창${windowIndex + 1}] Chrome 채널 실행 실패, 기본 Chromium 사용`);
      browser = await chromium.launch({
        headless: false,
        args: [
          `--window-size=${windowWidth},${windowHeight}`,
          `--window-position=${windowX},${windowY}`,
        ],
      });
    }

    context = await browser.newContext({
      viewport: { width: windowWidth, height: windowHeight },
    });

    const page = await context.newPage();
    
    // 브라우저 창 위치 조정 시도 (JavaScript 사용)
    try {
      // 첫 페이지에서 창 위치 조정 시도
      await page.evaluateOnNewDocument((x, y, width, height) => {
        // 브라우저 창 위치 조정 (일부 브라우저에서만 작동)
        if (window.moveTo) {
          try {
            window.moveTo(x, y);
            window.resizeTo(width, height);
          } catch (e) {
            // 보안 정책으로 인해 실패할 수 있음
          }
        }
      }, windowX, windowY, windowWidth, windowHeight);
      
      // 추가로 CDP를 통한 창 위치 설정 시도
      try {
        const cdpSession = await context.cdpSession();
        if (cdpSession) {
          // Chrome DevTools Protocol을 통한 창 위치 설정
          const pages = await browser.pages();
          if (pages.length > 0) {
            const target = pages[0].target();
            if (target) {
              try {
                const result: any = await cdpSession.send('Browser.getWindowForTarget', {
                  targetId: (target as any)._targetId || (target as any).targetId
                });
                if (result && result.windowId) {
                  await cdpSession.send('Browser.setWindowBounds', {
                    windowId: result.windowId,
                    bounds: {
                      left: windowX,
                      top: windowY,
                      width: windowWidth,
                      height: windowHeight,
                    },
                  });
                  console.log(`✅ [창${windowIndex + 1}] 창 위치 자동 설정 성공`);
                }
              } catch (cdpError) {
                // CDP 실패는 무시
              }
            }
          }
        }
      } catch (cdpError) {
        // CDP 실패는 무시 (일부 브라우저에서 지원하지 않음)
      }
    } catch (posError) {
      // 창 위치 설정 실패는 무시하고 계속 진행
      console.warn(`⚠️ [창${windowIndex + 1}] 창 위치 자동 설정 실패 (수동 배치 필요): ${posError}`);
      console.log(`💡 [창${windowIndex + 1}] 창을 수동으로 배치해주세요: 위치(${windowX}, ${windowY}), 크기(${windowWidth}x${windowHeight})`);
    }

    // 1. 쿠팡 메인 페이지 방문 (최대한 빠르게)
    try {
      console.log('🏠 쿠팡 메인 페이지 방문 중...');
      await page.goto('https://www.coupang.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 8000,
      });
      await page.waitForTimeout(300); // 딜레이 최소화
      
      // Access Denied 체크
      if (await checkAccessDenied(page)) {
        throw new Error('Access Denied: 쿠팡 메인 페이지에서 봇 차단이 감지되었습니다.');
      }
      
      console.log('✅ 메인 페이지 방문 완료');
    } catch (e: any) {
      if (e.message && e.message.includes('Access Denied')) {
        // 브라우저 정리 (쿠키·캐시 초기화 후 종료)
        if (context) { await clearContextCookiesAndCache(context); await context.close(); }
        if (browser) await browser.close();
        
        // 재시도 로직
        if (retryCount < MAX_RETRIES) {
          const retryDelay = 3000 + Math.random() * 2000; // 3~5초 대기
          console.log(`⏳ [창${windowIndex + 1}] ${Math.round(retryDelay / 1000)}초 후 재시도합니다...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return searchCoupangRank(keyword, linkUrl, retryCount + 1, windowIndex);
        } else {
          console.error(`❌ [창${windowIndex + 1}] 최대 재시도 횟수(${MAX_RETRIES}) 초과. Access Denied 에러로 인해 중단합니다.`);
          return { 
            success: false, 
            rank: null, 
            error: 'Access Denied: 최대 재시도 횟수 초과',
            isAccessDenied: true 
          };
        }
      }
      console.warn(`⚠️ [창${windowIndex + 1}] 메인 페이지 방문 실패, 계속 진행:`, e?.message || e);
    }

    // 2. 키워드로 검색 (최대한 빠르게)
    console.log(`🔍 [창${windowIndex + 1}] 키워드로 검색: "${keyword}"`);
    const searchUrl = `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}`;
    
    try {
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(500 + Math.random() * 500); // 0.5-1초 랜덤 대기
      
      // Access Denied 체크
      if (await checkAccessDenied(page)) {
        // 브라우저 정리 (쿠키·캐시 초기화 후 종료)
        if (context) { await clearContextCookiesAndCache(context); await context.close(); }
        if (browser) await browser.close();
        
        // 재시도 로직
        if (retryCount < MAX_RETRIES) {
          const retryDelay = 3000 + Math.random() * 2000; // 3~5초 대기
          console.log(`⏳ [창${windowIndex + 1}] ${Math.round(retryDelay / 1000)}초 후 재시도합니다...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return searchCoupangRank(keyword, linkUrl, retryCount + 1, windowIndex);
        } else {
          console.error(`❌ [창${windowIndex + 1}] 최대 재시도 횟수(${MAX_RETRIES}) 초과. Access Denied 에러로 인해 중단합니다.`);
          return { 
            success: false, 
            rank: null, 
            error: 'Access Denied: 최대 재시도 횟수 초과',
            isAccessDenied: true 
          };
        }
      }
      
      console.log(`✅ [창${windowIndex + 1}] 검색 결과 페이지 로드 완료`);
      
      // 3. 검색 결과에서 상품 순위 찾기
      console.log(`🔗 [창${windowIndex + 1}] 검색 결과에서 상품 순위 찾기: ${targetProductId}`);
      
      let foundRank: number | null = null;
      let allProducts: string[] = []; // 순서 보장 배열
      let allProductsSet = new Set<string>(); // 중복 체크용
      let pageNumber = 1;
      const maxPages = 30; // 최대 30페이지 탐색
      
      while (pageNumber <= maxPages && !foundRank) {
        const currentSearchUrl = pageNumber === 1 
          ? searchUrl 
          : `${searchUrl}&page=${pageNumber}`;
        
        if (pageNumber > 1) {
          try {
            await page.goto(currentSearchUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 8000,
            });
            await page.waitForTimeout(300); // 페이지 전환 딜레이 최소화
            
            // Access Denied 체크
            if (await checkAccessDenied(page)) {
              // 브라우저 정리 (쿠키·캐시 초기화 후 종료)
              if (context) { await clearContextCookiesAndCache(context); await context.close(); }
              if (browser) await browser.close();
              
              // 재시도 로직
              if (retryCount < MAX_RETRIES) {
                const retryDelay = 3000 + Math.random() * 2000; // 3~5초 대기
                console.log(`⏳ [창${windowIndex + 1}] ${Math.round(retryDelay / 1000)}초 후 재시도합니다...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                return searchCoupangRank(keyword, linkUrl, retryCount + 1, windowIndex);
              } else {
                console.error(`❌ [창${windowIndex + 1}] 최대 재시도 횟수(${MAX_RETRIES}) 초과. Access Denied 에러로 인해 중단합니다.`);
                return { 
                  success: false, 
                  rank: null, 
                  error: 'Access Denied: 최대 재시도 횟수 초과',
                  isAccessDenied: true 
                };
              }
            }
          } catch (pageError: any) {
            // 2페이지 이상 접속 실패 감지
            console.warn(`⚠️ [창${windowIndex + 1}] 페이지 ${pageNumber} 접속 실패: ${pageError.message}`);
            // 브라우저 정리 (쿠키·캐시 초기화 후 종료)
            if (context) { await clearContextCookiesAndCache(context); await context.close(); }
            if (browser) await browser.close();
            
            // 2페이지 이상 접속 실패로 표시
            return {
              success: false,
              rank: null,
              error: `페이지 ${pageNumber} 접속 실패: ${pageError.message}`,
              pageAccessFailed: true,
              maxPageReached: pageNumber - 1
            };
          }
        }
        
        console.log(`📄 [창${windowIndex + 1}] 페이지 ${pageNumber} 탐색 중...`);
        
        // 페이지 로드 대기 (검색 결과가 동적으로 로드될 수 있음)
        if (pageNumber === 1) {
          // 첫 페이지는 이미 로드되었지만, 상품 목록이 동적으로 로드될 수 있으므로 추가 대기
          await page.waitForTimeout(1500);
        } else {
          // 2페이지 이상은 페이지 전환 후 상품 목록 로드 대기
          await page.waitForTimeout(1500);
        }
        
        // 페이지에서 상품 추출 (더 많은 셀렉터 시도)
        const pageProducts = await page.evaluate((targetId) => {
          const products: string[] = [];
          
          // 다양한 셀렉터 시도
          const selectors = [
            'a[href*="/vp/products/"]',
            'a[href*="/products/"]',
            'a[data-product-id]',
            '.search-product',
            'li[data-product-id]',
            '[data-product-id]',
            'a[href*="productId="]',
            'a[href*="itemId="]',
          ];
          
          const foundLinks = new Set<string>();
          
          for (const selector of selectors) {
            try {
              const elements = document.querySelectorAll(selector);
              for (const el of Array.from(elements)) {
                const href = (el as HTMLAnchorElement).href || (el as HTMLElement).getAttribute('href') || '';
                const productIdAttr = (el as HTMLElement).getAttribute('data-product-id');
                
                // href에서 상품번호 추출
                if (href) {
                  const match = href.match(/\/(?:vp\/)?products\/(\d+)/);
                  if (match && match[1]) {
                    foundLinks.add(match[1]);
                  }
                  
                  // productId= 또는 itemId= 형식도 시도
                  const paramMatch = href.match(/(?:productId|itemId)=(\d+)/);
                  if (paramMatch && paramMatch[1]) {
                    foundLinks.add(paramMatch[1]);
                  }
                }
                
                // data-product-id 속성에서 추출
                if (productIdAttr) {
                  foundLinks.add(productIdAttr);
                }
              }
            } catch (e) {
              // 셀렉터 실패 시 무시하고 다음 시도
            }
          }
          
          // Set을 배열로 변환
          return Array.from(foundLinks);
        }, targetProductId);
        
        // 디버깅: 상품을 찾지 못한 경우 페이지 구조 확인
        if (pageProducts.length === 0 && pageNumber === 1) {
          const debugInfo = await page.evaluate(() => {
            return {
              totalLinks: document.querySelectorAll('a').length,
              productLinks: document.querySelectorAll('a[href*="/vp/products/"], a[href*="/products/"]').length,
              searchProducts: document.querySelectorAll('.search-product, [data-product-id]').length,
              pageTitle: document.title,
              url: window.location.href,
            };
          });
          
          console.log(`⚠️ [창${windowIndex + 1}] 페이지 1에서 상품 링크를 찾지 못했습니다. 디버깅 정보:`);
          console.log(`   - 전체 링크 수: ${debugInfo.totalLinks}`);
          console.log(`   - 상품 링크 수: ${debugInfo.productLinks}`);
          console.log(`   - 검색 상품 요소 수: ${debugInfo.searchProducts}`);
          console.log(`   - 페이지 제목: ${debugInfo.pageTitle}`);
          console.log(`   - 현재 URL: ${debugInfo.url}`);
        }
        
        // 새로운 상품 추가 (중복 제거, 순서 보장)
        for (const productId of pageProducts) {
          if (!allProductsSet.has(productId)) {
            allProductsSet.add(productId);
            allProducts.push(productId);
            
            // 타겟 상품 찾으면 순위 계산
            if (productId === targetProductId) {
              foundRank = allProducts.length;
              console.log(`🎯 [창${windowIndex + 1}] 타겟 상품 발견! 순위: ${foundRank}위 (${allProducts.length}개 상품 중)`);
              
              let productInfo: ProductInfo | undefined;
              if (!rankOnly) {
                try {
                  console.log(`📸 [창${windowIndex + 1}] 상품 정보 추출 시작...`);
                  productInfo = await extractProductInfo(page, linkUrl!, targetProductId);
                  console.log(`✅ [창${windowIndex + 1}] 상품 정보 추출 완료`);
                } catch (extractError: any) {
                  console.warn(`⚠️ [창${windowIndex + 1}] 상품 정보 추출 실패, 순위만 저장: ${extractError.message}`);
                }
              } else {
                console.log(`📋 [창${windowIndex + 1}] 무료 모드: 순위만 저장 (상세 진입 생략)`);
              }
              
              if (context) {
                await clearContextCookiesAndCache(context);
                await context.close();
              }
              if (browser) {
                await browser.close();
              }
              browser = null;
              context = null;
              
              return { 
                success: true, 
                rank: foundRank,
                productInfo: productInfo
              };
            }
          }
        }
        
        if (foundRank) {
          break;
        }
        
        // 새로운 상품이 없으면 중단
        if (pageProducts.length === 0) {
          if (pageNumber === 1) {
            // 1페이지에서 상품을 찾지 못한 경우는 검색 결과가 없거나 페이지 구조가 변경된 것
            console.log(`⚠️ [창${windowIndex + 1}] 페이지 1에서 상품을 찾을 수 없습니다. 검색 결과가 없거나 페이지 구조가 변경되었을 수 있습니다.`);
          } else {
            console.log(`⚠️ [창${windowIndex + 1}] 페이지 ${pageNumber}에서 상품을 찾을 수 없습니다. 마지막 페이지일 수 있습니다.`);
          }
          break;
        }
        
        console.log(`📦 [창${windowIndex + 1}] 페이지 ${pageNumber}: ${pageProducts.length}개 상품 발견 (총 ${allProducts.length}개)`);
        
        pageNumber++;
      }
      
      // 브라우저 종료 (순위를 찾지 못한 경우) - 쿠키·캐시 초기화 후 종료
      if (browser && context) {
        await clearContextCookiesAndCache(context);
        await context.close();
        await browser.close();
        browser = null;
        context = null;
      }
      
      // 최대 접속한 페이지 번호 기록 (1페이지는 항상 접속했으므로 pageNumber - 1)
      const maxPageReached = pageNumber - 1;
      
      // 2페이지 이상 접속 실패 여부 확인
      // 단, 1페이지에서 상품을 찾지 못한 경우는 검색 결과 문제이지 페이지 접속 실패가 아님
      const pageAccessFailed = maxPageReached < 2 && allProducts.length > 0;
      // 1페이지에서 상품을 찾지 못한 경우 (allProducts.length === 0)는 검색 결과 문제로 간주
      const isSearchResultEmpty = allProducts.length === 0;
      
      if (foundRank) {
        // 이미 순위 찾았으면 위에서 반환됨 (여기 도달하지 않음)
        return { success: true, rank: foundRank, maxPageReached: maxPageReached };
      } else {
        if (isSearchResultEmpty) {
          console.log(`❌ [창${windowIndex + 1}] 검색 결과에서 상품을 찾을 수 없습니다. (검색 결과가 비어있거나 페이지 구조가 변경되었을 수 있습니다)`);
          // 검색 결과가 비어있는 경우는 페이지 접속 실패가 아님
          return { 
            success: true, 
            rank: null, // 상품 미발견도 성공으로 처리 (순위는 null)
            maxPageReached: maxPageReached,
            pageAccessFailed: false // 검색 결과 문제이지 페이지 접속 실패가 아님
          };
        } else {
          console.log(`❌ [창${windowIndex + 1}] 상품을 찾지 못했습니다. (${allProducts.length}개 상품 확인, 최대 ${maxPageReached}페이지 접속)`);
          return { 
            success: true, 
            rank: null, // 상품 미발견도 성공으로 처리 (순위는 null)
            maxPageReached: maxPageReached,
            pageAccessFailed: pageAccessFailed
          };
        }
      }
      
    } catch (searchError: any) {
      console.error(`❌ [창${windowIndex + 1}] 검색 실패: ${searchError.message}`);
      
      // Access Denied 에러인지 확인
      const isAccessDeniedError = 
        searchError.message.includes('Access Denied') ||
        searchError.message.includes('Reference #') ||
        searchError.message.includes('errors.edgesuite.net');
      
      // 브라우저 정리 (쿠키·캐시 초기화 후 종료)
      if (context) { await clearContextCookiesAndCache(context); await context.close(); }
      if (browser) await browser.close();
      
      // Access Denied 에러이고 재시도 가능하면 재시도
      if (isAccessDeniedError && retryCount < MAX_RETRIES) {
        const retryDelay = 3000 + Math.random() * 2000; // 3~5초 대기
        console.log(`⏳ [창${windowIndex + 1}] ${Math.round(retryDelay / 1000)}초 후 재시도합니다...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return searchCoupangRank(keyword, linkUrl, retryCount + 1, windowIndex);
      } else if (isAccessDeniedError) {
        console.error(`❌ [창${windowIndex + 1}] 최대 재시도 횟수(${MAX_RETRIES}) 초과. Access Denied 에러로 인해 중단합니다.`);
        return { 
          success: false, 
          rank: null, 
          error: searchError.message,
          isAccessDenied: true 
        };
      }
      
      // Access Denied 에러인지 다시 한 번 확인 (안전장치)
      const isAccessDeniedInMessage = 
        searchError.message.includes('Access Denied') ||
        searchError.message.includes('Reference #') ||
        searchError.message.includes('errors.edgesuite.net') ||
        searchError.message.includes('권한이 없습니다') ||
        searchError.message.includes('접근할 수 있는 권한이 없습니다');
      
      return { 
        success: false, 
        rank: null, 
        error: searchError.message,
        isAccessDenied: isAccessDeniedInMessage // Access Denied인 경우 true 설정
      };
    }

  } catch (error: any) {
    console.error(`❌ [창${windowIndex + 1}] 쿠팡 순위 검색 중 오류: ${error.message}`);
    
    // Access Denied 에러인지 확인
    const isAccessDeniedError = 
      error.message.includes('Access Denied') ||
      error.message.includes('Reference #') ||
      error.message.includes('errors.edgesuite.net') ||
      error.message.includes('권한이 없습니다') ||
      error.message.includes('접근할 수 있는 권한이 없습니다');
    
    // 브라우저 정리 (쿠키·캐시 초기화 후 종료)
    if (context) { await clearContextCookiesAndCache(context); await context.close(); }
    if (browser) {
      await browser.close();
    }
    
    // Access Denied 에러이고 재시도 가능하면 재시도
    if (isAccessDeniedError && retryCount < MAX_RETRIES) {
      const retryDelay = 3000 + Math.random() * 2000; // 3~5초 대기
      console.log(`⏳ [창${windowIndex + 1}] ${Math.round(retryDelay / 1000)}초 후 재시도합니다...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return searchCoupangRank(keyword, linkUrl, retryCount + 1, windowIndex);
    } else if (isAccessDeniedError) {
      console.error(`❌ [창${windowIndex + 1}] 최대 재시도 횟수(${MAX_RETRIES}) 초과. Access Denied 에러로 인해 중단합니다.`);
      return { 
        success: false, 
        rank: null, 
        error: error.message,
        isAccessDenied: true 
      };
    }
    
    // Access Denied 에러인지 다시 한 번 확인 (안전장치)
    const isAccessDeniedInMessage = 
      error.message.includes('Access Denied') ||
      error.message.includes('Reference #') ||
      error.message.includes('errors.edgesuite.net') ||
      error.message.includes('권한이 없습니다') ||
      error.message.includes('접근할 수 있는 권한이 없습니다');
    
    return { 
      success: false, 
      rank: null, 
      error: error.message,
      isAccessDenied: isAccessDeniedInMessage // Access Denied인 경우 true 설정
    };
  }
}

/**
 * sellermate_slot_rank_coupang_history 테이블에 순위 및 상품 정보 저장
 * sellermate_keywords 테이블의 slot_id를 slot_status_id로 사용
 */
async function saveRankHistory(
  slotId: number,
  slotSequence: number,
  slotType: string,
  keyword: string,
  linkUrl: string | null,
  rank: number | null,
  productInfo?: ProductInfo
): Promise<void> {
  // 상품 미발견 시 -1로 저장 (웹사이트에서 "-"로 표시)
  const currentRank = rank !== null ? rank : -1;
  // start_rank도 current_rank와 동일하게 저장 (처음 체크이므로)
  const startRank = currentRank;
  
  console.log(`📊 순위 히스토리 저장: slot_status_id=${slotId}, slot_sequence=${slotSequence}, slot_type=${slotType}, rank=${currentRank}`);
  
  const insertData: any = {
    slot_status_id: slotId, // sellermate_keywords 테이블의 slot_id를 slot_status_id로 사용
    slot_sequence: slotSequence,
    slot_type: slotType,
    keyword: keyword,
    link_url: linkUrl,
    current_rank: currentRank, // null이면 -1로 저장 (상품 미발견)
    start_rank: startRank, // 처음 체크이므로 current_rank와 동일
    created_at: new Date().toISOString()
  };
  
  // ✅ 상품 정보 추가
  if (productInfo) {
    insertData.total_options = productInfo.totalOptions;
    insertData.soldout_options = productInfo.soldoutOptions;
    insertData.price = productInfo.price;
    insertData.price_sale = productInfo.priceSale;
    insertData.review_count = productInfo.reviewCount;
    insertData.product_image_url = productInfo.imageUrl;
    
    // 웹에서 계산하므로 NULL
    insertData.inventory_count = null;
    insertData.estimated_sales = null;
    
    console.log(`📦 상품 정보 저장:`, {
      옵션수: productInfo.totalOptions,
      품절옵션: productInfo.soldoutOptions,
      쿠팡판매가: productInfo.price,
      할인판매가: productInfo.priceSale,
      리뷰수: productInfo.reviewCount,
      이미지: productInfo.imageUrl ? '있음' : '없음',
    });
  } else {
    // 상품 정보가 없으면 기본값으로 저장
    insertData.total_options = 0;
    insertData.soldout_options = 0;
    insertData.price = null;
    insertData.price_sale = null;
    insertData.review_count = null;
    insertData.product_image_url = null;
    insertData.inventory_count = null;
    insertData.estimated_sales = null;
  }
  
  const { error } = await supabase
    .from('sellermate_slot_rank_coupang_history')
    .insert(insertData);

  if (error) {
    console.error(`❌ 순위 히스토리(sellermate_slot_rank_coupang_history) 저장 실패: ${error.message}`);
    throw error;
  }

  console.log(`✅ 순위 히스토리 저장 완료`);
}

/**
 * 쿠팡 무료 순위 히스토리 저장 (sellermate_free_coupang_rank_history)
 */
async function saveFreeCoupangRankToHistory(
  freeCoupangId: number,
  rank: number
): Promise<void> {
  const rankDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  console.log(`📊 무료 쿠팡 순위 히스토리 저장: free_coupang_id=${freeCoupangId}, rank=${rank}`);

  const { error } = await supabase
    .from('sellermate_free_coupang_rank_history')
    .insert({
      free_coupang_id: freeCoupangId,
      rank,
      rank_date: rankDate
    });

  if (error) {
    console.error(`❌ sellermate_free_coupang_rank_history 저장 실패: ${error.message}`);
    throw error;
  }
  console.log(`✅ 무료 쿠팡 순위 히스토리 저장 완료`);
}

/**
 * sellermate_keywords 테이블에서 항목 삭제 (처리 완료된 항목)
 */
async function deleteKeywordItem(keywordItemId: number): Promise<void> {
  console.log(`🗑️ sellermate_keywords 항목 삭제: id=${keywordItemId}`);
  
  // 자신이 처리 중인 항목만 삭제 (안전장치)
  const { error } = await supabase
    .from('sellermate_keywords')
    .delete()
    .eq('id', keywordItemId)
    .eq('assigned_to', PC_ID);

  if (error) {
    console.error(`❌ sellermate_keywords 항목 삭제 실패: ${error.message}`);
    throw error;
  }

  console.log(`✅ sellermate_keywords 항목 삭제 완료: id=${keywordItemId}`);
}

/**
 * 처리 실패 시 assigned_to 초기화 (다른 PC가 다시 처리할 수 있도록)
 */
async function resetProcessingStatus(keywordItemId: number): Promise<void> {
  try {
    await supabase
      .from('sellermate_keywords')
      .update({ assigned_to: null })
      .eq('id', keywordItemId)
      .eq('assigned_to', PC_ID);
  } catch (error: any) {
    console.warn(`⚠️ assigned_to 초기화 실패: ${error.message}`);
  }
}

// 전역 변수: 프로그램 중단 플래그
let shouldStop = false;

/**
 * 프로그램 중단 핸들러 설정
 */
function setupStopHandler() {
  // Ctrl+C (SIGINT) 처리
  process.on('SIGINT', () => {
    console.log('\n\n⚠️ 프로그램 중단 요청이 감지되었습니다...');
    console.log('현재 항목 처리 완료 후 안전하게 종료합니다.');
    shouldStop = true;
  });

  // 종료 신호 처리
  process.on('SIGTERM', () => {
    console.log('\n\n⚠️ 프로그램 종료 신호가 감지되었습니다...');
    shouldStop = true;
  });

  // Windows에서 Ctrl+C 처리
  if (process.platform === 'win32') {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.on('SIGINT', () => {
      console.log('\n\n⚠️ 프로그램 중단 요청이 감지되었습니다...');
      console.log('현재 항목 처리 완료 후 안전하게 종료합니다.');
      shouldStop = true;
    });
  }
}

/**
 * 단일 항목 처리 함수 (2페이지 이상 접속 실패 시 최대 5번 재시도)
 */
async function processSingleItem(
  item: KeywordItem,
  windowIndex: number,
  itemNumber: number,
  retryCount: number = 0
): Promise<{ success: boolean; fail: boolean }> {
  const MAX_PAGE_ACCESS_RETRIES = 5; // 2페이지 이상 접속 실패 시 최대 재시도 횟수
  
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[창${windowIndex + 1}] [항목 #${itemNumber}] 처리 시작${retryCount > 0 ? ` (재시도 ${retryCount}/${MAX_PAGE_ACCESS_RETRIES})` : ''}`);
    console.log(`  - ID: ${item.id}`);
    console.log(`  - Slot ID: ${item.slot_id}`);
    console.log(`  - Slot Sequence: ${item.slot_sequence}`);
    console.log(`  - Slot Type: ${item.slot_type}`);
    console.log(`  - Keyword: ${item.keyword}`);
    console.log(`  - Link URL: ${item.link_url || '없음'}`);
    console.log(`${'='.repeat(80)}\n`);

    // 1. 처리 전 항목 존재 여부 확인 (sellermate_keywords 테이블 삭제 시 즉시 감지)
    const itemExists = await checkKeywordItemExists(item.id);
    if (!itemExists) {
      console.log(`⚠️ [창${windowIndex + 1}] 항목 ${item.id}가 sellermate_keywords 테이블에서 삭제되었습니다. 스킵합니다.`);
      // assigned_to 초기화
      await resetProcessingStatus(item.id);
      return { success: false, fail: false };
    }

    // 2. 쿠팡 순위 검색
    const result = await searchCoupangRank(
      item.keyword,
      item.link_url,
      0,
      windowIndex
    );

    // 3. 처리 후 다시 한 번 항목 존재 여부 확인
    const itemStillExists = await checkKeywordItemExists(item.id);
    if (!itemStillExists) {
      console.log(`⚠️ [창${windowIndex + 1}] 항목 ${item.id}가 처리 중에 sellermate_keywords 테이블에서 삭제되었습니다.`);
      // assigned_to 초기화
      await resetProcessingStatus(item.id);
      return { success: false, fail: false };
    }

    // 4. Access Denied 에러인 경우 sellermate_keywords 테이블에서 삭제하지 않음
    const isAccessDenied = result.isAccessDenied || 
      (result.error && (
        result.error.includes('Access Denied') ||
        result.error.includes('Reference #') ||
        result.error.includes('errors.edgesuite.net') ||
        result.error.includes('권한이 없습니다') ||
        result.error.includes('접근할 수 있는 권한이 없습니다')
      ));
    
    if (isAccessDenied) {
      console.log(`⚠️ [창${windowIndex + 1}] 항목 ${item.id}는 Access Denied 에러로 인해 sellermate_keywords 테이블에 유지됩니다.`);
      // assigned_to만 초기화하여 다른 PC가 다시 시도할 수 있도록 함
      await resetProcessingStatus(item.id);
      console.log(`❌ [창${windowIndex + 1}] 항목 ${item.id} 처리 실패 (Access Denied): ${result.error}\n`);
      return { success: false, fail: true };
    }
    
    // 5. 2페이지 이상 접속 실패 시 재시도 로직 (히스토리 저장하지 않음)
    const isPageAccessFailed = result.pageAccessFailed || 
      (result.maxPageReached !== undefined && result.maxPageReached < 2);
    
    if (isPageAccessFailed && retryCount < MAX_PAGE_ACCESS_RETRIES) {
      const retryDelay = 2000 + Math.random() * 3000; // 2~5초 대기
      console.log(`⚠️ [창${windowIndex + 1}] 항목 ${item.id} 2페이지 이상 접속 실패 (최대 ${result.maxPageReached || 1}페이지 접속)`);
      console.log(`🔄 [창${windowIndex + 1}] ${Math.round(retryDelay / 1000)}초 후 재시도합니다... (${retryCount + 1}/${MAX_PAGE_ACCESS_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      
      // 재시도 (히스토리 저장하지 않음)
      return processSingleItem(item, windowIndex, itemNumber, retryCount + 1);
    }
    
    // 6. 2페이지 이상 접속 실패로 최대 재시도 초과한 경우 히스토리 저장하지 않고 삭제
    if (isPageAccessFailed && retryCount >= MAX_PAGE_ACCESS_RETRIES) {
      console.log(`❌ [창${windowIndex + 1}] 항목 ${item.id} 2페이지 이상 접속 실패: 최대 재시도 횟수(${MAX_PAGE_ACCESS_RETRIES}) 초과. 히스토리 저장 없이 삭제합니다.`);
      await deleteKeywordItem(item.id);
      return { success: false, fail: true };
    }
    
    // 7. 순위 히스토리 저장 (순위권 내 상품만 저장, 2페이지 이상 접속 실패가 아닌 경우만)
    // 순위가 null이거나 -1인 경우(순위권 밖) 히스토리 저장하지 않음
    if (result.rank !== null && result.rank > 0) {
      try {
        await saveRankHistory(
          item.slot_id,
          item.slot_sequence,
          item.slot_type,
          item.keyword,
          item.link_url,
          result.rank,
          result.productInfo  // ✅ 상품 정보 추가
        );
      } catch (historyError: any) {
        console.warn(`⚠️ [창${windowIndex + 1}] 히스토리 저장 실패했지만 계속 진행: ${historyError.message}`);
      }
    } else {
      console.log(`ℹ️ [창${windowIndex + 1}] 항목 ${item.id}는 순위권 밖이므로 히스토리 저장하지 않습니다. (순위: ${result.rank})`);
    }
    
    // 8. sellermate_keywords 테이블에서 항목 삭제 (처리 완료된 항목)
    await deleteKeywordItem(item.id);

    if (result.success) {
      if (result.rank !== null && result.rank > 0) {
        console.log(`✅ [창${windowIndex + 1}] 항목 ${item.id} 처리 성공: 순위 ${result.rank}위\n`);
      } else {
        console.log(`✅ [창${windowIndex + 1}] 항목 ${item.id} 처리 완료: 상품 미발견 (순위권 밖, 히스토리 저장 안 함)\n`);
      }
      return { success: true, fail: false };
    } else {
      console.log(`❌ [창${windowIndex + 1}] 항목 ${item.id} 처리 실패: ${result.error}\n`);
      return { success: false, fail: true };
    }

  } catch (error: any) {
    console.error(`❌ [창${windowIndex + 1}] 항목 ${item.id} 처리 중 오류: ${error.message}`);
    
    // 실패 시 assigned_to 초기화 (다른 PC가 다시 처리할 수 있도록)
    await resetProcessingStatus(item.id);
    
    return { success: false, fail: true };
  }
}

/**
 * 사용자로부터 창 개수 입력 받기 (1 또는 2)
 */
function askWindowCount(): Promise<number> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const ask = () => {
      rl.question('\n🔢 브라우저 창 개수를 선택하세요 (1 또는 2 입력): ', (answer) => {
        const count = parseInt(answer.trim(), 10);
        if (count === 1 || count === 2) {
          rl.close();
          resolve(count);
        } else {
          console.log('❌ 잘못된 입력입니다. 1 또는 2만 입력해주세요.');
          ask();
        }
      });
    };

    ask();
  });
}

/**
 * 메인 처리 함수 (24시간 풀가동 - 사용자 선택 창 개수 병렬 처리)
 * @param once - true면 1회만 처리 후 루프 탈출 (통합 러너용)
 */
async function processKeywordItems(windowCount: number, once?: boolean) {
  
  console.log('='.repeat(80));
  if (once) {
    console.log(`쿠팡 순위 체크 (통합 1건 모드)`);
  } else {
    console.log(`쿠팡 순위 체크 프로세서 시작 (24시간 풀가동 모드 - ${windowCount}개 병렬 처리)`);
  }
  console.log('='.repeat(80));
  console.log('');
  if (!once) {
    console.log('💡 프로그램을 중단하려면 Ctrl+C를 누르세요.');
    console.log('💡 sellermate_keywords 테이블에 항목이 없으면 자동으로 대기 후 재조회합니다.');
    console.log(`💡 ${windowCount}개씩 병렬 처리하여 처리 속도를 향상시킵니다.`);
    if (windowCount === 2) {
      console.log('💡 브라우저 창 1: 왼쪽 (0~710px), 창 2: 중간 (710~1420px)');
      console.log('💡 CMD 창은 오른쪽 (1420px~)에 수동으로 배치해주세요.');
    } else {
      console.log('💡 브라우저 창 1: 왼쪽 (0~710px)');
      console.log('💡 CMD 창은 오른쪽 (710px~)에 수동으로 배치해주세요.');
    }
    console.log('');
  }

  // 중단 핸들러 설정
  setupStopHandler();

  // 전체 통계 (24시간 누적)
  let totalSuccessCount = 0;
  let totalFailCount = 0;
  let totalProcessedCount = 0;
  let itemNumber = 0;

  try {
    // 무한 루프: 항목이 없을 때까지 계속 처리
    while (!shouldStop) {
      // 중단 요청 확인
      if (shouldStop) {
        break;
      }

      // 1. sellermate_keywords 테이블에서 항목 조회 (병렬 처리용)
      const items: (KeywordItem | null)[] = [];
      for (let i = 0; i < windowCount; i++) {
        const item = i === 0 ? await fetchKeywordItem() : (items[i - 1] ? await fetchKeywordItem() : null);
        items.push(item);
      }

      // 모든 항목이 null인지 확인
      const hasAnyItem = items.some(item => item !== null);
      
      if (!hasAnyItem) {
        console.log('\n⚠️ 처리할 키워드 항목이 없습니다.');
        if (once) {
          console.log('📋 (--once) 1회 모드이므로 종료합니다.');
          break;
        }
        console.log('⏳ 10초 후 다시 조회합니다...');
        console.log(`📊 현재까지 누적 통계: 성공 ${totalSuccessCount}개, 실패 ${totalFailCount}개, 총 ${totalProcessedCount}개`);
        const waitTime = 10000;
        const startTime = Date.now();
        while (Date.now() - startTime < waitTime) {
          if (shouldStop) break;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (shouldStop) {
          console.log('\n⚠️ 프로그램 중단 요청에 의해 대기 중단');
          break;
        }
        continue;
      }

      // 2. 병렬 처리 (선택한 개수만큼 항목 동시 처리)
      const promises: Promise<{ success: boolean; fail: boolean }>[] = [];
      
      for (let i = 0; i < windowCount; i++) {
        if (items[i]) {
          itemNumber++;
          promises.push(processSingleItem(items[i]!, i, itemNumber));
        }
      }

      // 병렬 처리 결과 대기
      const results = await Promise.all(promises);

      // 통계 업데이트
      for (const result of results) {
        if (result.success) {
          totalSuccessCount++;
          totalProcessedCount++;
        } else if (result.fail) {
          totalFailCount++;
          totalProcessedCount++;
        }
      }
      if (once) break;
    }

    // 최종 통계 출력
    console.log('\n' + '='.repeat(80));
    console.log('프로그램 종료 - 최종 통계');
    console.log('='.repeat(80));
    console.log(`✅ 전체 성공: ${totalSuccessCount}개`);
    console.log(`❌ 전체 실패: ${totalFailCount}개`);
    console.log(`📊 전체 처리: ${totalProcessedCount}개`);
    console.log(`📦 처리한 항목 수: ${itemNumber}개`);
    console.log('='.repeat(80));

  } catch (error: any) {
    console.error(`\n❌ 처리 중 치명적 오류 발생: ${error.message}`);
    console.error(error);
    console.log(`📊 오류 발생 시점 통계: 성공 ${totalSuccessCount}개, 실패 ${totalFailCount}개, 총 ${totalProcessedCount}개`);
    // process.exit(1) 제거 - 재시작을 위해 예외를 다시 throw
    throw error;
  }
}

/**
 * 통합 러너용: 1건만 처리 후 종료 (readline 없음)
 */
async function runOnce(): Promise<void> {
  setupStopHandler();
  await processKeywordItems(1, true);
}

/**
 * 무한 루프로 프로그램 실행 (자동 재시작 - 사용자가 직접 종료할 때까지 계속 실행)
 */
async function runWithAutoRestart() {
  // 프로그램 시작 시 한 번만 창 개수 입력받기
  const windowCount = await askWindowCount();
  
  let restartCount = 0;
  const MAX_RESTART_DELAY = 10000; // 최대 10초 대기 (더 빠른 재시작)
  
  console.log('🔄 자동 재시작 모드 활성화: 프로그램이 종료되면 자동으로 재시작됩니다.');
  console.log('🛑 완전히 종료하려면 Ctrl+C를 누르세요.\n');
  
  while (true) {
    try {
      restartCount++;
      if (restartCount > 1) {
        console.log('\n' + '='.repeat(80));
        console.log(`🔄 프로그램 자동 재시작 #${restartCount - 1}`);
        console.log(`⏰ 재시작 시간: ${new Date().toLocaleString('ko-KR')}`);
        console.log(`🔢 창 개수: ${windowCount}개 (재시작 시에도 동일하게 유지)`);
        console.log('='.repeat(80));
        console.log('');
      }
      
      await processKeywordItems(windowCount);
      
      // processKeywordItems가 종료된 경우 (shouldStop이 true인 경우)
      // 사용자가 Ctrl+C를 눌렀을 때만 종료
      if (shouldStop) {
        console.log('\n' + '='.repeat(80));
        console.log('🛑 사용자에 의해 프로그램이 종료되었습니다.');
        console.log('='.repeat(80));
        process.exit(0); // 정상 종료
      }
      
      // shouldStop이 false인데 종료된 경우 (예상치 못한 종료)
      console.log('\n' + '='.repeat(80));
      console.log('⚠️ 프로그램이 예상치 못하게 종료되었습니다.');
      console.log('🔄 3초 후 자동으로 재시작합니다...');
      console.log('='.repeat(80));
      await new Promise(resolve => setTimeout(resolve, 3000));
      // 계속 루프 진행 (재시작)
      
    } catch (error: any) {
      console.error('\n' + '='.repeat(80));
      console.error(`❌ 프로그램 실행 중 오류 발생 (재시작 #${restartCount}):`);
      console.error(`   오류 메시지: ${error.message}`);
      console.error(`   오류 스택: ${error.stack?.split('\n').slice(0, 3).join('\n')}`);
      console.error('='.repeat(80));
      
      // 재시작 전 대기 (지수 백오프: 3초, 5초, 10초, 최대 10초)
      const delay = Math.min(3000 * Math.pow(1.5, Math.min(restartCount - 1, 2)), MAX_RESTART_DELAY);
      console.log(`⏳ ${Math.round(delay / 1000)}초 후 자동으로 재시작합니다...`);
      console.log('💡 프로그램을 완전히 중단하려면 Ctrl+C를 누르세요.\n');
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // 계속 루프 진행 (재시작)
    }
  }
}

/**
 * 쿠팡 무료 1건만 처리 후 종료 (--free-only 진입점)
 */
async function runFreeCoupangOnce(): Promise<void> {
  const item = await fetchFreeKeywordItem();
  if (!item) {
    console.log('ℹ️ 처리할 쿠팡 무료 항목이 없습니다.');
    return;
  }

  console.log(`📋 [쿠팡 무료] 항목 ${item.id} 처리 시작 (free_coupang_id=${item.free_coupang_id})`);

  try {
    const result = await searchCoupangRank(
      item.keyword,
      item.link_url,
      0,
      0,
      true
    );

    const rank = result.rank !== null && result.rank > 0 ? result.rank : -1;
    await saveFreeCoupangRankToHistory(item.free_coupang_id, rank);
    await deleteKeywordItem(item.id);

    if (result.success && result.rank !== null && result.rank > 0) {
      console.log(`✅ [쿠팡 무료] 항목 ${item.id} 처리 완료: 순위 ${result.rank}위\n`);
    } else {
      console.log(`✅ [쿠팡 무료] 항목 ${item.id} 처리 완료: 순위권 밖 (rank=${rank})\n`);
    }
  } catch (err: any) {
    console.error(`❌ [쿠팡 무료] 항목 ${item.id} 처리 실패: ${err?.message || err}`);
    await resetProcessingStatus(item.id);
    throw err;
  }
}

// 진입점: --free-only → 무료 1건 후 종료, --once → 유료 1건 후 종료, 아니면 무한 루프
const argv = typeof process !== 'undefined' && process.argv ? process.argv : [];
const isFreeOnly = argv.includes('--free-only');
const isOnce = argv.includes('--once');

if (isFreeOnly) {
  runFreeCoupangOnce()
    .then(() => process.exit(0))
    .catch((error: any) => {
      console.error('❌ 쿠팡 무료 실행 오류:', error?.message || error);
      process.exit(1);
    });
} else if (isOnce) {
  runOnce()
    .then(() => process.exit(0))
    .catch((error: any) => {
      console.error('❌ 치명적 실행 오류:', error?.message || error);
      process.exit(1);
    });
} else {
  runWithAutoRestart().catch((error: any) => {
    console.error('❌ 치명적 실행 오류:', error?.message || error);
    console.error(error);
    console.log('⏳ 5초 후 자동으로 재시작을 시도합니다...');
    setTimeout(() => process.exit(1), 5000);
  });
}

