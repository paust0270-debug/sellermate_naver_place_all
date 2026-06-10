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
  questionSelector: string | null;
  imageSelector: string | null;
}

export class ReceiptCaptchaSolver {
  private anthropic: Anthropic;
  private maxRetries = 3;

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
    const hasSecurityPage = await page.evaluate(`(() => {
      const bodyText = document.body?.innerText || "";
      return bodyText.includes("보안 확인") || bodyText.includes("영수증");
    })()`);

    if (hasSecurityPage) {
      console.log("[CaptchaSolver] 보안 확인 페이지 감지됨 - CAPTCHA 질문 대기 중...");

      // 최대 10초 동안 질문이 나타나기를 기다림
      for (let i = 0; i < 10; i++) {
        const hasQuestion = await page.evaluate(`(() => {
          const bodyText = document.body?.innerText || "";
          return bodyText.includes("무엇입니까") ||
                 bodyText.includes("[?]") ||
                 bodyText.includes("번째 숫자") ||
                 bodyText.includes("번째 글자") ||
                 bodyText.includes("빈 칸");
        })()`);

        if (hasQuestion) {
          console.log("[CaptchaSolver] CAPTCHA 질문 감지됨!");
          break;
        }

        await this.delay(1000);
        console.log(`[CaptchaSolver] 질문 대기 중... (${i + 1}/10)`);
      }
    }

    // 1. CAPTCHA 감지
    console.log("[CaptchaSolver] detectCaptcha 시작");
    let captchaInfo: CaptchaDetectionResult;
    try {
      captchaInfo = await this.detectCaptcha(page);
    } catch (error: any) {
      console.log(`[CaptchaSolver] detectCaptcha 에러: ${error?.message || String(error)}`);
      throw error;
    }

    console.log(
      `[CaptchaSolver] detectCaptcha => detected=${captchaInfo.detected}, questionType=${captchaInfo.questionType}, ` +
      `questionSelector=${captchaInfo.questionSelector || "N/A"}, imageSelector=${captchaInfo.imageSelector || "N/A"}`
    );
    if (captchaInfo.question) {
      console.log(`[CaptchaSolver] detectCaptcha question preview: ${captchaInfo.question.slice(0, 180)}`);
    }
    if (!captchaInfo.detected) {
      console.log("[CaptchaSolver] 영수증 CAPTCHA 아님 - 다른 유형의 보안 페이지");
      return false;
    }

    console.log("[CaptchaSolver] 영수증 CAPTCHA 감지됨");
    console.log(`[CaptchaSolver] 질문: ${captchaInfo.question}`);
    console.log(`[CaptchaSolver] 질문 셀렉터: ${captchaInfo.questionSelector || "N/A"}`);
    console.log(`[CaptchaSolver] 이미지 셀렉터: ${captchaInfo.imageSelector || "N/A"}`);

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[CaptchaSolver] 해결 시도 ${attempt}/${this.maxRetries}`);

        // 2. 영수증 이미지 캡처
        const receiptImage = await this.captureReceiptImage(page, captchaInfo.imageSelector);

        // 3. Claude Vision으로 답 추출
        console.log("[CaptchaSolver] Claude Vision 요청 시작");
        const answer = await this.askClaudeVision(
          receiptImage,
          captchaInfo.question,
          {
            questionSelector: captchaInfo.questionSelector,
            imageSelector: captchaInfo.imageSelector,
          }
        );
        console.log(`[CaptchaSolver] Claude 응답: "${answer}"`);

        const normalizedAnswer = this.normalizeAnswerCandidate(answer);
        if (!normalizedAnswer) {
          throw new Error(`Claude returned non-answer: ${answer.slice(0, 120)}`);
        }

        if (normalizedAnswer !== answer) {
          console.log(`[CaptchaSolver] 정규화된 답: "${normalizedAnswer}"`);
        }

        // 4. 답 입력 + 확인
        await this.submitAnswer(page, normalizedAnswer);

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
    const result = await page.evaluate(`(() => {
      const bodyText = document.body?.innerText || "";
      const hasSecurityCheck = bodyText.includes("보안 확인");
      const hasReceipt = bodyText.includes("영수증");
      const hasQuestion = bodyText.includes("무엇입니까") ||
                         bodyText.includes("[?]") ||
                         bodyText.includes("번째 숫자") ||
                         bodyText.includes("빈 칸");

      return (hasSecurityCheck || hasReceipt) && hasQuestion;
    })()`);

    return result;
  }

  /**
   * CAPTCHA 페이지 감지
   */
  private async detectCaptcha(page: Page): Promise<CaptchaDetectionResult> {
    return await page.evaluate(`(() => {
      const bodyText = document.body?.innerText || "";
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const isVisible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const findFirstVisibleSelector = (selectors) => {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element && isVisible(element)) {
            return selector;
          }
        }
        return null;
      };

