/**
 * 모바일 스텔스 스크립트
 *
 * navigator.userAgentData, platform, webdriver 등 오버라이드
 * CreepJS 봇 탐지 우회용
 *
 * 사용법:
 *   import { MOBILE_STEALTH_SCRIPT, applyMobileStealth } from '../shared/mobile-stealth';
 *   await applyMobileStealth(context);
 *
 * 주의: unified-runner.ts의 MOBILE_CONTEXT와 버전 일치 필수!
 *   - Chrome: 131
 *   - Android: 14
 *   - Device: SM-S911B (Galaxy S23)
 */

import type { Browser, BrowserContext } from "patchright";
import type { Page as PuppeteerPage } from "puppeteer-core";

// ============================================
// 실제 Chrome 버전 감지 (GREASE brand 포함)
// ============================================
export interface RealChromeInfo {
  majorVersion: string;
  fullVersion: string;
  greaseBrand: string;
  greaseVersion: string;
  greaseFullVersion: string;
  mobileUA: string;
}

/**
 * 시스템 Chrome의 실제 버전과 GREASE brand를 감지
 *
 * 왜 필요한가:
 * - TLS fingerprint는 실제 Chrome 버전을 드러냄
 * - sec-ch-ua 헤더에 하드코딩된 버전이 TLS와 다르면 봇 탐지
 * - GREASE brand는 Chrome 버전마다 다르므로 동적 감지 필수
 */
export async function detectRealChrome(browser: Browser): Promise<RealChromeInfo> {
  const bareCtx = await browser.newContext();
  const barePage = await bareCtx.newPage();

  const info = await barePage.evaluate(async () => {
    const ua = navigator.userAgent;
    const majorMatch = ua.match(/Chrome\/(\d+)/);
    const fullMatch = ua.match(/Chrome\/([\d.]+)/);
    const majorVersion = majorMatch ? majorMatch[1] : '130';
    const fullVersion = fullMatch ? fullMatch[1] : '130.0.0.0';

    const uad = (navigator as any).userAgentData;
    let greaseBrand = 'Not A;Brand';
    let greaseVersion = '8';
    let greaseFullVersion = '8.0.0.0';

    if (uad?.brands) {
      for (const b of uad.brands) {
        if (!b.brand.includes('Chromium') && !b.brand.includes('Chrome') && !b.brand.includes('Google')) {
          greaseBrand = b.brand;
          greaseVersion = b.version;
          break;
        }
      }
      try {
        const hev = await uad.getHighEntropyValues(['fullVersionList']);
        for (const b of hev.fullVersionList || []) {
          if (!b.brand.includes('Chromium') && !b.brand.includes('Chrome') && !b.brand.includes('Google')) {
            greaseFullVersion = b.version;
            break;
          }
        }
      } catch {}
    }

    return { majorVersion, fullVersion, greaseBrand, greaseVersion, greaseFullVersion };
  });

  await bareCtx.close();

  const mobileUA = `Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${info.fullVersion} Mobile Safari/537.36`;

  return { ...info, mobileUA };
}

/**
 * CDP를 통한 모바일 환경 설정 (실제 Chrome 버전 기반)
 *
 * - User-Agent를 모바일로 변경
 * - Client Hints (sec-ch-ua) 헤더를 실제 브라우저 버전으로 설정
 * - platform, model, architecture 등 모바일 값 설정
 * - Touch emulation 활성화 (maxTouchPoints: 5)
 */
export async function setupMobileCDP(cdp: any, chrome: RealChromeInfo) {
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: chrome.mobileUA,
    platform: 'Linux armv81',
    userAgentMetadata: {
      brands: [
        { brand: 'Chromium', version: chrome.majorVersion },
        { brand: 'Google Chrome', version: chrome.majorVersion },
        { brand: chrome.greaseBrand, version: chrome.greaseVersion },
      ],
      fullVersionList: [
        { brand: 'Chromium', version: chrome.fullVersion },
        { brand: 'Google Chrome', version: chrome.fullVersion },
        { brand: chrome.greaseBrand, version: chrome.greaseFullVersion },
      ],
      fullVersion: chrome.fullVersion,
      platform: 'Android',
      platformVersion: '14.0.0',
      architecture: 'arm',
      model: 'SM-S911B',
      mobile: true,
      bitness: '64',
      wow64: false,
    },
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 5,
  });
}

// ============================================
// 디바이스 프로필 (통합 관리)
// ============================================
export const DEVICE_PROFILE = {
  // 기기 정보 (Galaxy S23: Snapdragon 8 Gen 2)
  device: 'SM-S911B',
  deviceName: 'Galaxy S23',
  platform: 'Android',
  platformVersion: '14.0.0',

  // 브라우저 버전
  chromeVersion: '144',
  chromeMajor: '144',
  chromeFullVersion: '144.0.0.0',

  // 아키텍처
  architecture: 'arm',
  bitness: '64',

  // GPU (Snapdragon 8 Gen 2)
  gpuVendor: 'Qualcomm',
  gpuRenderer: 'Adreno (TM) 740',
};

