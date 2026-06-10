# BRIEFING — 쿠팡 장바구니 트래픽 (Coupang Cart Traffic)

> 매 세션 인지용 요약은 `CLAUDE.md`에 있고, 키워드 트리거 워크플로는 스킬 `coupang-cart-traffic`에 있습니다. 이 문서는 그 둘이 가리키는 **상세 레퍼런스**입니다.

## 1. 개요

쿠팡 순위 체크 과정에서 대상 상품을 **장바구니에 담는(장바구니 담기)** 동작을 수행한다.
실제 구매가 아니라, **자연스러운 사용자 인게이지먼트 신호**를 만들어 순위/노출에 긍정적으로 작용하도록 하는 트래픽 단계다.

- 순위 체크와 장바구니 트래픽이 **같은 실행 흐름** 안에서 함께 일어난다.
- 유료 모드에서만 담기를 수행한다. 무료 모드(`rankOnly`)는 순위만 저장하고 상세 진입·담기를 생략한다.

## 2. 현재 방식 — 브라우저 (AS-IS)

### 엔진 / 브라우저
- **patchright** (Playwright 포크, 봇 탐지 우회 강화) — `import { chromium } from 'patchright'`
- 실행: `chromium.launch({ headless: false, channel: 'chrome' })`
  - **1순위**: 시스템에 설치된 실제 Google Chrome (`channel: 'chrome'`)
  - **폴백**: Chrome 채널 실행 실패 시 patchright 번들 Chromium
- 창 표시 모드(headless 아님), 워커 인덱스별로 창 위치 분할 배치

### 코드 위치
- 장바구니 담기 로직: `coupang-check/coupang-rank-processor.ts:454–554`
- 브라우저 실행: `coupang-check/coupang-rank-processor.ts:1124–1147`
- 쿠키/캐시 정리: `clearContextCookiesAndCache()` (`~1070`)

### 실행 흐름
1. 키워드로 쿠팡 검색
2. 상품 ID로 순위 탐색 (최대 30페이지 페이지네이션)
3. 상품 페이지 진입
4. **장바구니 담기 클릭** — 4가지 방법 순차 시도:
   - `.prod-cart-btn`
   - `[data-gaclick*="cart"]`
   - `button[data-gaclick]`
   - 텍스트 매칭 `장바구니 담기`
5. 담기 후 뜨는 **모달의 X(닫기) 버튼** 클릭 (`~600ms` 대기 후)
6. 상세 추출 (리뷰수·가격·옵션·썸네일 등)
7. Supabase `sellermate_slot_rank_coupang_history`에 순위 기록
8. 작업 종료 시 컨텍스트 쿠키·캐시 삭제 후 브라우저 종료

> 담기 버튼을 못 찾거나 실패하면 **에러로 중단하지 않고 스킵**한다.

### 세션 / 네트워크 특성
- **비로그인**: 쿠팡 계정 로그인 없이 동작. 작업마다 쿠키를 삭제해 세션을 새로 시작한다.
- **IP**: 폰 테더링 상태(`getPhoneTetheringStatus`) 기반. 테더링/ADB 없는 PC는 쿠팡 단계를 건너뛴다.
- 매 작업 새 `browser.newContext()`로 깨끗한 세션.

## 3. 패킷 방식으로 전환 (TO-BE, 방향만 확정)

> 현재 상태: **아이디어/방향만 있음.** 캡처된 패킷·엔드포인트 스펙·PoC 코드는 아직 없음.

### 목표 / 이유
- 브라우저(실제 Chrome 창) 방식은 **무겁고 느리며 리소스 소모가 크다.**
- 장바구니 담기를 **직접 HTTP 요청(패킷)** 으로 보내면:
  - 브라우저 없이 경량·고속 실행
  - 높은 병렬성 (창 개수 제약 해소)
  - 리소스/창 관리 부담 감소

### 풀어야 할 과제 (전환 전 해결 필요)
1. **장바구니 API 엔드포인트 캡처** — 실제 담기 요청의 URL·메서드·페이로드 구조
2. **인증/세션 토큰** — 비로그인 상태에서 담기가 어떤 토큰/세션 식별자를 요구하는지 (PCID, 디바이스 식별자 등)
3. **필수 헤더·쿠키** — User-Agent, Referer, CSRF/보안 토큰, 쿠키 셋
4. **봇 탐지 / WAF** — 쿠팡의 요청 단 탐지(서명·챌린지·레이트리밋) 우회 가능 여부
5. **응답 검증** — 담기 성공/실패를 응답에서 어떻게 판정할지
6. **IP 전략** — 기존 테더링 IP 로테이션을 패킷 방식에서도 동일하게 적용

### 다음 단계
1. 브라우저 DevTools / 프록시(mitmproxy 등)로 **담기 요청 패킷 캡처**
2. 엔드포인트·헤더·페이로드 **스펙 문서화** (이 문서에 추가)
3. **PoC** — 단일 상품 담기 HTTP 요청 재현
4. 검증 후 `coupang-rank-processor.ts`의 브라우저 담기 단계를 패킷 호출로 교체 (또는 병행 옵션화)

## 4. 관련 파일
- `coupang-check/coupang-rank-processor.ts` — 쿠팡 순위 + 장바구니 트래픽 메인 (~2200줄)
- `ipRotation.ts` — IP 로테이션 / 테더링 상태
- `CLAUDE.md` — 매 세션 로드되는 요약 포인터
- `.claude/skills/coupang-cart-traffic/SKILL.md` — 키워드 트리거 워크플로
