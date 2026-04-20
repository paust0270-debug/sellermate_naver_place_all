# 순위 체크 모듈

네이버 쇼핑 상품 순위를 체크하는 스크립트 모음

## 폴더 구조

```
rank-check/
├── single/          # 단일 상품 순위 체크
├── batch/           # 여러 상품 일괄 순위 체크
├── traffic-based/   # 트래픽 실행 후 순위 체크
└── legacy/          # 레거시/실험용 스크립트
```

## 주요 스크립트

### 1. 단일 상품 체크 (`single/`)

#### ✅ check-mid-rank-simple.ts (추천) ⭐ NEW
**배치 스크립트 패턴 적용한 안정적인 순위 체크 (1~15페이지 페이지네이션 완벽 지원)**

```bash
# 기본 사용법
npx tsx rank-check/single/check-mid-rank-simple.ts [키워드] [MID]

# 예시
npx tsx rank-check/single/check-mid-rank-simple.ts 장난감 85786220552
```

**특징:**
- ✨ 배치 스크립트와 동일한 검증된 로직
- ✨ 1~15페이지 자동 페이지네이션 (최대 600위)
- ✨ 단순 스크롤 + 2.5초 대기 방식으로 안정성 극대화
- ✨ 복잡한 AJAX 감지 제거로 오류 최소화
- PC 네이버 → 키워드 검색 → 쇼핑탭 진입
- `puppeteer-real-browser`로 봇 감지 회피

**테스트 결과:**
```
1페이지: 36개 상품 확인
2페이지: 46개 상품 확인
...
✅ MID 85786220552 발견!
   현재 순위: 1위 (1페이지 1번째)
```

#### check-mid-rank.ts
**기본 단일 상품 순위 체크 (1페이지 전용)**

```bash
npx tsx rank-check/single/check-mid-rank.ts 장난감 85786220552
```

**특징:**
- 1페이지만 스크롤 확인 (빠른 체크용)
- TOP 40 순위 확인에 적합

#### check-mid-rank-v2.ts, check-mid-rank-mobile.ts, check-mid-rank-click.ts
- 실험적 버전들 (legacy 폴더 이동 예정)

---

### 2. 여러 상품 일괄 체크 (`batch/`)

#### ✅ check-all-shopping-ranks.ts (추천)
**Supabase 연동 전체 상품 일괄 순위 체크**

```bash
npx tsx rank-check/batch/check-all-shopping-ranks.ts
```

**특징:**
- Supabase `abTestProducts` 테이블에서 `trafficSuccess=true` 상품 조회
- 각 상품의 순위를 쇼핑탭에서 자동 체크 (최대 15페이지)
- 순위 변화 계산 후 DB 자동 업데이트
- 결과를 `rank-check-shopping-2025-MM-DD.json`에 저장

**출력 예시:**
```
[1] 인형 뽑기기계... → 1위 (↑200)
[2] 드림팩토리... → 3위 (↑199)
...
```

#### check-shopping-tab-ranks.ts
- 쇼핑탭 여러 상품 체크

#### check-ab-ranks.ts
- A/B 테스트 상품들 일괄 체크 (NaverBot HTTP 방식 - 차단 가능성)

---

### 3. 트래픽 기반 체크 (`traffic-based/`)

#### check-rank-after-traffic.ts
트래픽 실행 직후 순위 체크

#### check-traffic-ranks-now.ts
현재 시점 트래픽 상품 순위 체크

#### check-today-traffic-ranks.ts
오늘 트래픽 실행한 상품들 순위 체크

---

### 4. 레거시/실험용 (`legacy/`)

실험적이거나 더 이상 사용하지 않는 스크립트들

- `check-rank-browser.ts` - 브라우저 기반 (셀렉터 문제)
- `check-rank-shopping.ts` - 쇼핑탭 전용
- `check-rank-now.ts` - 현재 순위 (단순 버전)
- `check-ranks-anytime.ts` - 언제든지 순위
- `check-ab-rank.ts` - A/B 단일 상품

---

## 사용 예시

### V6 트래픽 후 순위 체크
```bash
# 1. V6 엔진으로 트래픽 실행
npx tsx v6-engine/run/run-v6-multi.ts --products=3 --count=100

# 2. 단일 상품 순위 확인
npx tsx rank-check/single/check-mid-rank.ts 장난감 85786220552
npx tsx rank-check/single/check-mid-rank.ts 장난감 82389211437
npx tsx rank-check/single/check-mid-rank.ts 장난감 89811535008

# 또는 일괄 확인
npx tsx rank-check/batch/check-all-shopping-ranks.ts
```

---

## 기술 스택

- **puppeteer-real-browser**: 봇 감지 회피
- **Supabase REST API**: DB 연동
- **네이버 쇼핑탭**: `search.shopping.naver.com`

---

## 순위 체크 방식

### MID 매칭 패턴:
```typescript
const patterns = [
  /nv_mid=(\d+)/,      // 일반 상품
  /nvMid=(\d+)/,       // 쇼핑탭
  /product\?p=(\d+)/,  // 스마트스토어
  /catalog\/(\d+)/,    // 카탈로그
  /products\/(\d+)/,   // 직접 링크
];
```

### 순위 계산:
```typescript
최종순위 = (페이지번호 - 1) × 40 + 페이지내순위
```

---

## 주의사항

1. **HTTP 방식은 차단됨**: NaverBot의 HTTP 방식(`check-ab-ranks.ts`)은 모두 418 에러 발생
2. **브라우저 방식만 작동**: `puppeteer-real-browser` 기반 스크립트만 안정적
3. **순위 체크 간격**: 과도한 요청 방지를 위해 상품 간 2-3초 딜레이 권장
4. **헤드리스 모드 주의**: `headless: false` 권장 (헤드리스는 감지 가능성)

---

## 문제 해결

### "보안 확인" CAPTCHA 발생
- `headless: true` → `headless: false`로 변경
- 요청 간격 늘리기 (2초 → 5초)
- User-Agent 변경

### MID를 찾을 수 없음
- 키워드가 정확한지 확인
- 상품이 실제로 판매 중인지 확인
- 최대 스크롤 횟수 증가 (`scroll < 30` → `scroll < 50`)

---

## 향후 개선 사항

- [ ] 순위 체크 결과를 Supabase `trafficLogs` 테이블에 자동 기록
- [ ] 순위 변화 그래프 생성
- [ ] 실시간 순위 모니터링 대시보드
- [ ] 순위 알림 (Slack/Discord)
