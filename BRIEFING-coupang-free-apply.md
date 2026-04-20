# 쿠팡 무료 순위체크 적용 브리핑

**목표**
- **쿠팡 무료** = 상세페이지 진입 없이 **검색 결과 리스트에서 순위만 추출** → `sellermate_free_coupang_rank_history` 에만 저장.
- 통합 러너 순서: **쿠팡 1건(유료) → 쇼핑 1건(유료) → 플레이스(유료) 1건 → 플레이스(무료) 1건 → 쇼핑(무료) 1건 → 쿠팡(무료) 1건** → 대기 → 반복.
- 페이지: `http://localhost:3000/sellermate/coupangrank?sellermate=1` 에서 쿠팡 무료 영역 연동.

**테이블 (사용자 생성 완료)**
- **키워드 조회**: `sellermate_keywords` (유료·무료 공통). 무료는 **free_coupang_id**(또는 동일 역할 컬럼) not null 로 구분.
- **히스토리**: `sellermate_free_coupang_rank_history` (이미 생성됨).

---

## 1. 쿠팡 유료 vs 쿠팡 무료 비교

| 항목 | 쿠팡 유료 (현재) | 쿠팡 무료 (추가할 것) |
|------|------------------|------------------------|
| **키워드 조회** | `sellermate_keywords` (slot_type 쿠팡/쿠팡VIP 등, assigned_to null) | **같은 테이블** `sellermate_keywords` (free_coupang_id not null) |
| **순위 추출** | 검색 결과 리스트에서 productId 매칭 → **순위 산출** → **상세페이지 진입(extractProductInfo)** 로 가격·리뷰 등 수집 | **동일하게** 검색 리스트에서 순위만 산출. **상세 진입 없음.** |
| **저장** | sellermate_slot_rank_coupang_history (순위+상품정보) | **순위만** → `sellermate_free_coupang_rank_history` INSERT |
| **후처리** | 키워드 행 삭제 | 키워드 행 삭제 (동일) |

→ **순위는 검색 결과 페이지에서만** 구하고, 무료는 **extractProductInfo(상세 진입) 호출을 하지 않으면 됨.**

---

## 2. 쿠팡 메인 코드 상 “순위만” 시점

- **searchCoupangRank()** 내부:
  1. 검색 URL 이동 → 결과 페이지에서 `page.evaluate()` 로 상품 링크/ productId 목록 수집.
  2. 타겟 productId 발견 시 **foundRank = allProducts.length** (이 시점에 이미 순위 확정).
  3. **이후** `extractProductInfo(page, linkUrl, targetProductId)` 호출 → 상세페이지 이동 후 가격·리뷰 등 수집.
- **쿠팡 무료**에서 할 일: 2번까지 수행하고 **3번(extractProductInfo) 생략** 후, `{ success: true, rank: foundRank }` 만 반환하고 브라우저 정리.

---

## 3. 구현 방향 (2가지 중 선택)

### 방안 A: 기존 coupang-rank-processor 에 “무료 분기” 추가

- **fetchKeywordItem** 확장(또는 **fetchFreeKeywordItem** 신규):  
  `sellermate_keywords` 에서 **free_coupang_id is not null**, keyword/link_url not null, order by id, limit 1.  
  (assigned_to 락 방식은 유료와 동일하게 적용 가능.)
- **searchCoupangRank** 에 **rankOnly** 옵션 추가:  
  - `rankOnly === true` 이면 타겟 발견 시 **extractProductInfo 호출 없이** 곧바로 `return { success: true, rank: foundRank }` 하고 브라우저 종료.
- **processSingleItem** (또는 상위 처리)에서:
  - 항목이 무료(free_coupang_id 있음)이면:  
    searchCoupangRank(..., rankOnly: true) 호출 → **saveFreeCoupangRankToHistory(supabase, free_coupang_id, rank)** → sellermate_keywords 해당 행 삭제.
  - 유료는 기존대로 slot 쪽 히스토리 저장.
- **진입 경로**:  
  - 통합 러너에서 “쿠팡 무료 1건”만 돌리고 싶으면, **--free-only** 같은 인자로 “무료만 1건 조회 → 처리 → 종료” 하는 모드 하나 추가하면 됨.

### 방안 B: 쿠팡 무료 전용 배치 파일 분리