      const hasReceiptImage = bodyText.includes("영수증") || bodyText.includes("가상으로 제작");
      const hasQuestion = bodyText.includes("무엇입니까") ||
                         bodyText.includes("빈 칸을 채워주세요") ||
                         bodyText.includes("[?]") ||
                         bodyText.includes("번째 숫자");
      const hasSecurityCheck = bodyText.includes("보안 확인");

      const isReceiptCaptcha = (hasReceiptImage || hasSecurityCheck) && hasQuestion;
      const isCaptcha = isReceiptCaptcha || hasSecurityCheck || hasReceiptImage;

      if (!isCaptcha) {
        return {
          detected: false,
          question: "",
          questionType: "unknown",
          questionSelector: null,
          imageSelector: null,
        };
      }

      const questionSelectors = [
        ".captcha_question",
        ".captcha_question_text",
        ".captcha_txt",
        ".captcha_desc",
        ".verify_txt",
        ".security_question",
        ".receipt_question",
        '[class*="captcha"] [class*="question"]',
        '[id*="captcha"] [class*="question"]',
        '[class*="security"] [class*="question"]',
        ".question",
        "[role='alert']",
      ];
      const imageSelectors = [
        "#rcpt_img",
        "#captchaimg",
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

      // 질문 텍스트 추출
      let question = "";
      const questionSelector = findFirstVisibleSelector(questionSelectors);
      const looksLikeQuestion = (text) =>
        text.includes("무엇입니까") ||
        text.includes("[?]") ||
        text.includes("번째") ||
        text.includes("빈 칸") ||
        text.includes("물건") ||
        text.includes("가게") ||
        text.includes("전화번호") ||
        text.includes("상호명") ||
        text.includes("주소");
      if (questionSelector) {
        const questionElement = document.querySelector(questionSelector);
        const rawQuestionText = questionElement?.textContent || "";
        const questionLines = rawQuestionText
          .split(/\\n+/)
          .map((line) => normalize(line))
          .filter(Boolean);
        const bestQuestionLine = [...questionLines]
          .reverse()
          .find((line) => looksLikeQuestion(line) && line.length <= 160);
        const questionText = bestQuestionLine || normalize(rawQuestionText);
        if (questionText && looksLikeQuestion(questionText) && questionText.length <= 160) {
          question = questionText;
        }
      }

      // 방법 1: 줄 단위 질문 추출(과도하게 긴 본문 매칭 방지)
      if (!question) {
        const questionLines = bodyText
          .split(/\\n+/)
          .map((line) => normalize(line))
          .filter((line) => line && looksLikeQuestion(line) && line.length <= 160);
        const questionMatch = questionLines.find((line) => line.includes("무엇입니까")) || questionLines[0] || "";
        if (questionMatch) {
          question = questionMatch.trim();
        }
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

      if (question && !looksLikeQuestion(question)) {
        const bodyQuestionPatterns = [
          /.+?의\s+앞에서\s+\d+번째\s+숫자는\s+무엇입니까\??/,
          /.+?의\s+뒤에서\s+\d+번째\s+숫자는\s+무엇입니까\??/,
          /.+?의\s+전체\s+이름은\s+\[\?\]\s*.+?/,
          /가게\s*전화번호의\s*.+?숫자는\s*무엇입니까\??/,
          /가장\s*가격이\s*비싼\s*물건의\s*이름은\s*무엇입니까\??/,
          /가격이\s*\d+원인\s*물건의\s*이름은\s*무엇입니까\??/,
          /영수증의\s+.+?\s+\[?\?\]?\s*입니다/,
        ];
        for (const pattern of bodyQuestionPatterns) {
          const match = bodyText.match(pattern);
          if (match) {
            question = match[0].trim();
            break;
          }
        }
      }

      const imageSelector = findFirstVisibleSelector(imageSelectors);

      // 질문 유형 판별
      let questionType = "unknown";
      if (question.includes("위치") || question.includes("주소") || question.includes("길")) {
        questionType = "address";
      } else if (question.includes("전화") || question.includes("번호")) {
        questionType = "phone";
      } else if (question.includes("상호") || question.includes("가게 이름")) {
        questionType = "store";
      }

      return {
        detected: true,
        question,
        questionType,
        questionSelector,
        imageSelector,
      };
    })()`);
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
  private async captureReceiptImage(page: Page, preferredSelector?: string | null): Promise<string> {
    const selectors = [
      preferredSelector,
      "#rcpt_img",
      "#captchaimg",
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
    ].filter((selector): selector is string => Boolean(selector));

    for (const selector of selectors) {
      const imageElement = await page.$(selector);
      if (imageElement) {
        try {
          const buffer = await imageElement.screenshot();
          console.log(`[CaptchaSolver] 이미지 캡처 성공: ${selector}`);
          return this.toBase64(buffer);
        } catch {
          continue;
        }
      }
    }

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

    console.log("[CaptchaSolver] 전체 페이지 캡처");
    const buffer = await page.screenshot();
    return this.toBase64(buffer);
  }

  /**
   * Claude Vision API로 답 추출
   */
  private async askClaudeVision(
    imageBase64: string,
    question: string,
    selectors?: { questionSelector: string | null; imageSelector: string | null }
  ): Promise<string> {
    const hasValidQuestion = question.length > 0 && question.length < 200 &&
      (question.includes("무엇입니까") || question.includes("[?]") ||
       question.includes("번째") || question.includes("빈 칸"));

    const prompt = hasValidQuestion
      ? `이 영수증 CAPTCHA 이미지를 보고 질문에 답하세요.

질문: ${question}
질문 셀렉터: ${selectors?.questionSelector || "N/A"}
이미지 셀렉터: ${selectors?.imageSelector || "N/A"}

중요:
- 출력은 반드시 숫자만 허용합니다.
- 설명, 사과, 추측, 문장, 단어는 절대 쓰지 마세요.
- 숫자가 여러 개 보이면 질문과 직접 연결된 숫자만 고르세요.
- 숫자가 전혀 없거나 확실하지 않으면 아무 텍스트도 출력하지 마세요.
- 답이 숫자가 아닌 형태로 보여도, 숫자로 환산 가능한 경우에만 숫자만 출력하세요.`
      : `이 이미지는 네이버 보안 확인(CAPTCHA) 페이지입니다.
질문 셀렉터: ${selectors?.questionSelector || "N/A"}
이미지 셀렉터: ${selectors?.imageSelector || "N/A"}

중요:
- 출력은 반드시 숫자만 허용합니다.
- 설명, 사과, 추측, 문장, 단어는 절대 쓰지 마세요.
- 숫자가 전혀 없거나 확실하지 않으면 아무 텍스트도 출력하지 마세요.`;

    const maxApiRetries = 3;
    let lastAnswer = "";

    for (let attempt = 1; attempt <= maxApiRetries; attempt += 1) {
      const response = await Promise.race([
        this.anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 20,
          temperature: 0,
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
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Claude Vision timeout after 30s")), 30000)),
      ]);

      console.log("[CaptchaSolver] Claude Vision 응답 수신");

      const content = response.content[0];
      if (content.type === "text") {
        let answer = content.text.trim();
        answer = answer.replace(/입니다\.?$/, "").trim();
        answer = answer.replace(/^답\s*:\s*/i, "").trim();
        answer = answer.replace(/^정답\s*:\s*/i, "").trim();
        lastAnswer = answer;
        console.log(`[CaptchaSolver] Claude 원문 응답: ${answer.slice(0, 120)}`);

        const normalized = this.normalizeAnswerCandidate(answer);
        if (normalized) {
          return normalized;
        }

        if (attempt < maxApiRetries) {
          await this.delay(500);
          continue;
        }
      }
    }

    return lastAnswer;
  }

  /**
   * Claude 응답이 실제 답처럼 보이는지 정규화/검증
   */
  private normalizeAnswerCandidate(answer: string): string {
    const cleaned = (answer || "").replace(/[“”"'`]/g, "").trim();
    if (!cleaned) return "";

    const failureMarkers = [
      "해상도",
      "읽기 어렵",
      "정확한 텍스트",
      "질문과 영수증",
      "추측",
      "UNSURE",
      "모르",
      "확인할 수 없",
      "cannot",
      "will not",
      "CAPTCHA",
      "보안 확인",
    ];
    if (failureMarkers.some((marker) => cleaned.toLowerCase().includes(marker.toLowerCase()))) {
      return "";
    }

    const digitsOnly = cleaned.replace(/\D+/g, "");
    if (!digitsOnly) return "";
    if (digitsOnly.length > 16) return "";

    return digitsOnly;
  }

  /**
   * 답 입력 및 제출
   */
  private async submitAnswer(page: Page, answer: string): Promise<void> {
    const inputSelectors = [
      "#captcha",
      'input#captcha',
      'input[name="captcha"]',
      "#chptcha",
      'input#chptcha',
      'input[name="chptcha"]',
      'input[id="chptcha"]',
      '.captcha_wrap input',
      '.captcha_area input',
      ".captcha_input input",
      "#captcha_answer",
      'input[name*="captcha"]',
      'input[id*="captcha"]',
      'input[placeholder*="정답"]',
      'input[placeholder*="답"]',
      'input[aria-label*="정답"]',
      'input[aria-label*="답"]',
    ];

    let inputFound = false;
    for (const selector of inputSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });

        // 기존 값 지우기
        const input = await page.$(selector);
        if (input) {
          const inputType = await input.getAttribute("type").catch(() => null);
          const inputName = await input.getAttribute("name").catch(() => null);
          const inputId = await input.getAttribute("id").catch(() => null);
          const isLoginField =
            inputId === "id" ||
            inputId === "pw" ||
            inputName === "id" ||
            inputName === "pw" ||
            inputType === "password";
          if (isLoginField) {
            continue;
          }

          console.log(`[CaptchaSolver] 답 입력 대상 셀렉터: ${selector}`);
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
      '#submit_btn',
      'button#submit_btn',
      'input#submit_btn',
      'button[type="submit"]#submit_btn',
      'button:has-text("로그인")',
      'input[type="submit"][value*="로그인"]',
      'button[type="submit"][aria-label*="로그인"]',
      '.login_btn',
      '.btn_login',
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
    const stillCaptcha = await page.evaluate(`(() => {
      const bodyText = document.body?.innerText || "";
      return (
        bodyText.includes("빈 칸을 채워주세요") ||
        bodyText.includes("다시 입력") ||
        bodyText.includes("오류") ||
        (bodyText.includes("영수증") && bodyText.includes("[?]"))
      );
    })()`);

    return !stillCaptcha;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default ReceiptCaptchaSolver;
