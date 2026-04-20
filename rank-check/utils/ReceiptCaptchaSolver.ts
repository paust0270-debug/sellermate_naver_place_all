/**
 * 영수증 CAPTCHA 자동 해결 - Claude Vision API (Puppeteer/PRB 버전)
 *
 * 네이버 영수증 CAPTCHA 유형:
 * - 질문: "영수증의 가게 위치는 [도로명] [?] 입니다"
 * - 이미지: 영수증 사진 (상호명, 주소, 전화번호 등)
 * - 정답: 이미지에서 해당 정보 추출
 */

import Anthropic from "@anthropic-ai/sdk";

// Page 타입: Puppeteer/Playwright 모두 호환 (any 사용)
type Page = any;

interface CaptchaDetectionResult {
  detected: boolean;
  question: string;
  questionType: "address" | "phone" | "store" | "unknown";
}

export class ReceiptCaptchaSolver {
  private anthropic: Anthropic;
  private maxRetries = 2;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log("[CaptchaSolver] ANTHROPIC_API_KEY not set - CAPTCHA solving disabled");
    }
    this.anthropic = new Anthropic({
      apiKey: apiKey || "dummy-key",
    });
  }

  /**
   * CAPTCHA 해결 시도
   * @returns true if solved, false if failed or no CAPTCHA
   */
  async solve(page: Page): Promise<boolean> {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("[CaptchaSolver] API key not configured, skipping");
      return false;
    }

    // 0. 보안 확인 페이지 감지 - 질문이 나타날 때까지 대기
    const hasSecurityPage = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      return bodyText.includes("보안 확인") || bodyText.includes("영수증");
    });

    if (hasSecurityPage) {
      console.log("[CaptchaSolver] 보안 확인 페이지 감지됨 - CAPTCHA 질문 대기 중...");

      // 최대 10초 동안 질문이 나타나기를 기다림
      for (let i = 0; i < 10; i++) {
        const hasQuestion = await page.evaluate(() => {
          const bodyText = document.body.innerText || "";
          return bodyText.includes("무엇입니까") ||
                 bodyText.includes("[?]") ||
                 bodyText.includes("번째 숫자") ||
                 bodyText.includes("번째 글자") ||
                 bodyText.includes("빈 칸");
        });

        if (hasQuestion) {
          console.log("[CaptchaSolver] CAPTCHA 질문 감지됨!");
          break;
        }

        await this.delay(1000);
        console.log(`[CaptchaSolver] 질문 대기 중... (${i + 1}/10)`);
      }
    }

    // 1. CAPTCHA 감지
    const captchaInfo = await this.detectCaptcha(page);
    if (!captchaInfo.detected) {
      console.log("[CaptchaSolver] 영수증 CAPTCHA 아님 - 다른 유형의 보안 페이지");
      return false;
    }

    console.log("[CaptchaSolver] 영수증 CAPTCHA 감지됨");
    console.log(`[CaptchaSolver] 질문: ${captchaInfo.question}`);

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[CaptchaSolver] 해결 시도 ${attempt}/${this.maxRetries}`);

        // 2. 영수증 이미지 캡처
        const receiptImage = await this.captureReceiptImage(page);

        // 3. Claude Vision으로 답 추출
        const answer = await this.askClaudeVision(
          receiptImage,
          captchaInfo.question
        );
        console.log(`[CaptchaSolver] Claude 응답: "${answer}"`);

        // 4. 답 입력 + 확인
        await this.submitAnswer(page, answer);

        // 5. 성공 여부 확인
        const solved = await this.verifySolved(page);
        if (solved) {
          console.log("[CaptchaSolver] CAPTCHA 해결 성공!");
          return true;
        }

        console.log(`[CaptchaSolver] 시도 ${attempt} 실패, 재시도...`);
        await this.delay(1000);
      } catch (error: any) {
        console.log(`[CaptchaSolver] 시도 ${attempt} 에러: ${error.message}`);
      }
    }

    console.log("[CaptchaSolver] 모든 시도 실패");
    return false;
  }

  /**
   * CAPTCHA 페이지 감지 (페이지 이동 없이)
   */
  async detectOnly(page: Page): Promise<boolean> {
    const result = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      const hasSecurityCheck = bodyText.includes("보안 확인");
      const hasReceipt = bodyText.includes("영수증");
      const hasQuestion = bodyText.includes("무엇입니까") ||
                         bodyText.includes("[?]") ||
                         bodyText.includes("번째 숫자") ||
                         bodyText.includes("빈 칸");

      return (hasSecurityCheck || hasReceipt) && hasQuestion;
    });

    return result;
  }

  /**
   * CAPTCHA 페이지 감지
   */
  private async detectCaptcha(page: Page): Promise<CaptchaDetectionResult> {
    return await page.evaluate(() => {
      const bodyText = document.body.innerText || "";

      const hasReceiptImage = bodyText.includes("영수증") || bodyText.includes("가상으로 제작");
      const hasQuestion = bodyText.includes("무엇입니까") ||
                         bodyText.includes("빈 칸을 채워주세요") ||
                         bodyText.includes("[?]") ||
                         bodyText.includes("번째 숫자");
      const hasSecurityCheck = bodyText.includes("보안 확인");

      const isReceiptCaptcha = (hasReceiptImage || hasSecurityCheck) && hasQuestion;
      const isCaptcha = isReceiptCaptcha || hasSecurityCheck || hasReceiptImage;

      if (!isCaptcha) {
        return { detected: false, question: "", questionType: "unknown" as const };
      }

      // 질문 텍스트 추출
      let question = "";

      // 방법 1: "무엇입니까?" 형식
      const questionMatch = bodyText.match(/.+무엇입니까\??/);
      if (questionMatch) {
        question = questionMatch[0].trim();
      }

      // 방법 2: 빨간색 스타일 텍스트
      if (!question) {
        const redElements = document.querySelectorAll(
          '[style*="color: rgb(255, 68, 68)"], [style*="color:#ff4444"], [style*="color: red"]'
        );
        for (const elem of redElements) {
          const text = elem.textContent?.trim();
          if (text && (text.includes("[?]") || text.includes("무엇입니까") || text.includes("번째"))) {
            question = text;
            break;
          }
        }
      }

      // 방법 3: "[?]" 패턴
      if (!question) {
        const match = bodyText.match(/영수증의\s+.+?\s+\[?\?\]?\s*입니다/);
        if (match) {
          question = match[0];
        }
      }

      // 방법 4: 특정 패턴들
      if (!question) {
        const patterns = [
          /가게\s*위치는\s*.+?\s*\[?\?\]?\s*입니다/,
          /전화번호는\s*.+?\s*\[?\?\]?\s*입니다/,
          /상호명은\s*.+?\s*\[?\?\]?\s*입니다/,
          /.+번째\s*숫자는\s*무엇입니까/,
          /.+번째\s*글자는\s*무엇입니까/,
        ];
        for (const pattern of patterns) {
          const m = bodyText.match(pattern);
          if (m) {
            question = m[0];
            break;
          }
        }
      }

      if (!question) {
        question = bodyText.substring(0, 300);
      }

      // 질문 유형 판별
      let questionType: "address" | "phone" | "store" | "unknown" = "unknown";
      if (question.includes("위치") || question.includes("주소") || question.includes("길")) {
        questionType = "address";
      } else if (question.includes("전화") || question.includes("번호")) {
        questionType = "phone";
      } else if (question.includes("상호") || question.includes("가게 이름")) {
        questionType = "store";
      }

      return { detected: true, question, questionType };
    });
  }

  /**
   * 스크린샷 결과를 base64 문자열로 변환 (Puppeteer/Playwright 호환)
   */
  private toBase64(buffer: Buffer | string | Uint8Array): string {
    if (typeof buffer === 'string') {
      // 이미 base64 문자열인 경우
      // data:image/png;base64, 접두사 제거
      if (buffer.startsWith('data:')) {
        return buffer.split(',')[1] || buffer;
      }
      return buffer;
    }

    // Uint8Array나 Buffer를 base64로 변환
    if (buffer instanceof Uint8Array || Buffer.isBuffer(buffer)) {
      return Buffer.from(buffer).toString('base64');
    }

    // 그 외의 경우 (예상치 못한 타입)
    console.log(`[CaptchaSolver] 예상치 못한 buffer 타입: ${typeof buffer}`);
    return String(buffer);
  }

  /**
   * 영수증 이미지 캡처
   */
  private async captureReceiptImage(page: Page): Promise<string> {
    const selectors = [
      "#rcpt_img",
      ".captcha_img",
      ".captcha_img_cover img",
      'img[alt="캡차이미지"]',
      'img[src*="captcha"]',
      'img[src*="receipt"]',
      ".captcha_image img",
      ".receipt_image img",
      '[class*="captcha"] img',
      '[class*="receipt"] img',
      ".security_check img",
      "#captcha_image",
    ];

    for (const selector of selectors) {
      const imageElement = await page.$(selector);
      if (imageElement) {
        try {
          // Playwright는 encoding 옵션이 없으므로 Buffer 반환
          const buffer = await imageElement.screenshot();
          console.log(`[CaptchaSolver] 이미지 캡처 성공: ${selector}`);
          return this.toBase64(buffer);
        } catch {
          continue;
        }
      }
    }

    // CAPTCHA 영역 전체 캡처
    const captchaAreaSelectors = [
      ".captcha_area",
      '[class*="captcha"]',
      '[class*="security"]',
      ".verify_area",
    ];

    for (const selector of captchaAreaSelectors) {
      const area = await page.$(selector);
      if (area) {
        try {
          const buffer = await area.screenshot();
          console.log(`[CaptchaSolver] 영역 캡처 성공: ${selector}`);
          return this.toBase64(buffer);
        } catch {
          continue;
        }
      }
    }

    // fallback: 전체 페이지 스크린샷
    console.log("[CaptchaSolver] 전체 페이지 캡처");
    const buffer = await page.screenshot();
    return this.toBase64(buffer);
  }

  /**
   * Claude Vision API로 답 추출
   */
  private async askClaudeVision(
    imageBase64: string,
    question: string
  ): Promise<string> {
    const hasValidQuestion = question.length > 0 && question.length < 200 &&
      (question.includes("무엇입니까") || question.includes("[?]") ||
       question.includes("번째") || question.includes("빈 칸"));

    const prompt = hasValidQuestion
      ? `이 영수증 CAPTCHA 이미지를 보고 다음 질문에 답하세요.