export const MOBILE_STEALTH_SCRIPT = `
// ============================================================
// 모바일 스텔스 스크립트 - navigator 및 API 오버라이드
// Chrome 144 / Android 14 / SM-S911B (Galaxy S23)
// ============================================================

// 1. navigator.userAgentData 오버라이드 (Client Hints API)
Object.defineProperty(navigator, 'userAgentData', {
  get: () => ({
    brands: [
      { brand: 'Chromium', version: '144' },
      { brand: 'Google Chrome', version: '144' },
      { brand: 'Not-A.Brand', version: '99' }
    ],
    mobile: true,
    platform: 'Android',
    getHighEntropyValues: async (hints) => ({
      brands: [
        { brand: 'Chromium', version: '144' },
        { brand: 'Google Chrome', version: '144' },
        { brand: 'Not-A.Brand', version: '99' }
      ],
      mobile: true,
      platform: 'Android',
      platformVersion: '14.0.0',
      architecture: 'arm',
      bitness: '64',
      model: 'SM-S911B',
      uaFullVersion: '144.0.0.0',
      fullVersionList: [
        { brand: 'Chromium', version: '144.0.0.0' },
        { brand: 'Google Chrome', version: '144.0.0.0' },
        { brand: 'Not-A.Brand', version: '99.0.0.0' }
      ]
    }),
    toJSON: function() {
      return {
        brands: this.brands,
        mobile: this.mobile,
        platform: this.platform
      };
    }
  })
});

// 2. navigator.platform 오버라이드
Object.defineProperty(navigator, 'platform', {
  get: () => 'Linux armv81'
});

// 3. navigator.webdriver 숨기기
Object.defineProperty(navigator, 'webdriver', {
  get: () => false
});

// 4. navigator.maxTouchPoints 설정 (모바일)
Object.defineProperty(navigator, 'maxTouchPoints', {
  get: () => 5
});

// 5. navigator.hardwareConcurrency (모바일 수준)
Object.defineProperty(navigator, 'hardwareConcurrency', {
  get: () => 8
});

// 6. navigator.deviceMemory (모바일 수준)
Object.defineProperty(navigator, 'deviceMemory', {
  get: () => 8
});

// 7. navigator.connection 모바일 설정
Object.defineProperty(navigator, 'connection', {
  get: () => ({
    effectiveType: '4g',
    rtt: 50,
    downlink: 10,
    saveData: false,
    type: 'cellular',
    addEventListener: () => {},
    removeEventListener: () => {}
  })
});

// 8. screen orientation (portrait)
if (screen.orientation) {
  try {
    Object.defineProperty(screen.orientation, 'type', {
      get: () => 'portrait-primary'
    });
    Object.defineProperty(screen.orientation, 'angle', {
      get: () => 0
    });
  } catch (e) {}
}

// 9. window.chrome 객체 (안드로이드 크롬)
window.chrome = {
  runtime: {},
  loadTimes: function() {},
  csi: function() {},
  app: {}
};

// 10. Permissions API 수정
const originalQuery = window.navigator.permissions?.query;
if (originalQuery) {
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );
}

// 11. WebGL Vendor/Renderer 스푸핑 (Snapdragon 8 Gen 2)
const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
  // UNMASKED_VENDOR_WEBGL
  if (parameter === 37445) {
    return 'Qualcomm';
  }
  // UNMASKED_RENDERER_WEBGL
  if (parameter === 37446) {
    return 'Adreno (TM) 740';
  }
  return getParameterOrig.call(this, parameter);
};

const getParameterOrig2 = WebGL2RenderingContext.prototype.getParameter;
WebGL2RenderingContext.prototype.getParameter = function(parameter) {
  if (parameter === 37445) {
    return 'Qualcomm';
  }
  if (parameter === 37446) {
    return 'Adreno (TM) 740';
  }
  return getParameterOrig2.call(this, parameter);
};

// 12. 배터리 API 모바일화
if (navigator.getBattery) {
  navigator.getBattery = () => Promise.resolve({
    charging: true,
    chargingTime: 0,
    dischargingTime: Infinity,
    level: 0.85 + Math.random() * 0.1,  // 85~95% 랜덤
    addEventListener: () => {},
    removeEventListener: () => {}
  });
}

// 13. Playwright 전역 변수 제거
delete window.__playwright__binding__;
delete window.__pwInitScripts;
`;

/**
 * BrowserContext에 모바일 스텔스 스크립트 적용 (Patchright/Playwright)
 */
export async function applyMobileStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(MOBILE_STEALTH_SCRIPT);
}

/**
 * Puppeteer Page에 모바일 스텔스 스크립트 적용
 */
export async function applyMobileStealthPuppeteer(page: PuppeteerPage): Promise<void> {
  await page.evaluateOnNewDocument(MOBILE_STEALTH_SCRIPT);
}

/**
 * 모바일 컨텍스트 설정 (viewport, userAgent 등)
 * unified-runner.ts의 MOBILE_CONTEXT와 일치
 * Chrome 144 + Android 14 + Galaxy S23 (Snapdragon 8 Gen 2)
 */
export const MOBILE_CONTEXT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
  viewport: { width: 400, height: 700 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  extraHTTPHeaders: {
    'sec-ch-ua': '"Chromium";v="144", "Google Chrome";v="144", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    // High entropy 헤더 제거 (네이버는 Accept-CH로 요청하지 않음 - 봇 탐지 위험)
    // 'sec-ch-ua-platform-version': '"14.0.0"',
    // 'sec-ch-ua-model': '"SM-S911B"',
  },
};