- **신규 파일**: `coupang-check/check-free-coupang-batch.ts`
  - **sellermate_keywords** 에서 free_coupang_id not null 로 1건 조회 (유료와 동일 테이블, 다른 조건).
  - 기존 **searchCoupangRank** 를 그대로 호출하되, **rankOnly 옵션**을 받도록 수정한 뒤 `rankOnly: true` 로 호출  
    → 반환값의 rank 만 사용.
  - **saveFreeCoupangRankToHistory(supabase, free_coupang_id, rank)** 로 `sellermate_free_coupang_rank_history` 에만 INSERT.
  - 처리 후 해당 행 sellermate_keywords 에서 삭제.
  - 옵션: `--limit=1`, `--once` (통합 러너는 `--limit=1 --once`).

공통으로 필요한 것:
- **searchCoupangRank** 에 **rankOnly** 파라미터 추가 후, rankOnly 시 extractProductInfo 호출 생략.
- **saveFreeCoupangRankToHistory** 구현 (free_coupang_id, rank, rank_date 등 INSERT).

---

## 4. 저장 함수·테이블 스키마 가정

- **saveFreeCoupangRankToHistory(supabase, freeCoupangId, rank)**  
  - 테이블: `sellermate_free_coupang_rank_history`  
  - 컬럼(예상): **free_coupang_id**(FK), **rank**(정수, 미발견 시 -1), **rank_date**(날짜, YYYY-MM-DD).  
  - 플레이스 무료 `saveFreePlaceRankToHistory` / 쇼핑 무료 `saveFreeNavershoppingRankToHistory` 와 동일 패턴.

- **sellermate_keywords**  
  - 무료 구분용 컬럼: **free_coupang_id** (not null 이면 무료).  
  - 유료는 기존처럼 slot_id·slot_type(쿠팡/쿠팡VIP 등) 기준.

---

## 5. 통합 러너 순서 변경

- **run-unified.ts** 에서 한 라운드 순서를 아래처럼 고정.
  1. 쿠팡 1건(유료) — `coupang-rank-processor.ts --once` (기존)
  2. 쇼핑 1건(유료) — check-batch-keywords.ts --limit=1 --once
  3. 플레이스(유료) 1건 — check-place-batch.ts --slot-only --limit=1 --once
  4. 플레이스(무료) 1건 — check-place-batch.ts --free-only --limit=1 --once
  5. 쇼핑(무료) 1건 — check-free-navership-batch.ts --limit=1 --once
  6. **쿠팡(무료) 1건** — 쿠팡 무료 전용 배치 또는 `coupang-rank-processor.ts --free-only --once` (방안에 따라)
  7. 대기(예: 3초) 후 다음 라운드 반복.

- **runCoupangFreeOnce()** 추가:  
  쿠팡 무료 1건만 실행하는 진입점(배치 또는 --free-only) 호출.

---

## 6. 작업 체크리스트

| 순서 | 작업 |
|------|------|
| 1 | **searchCoupangRank** 에 `rankOnly?: boolean` 추가. rankOnly 이면 타겟 발견 시 extractProductInfo 호출 없이 rank 만 반환 후 종료. |
| 2 | **saveFreeCoupangRankToHistory** 구현 (coupang-check 내 유틸 또는 기존 저장 로직 파일에 추가). |
| 3 | 쿠팡 무료 1건 조회·처리 경로 구현 (방안 A: 기존 processor 에 free 분기 + --free-only / 방안 B: check-free-coupang-batch.ts 신규). |
| 4 | **run-unified.ts** 에 runCoupangFreeOnce() 추가 및 라운드 순서를 “쿠팡(유료) → 쇼핑(유료) → 플레이스(유료) → 플레이스(무료) → 쇼핑(무료) → **쿠팡(무료)**” 로 변경. |
| 5 | (선택) start.bat / 콘솔 문구에 “쿠팡(무료) 1건” 포함. |

---

## 7. 정리

- **키워드**: 유료·무료 모두 **sellermate_keywords**. 무료는 **free_coupang_id not null** 로 구분.
- **히스토리**: 쿠팡 무료는 **sellermate_free_coupang_rank_history** 에만 저장 (순위·날짜 위주).
- **동작**: 쿠팡 메인과 동일한 검색·리스트 파싱으로 **순위만** 구하고, **상세페이지(extractProductInfo) 진입은 하지 않음**.
- **순서**: 쿠팡(유료) → 쇼핑(유료) → 플레이스(유료) → 플레이스(무료) → 쇼핑(무료) → **쿠팡(무료)** → 대기 → 반복.

이대로 적용하면 `coupangrank` 페이지의 쿠팡 무료 영역은 `sellermate_keywords`(무료 구분) + `sellermate_free_coupang_rank_history` 기준으로 연동할 수 있음.
ㄴㄴ