질문: ${question}

영수증에서 해당 정보를 찾아 [?] 위치에 들어갈 답만 정확히 알려주세요.
- "번째 숫자는 무엇입니까" 형식이면: 영수증에서 해당 숫자를 찾아 답하세요
- 주소 관련이면: 번지수나 도로명 번호만 (예: "794")
- 전화번호 관련이면: 해당 숫자만 (예: "5678")
- 상호명 관련이면: 해당 텍스트만

다른 설명 없이 답만 출력하세요. 숫자나 텍스트만 답하세요.`
      : `이 이미지는 네이버 보안 확인(CAPTCHA) 페이지입니다.

이미지에서:
1. 질문을 찾으세요 (예: "가게 전화번호의 뒤에서 1번째 숫자는 무엇입니까?")
2. 영수증 이미지에서 해당 정보를 찾으세요
3. 정답만 출력하세요

다른 설명 없이 정답만 출력하세요 (숫자 하나 또는 짧은 텍스트).`;

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 50,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    });

    const content = response.content[0];
    if (content.type === "text") {
      let answer = content.text.trim();
      answer = answer.replace(/입니다\.?$/, "").trim();
      answer = answer.replace(/^답\s*:\s*/i, "").trim();
      return answer;
    }

    throw new Error("Failed to get text response from Claude");
  }

  /**
   * 답 입력 및 제출
   */
  private async submitAnswer(page: Page, answer: string): Promise<void> {
    const inputSelectors = [
      'input[type="text"]',
      'input[placeholder*="입력"]',
      'input[placeholder*="정답"]',
      'input[name*="answer"]',
      'input[id*="answer"]',
      ".captcha_input input",
      "#captcha_answer",
    ];

    let inputFound = false;
    for (const selector of inputSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });

        // 기존 값 지우기
        const input = await page.$(selector);
        if (input) {
          await input.click();
          await this.delay(100);
          await page.keyboard.down('Control');
          await page.keyboard.press('KeyA');
          await page.keyboard.up('Control');
          await this.delay(50);
          await page.keyboard.press('Backspace');
          await this.delay(100);
        }

        // 답 입력 (사람처럼)
        await this.humanType(page, selector, answer);
        inputFound = true;
        console.log(`[CaptchaSolver] 답 입력 완료: ${selector}`);
        break;
      } catch {
        continue;
      }
    }

    if (!inputFound) {
      throw new Error("CAPTCHA input field not found");
    }

    await this.delay(500);

    // 확인 버튼 클릭
    const buttonSelectors = [
      'button:has-text("확인")',
      'input[type="submit"]',
      'button[type="submit"]',
      ".confirm_btn",
      ".submit_btn",
      'button[class*="confirm"]',
      'button[class*="submit"]',
    ];

    for (const selector of buttonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          console.log(`[CaptchaSolver] 확인 버튼 클릭: ${selector}`);
          break;
        }
      } catch {
        continue;
      }
    }

    // 버튼을 못 찾으면 Enter 키
    await page.keyboard.press("Enter");
    await this.delay(2000);
  }

  /**
   * 사람처럼 타이핑
   */
  private async humanType(page: Page, selector: string, text: string): Promise<void> {
    const input = await page.$(selector);
    if (!input) throw new Error(`Input not found: ${selector}`);

    await input.click();
    await this.delay(150);

    for (const char of text) {
      await page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
    }

    await this.delay(300);
  }

  /**
   * CAPTCHA 해결 여부 확인
   */
  private async verifySolved(page: Page): Promise<boolean> {
    const stillCaptcha = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      return (
        bodyText.includes("빈 칸을 채워주세요") ||
        bodyText.includes("다시 입력") ||
        bodyText.includes("오류") ||
        (bodyText.includes("영수증") && bodyText.includes("[?]"))
      );
    });

    return !stillCaptcha;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default ReceiptCaptchaSolver;
