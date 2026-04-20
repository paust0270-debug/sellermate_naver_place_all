# 네이버쇼핑 무료 순위체크 프로그램 적용 브리핑

**목표**
- 네이버쇼핑(유료)과 **동일한 순위 체크 로직**으로 **쇼핑 무료** 전용 프로그램 추가.
- 쇼핑 무료는 **순위체크만** 수행 (슬롯 업데이트·유료 히스토리 없음).
- 통합 러너 순서: **쇼핑 1건 → 플레이스(유료) 1건 → 플레이스(무료) 1건 → 쇼핑(무료) 1건 → 반복**.

**테이블**
- **키워드 조회**: `sellermate_keywords_navershopping` (유료·무료 공통). 무료는 `free_navershopping_id`(또는 동일 역할 컬럼) not null 로 구분.
- `sellermate_free_navershopping_rank_history` — 무료 순위 히스토리 (이미 생성됨).

---

## 1. 유료 쇼핑 vs 무료 쇼핑 비교

| 항목 | 유료 쇼핑 (현재) | 쇼핑 무료 (추가할 것) |
|------|------------------|------------------------|
| **키워드 조회** | `sellermate_keywords_navershopping` (slot_id not null) | **같은 테이블** `sellermate_keywords_navershopping` (free_navershopping_id not null) |
| 순위 체크 | `ParallelRankChecker.checkUrls()` (동일 로직 사용) | **동일** — 검색 후 productId 매칭으로 순위만 산출 |
| 저장 | `saveRankToSlotNaver()` → slot_naver UPDATE + slot_rank_naver_history INSERT | **순위만** → `sellermate_free_navershopping_rank_history` INSERT |
| 후처리 | 키워드 행 삭제 | 키워드 행 삭제 (동일) |

→ **키워드 조회는 같은 테이블**, 무료는 free_navershopping_id 로 구분. 순위 체크 로직 재사용, 저장만 무료 히스토리로.

---

## 2. 구현할 것 목록

### 2.1 무료 쇼핑 전용 저장 함수

- **위치**: `rank-check/utils/save-rank-to-slot-naver.ts` 에 추가하거나, `rank-check/utils/save-free-navership-rank.ts` 새 파일.
- **역할**:  
  `saveFreeNavershoppingRankToHistory(supabase, freeNavershoppingId, rank)`  
  - `sellermate_free_navershopping_rank_history` 에 INSERT.  
  - 컬럼: **free_navershopping_id**(FK), **rank**(숫자, 미발견 시 -1), **rank_date**(날짜, YYYY-MM-DD).  
  - 플레이스 무료의 `saveFreePlaceRankToHistory` 와 동일 패턴.
- **전제**: DB 히스토리 테이블에 `free_navershopping_id`(또는 실제 FK 컬럼명)가 있어야 함.

### 2.2 무료 쇼핑 전용 배치

- **파일**: `rank-check/batch/check-free-navership-batch.ts` (신규).
- **흐름** (플레이스 무료와 동일: **키워드 조회는 공통 키워드 테이블**):
  1. **조회**: **`sellermate_keywords_navershopping`** 에서 `free_navershopping_id` is not null, `keyword`, `link_url` not null, order by id, limit N (또는 `--limit=1 --once`).
  2. **순위 체크**:  
     - 기존 **ParallelRankChecker** 사용.  
     - `checkUrls([{ url: row.link_url, keyword: row.keyword, maxPages: 15 }])` 호출 → 1건이면 브라우저 1개 순차 실행됨.  
     - 반환값에서 `result.rank?.totalRank` 또는 미발견 시 null → 저장 시 -1.
  3. **저장**: `saveFreeNavershoppingRankToHistory(supabase, row.free_navershopping_id, rank)`.
  4. **삭제**: 성공 시 **`sellermate_keywords_navershopping`** 에서 해당 행(id) DELETE.
- **옵션**: `--limit=N`, `--once` (1회만 처리 후 종료). 통합 러너에서는 `--limit=1 --once` 로 호출.
- **환경**: `dotenv` 로 Supabase 연결. IP 로테이션은 유료 배치와 동일하게 필요 시 적용.

### 2.3 통합 러너 순서 변경

- **파일**: `run-unified.ts`.
- **변경 내용**:
  1. **runShopFreeOnce()** 추가:  
     `rank-check/batch/check-free-navership-batch.ts` 를 `--limit=1 --once` 로 실행 (같은 방식으로 getTsxArgs + run).
  2. **라운드 순서**:  
     `runShoppingOnce()` → `runPlaceSlotOnce()` → `runPlaceFreeOnce()` → **runShopFreeOnce()** → 대기 → 반복.
  3. 주석·콘솔 문구: "쇼핑 1건 → 플레이스(유료) 1건 → 플레이스(무료) 1건 → **쇼핑(무료) 1건** → 반복" 으로 수정.

---

## 3. 테이블 스키마 가정 (확인 필요)

구현 시 아래와 맞는지 DB에서 한 번 확인하는 것이 좋음.

- **sellermate_keywords_navershopping** (키워드 조회용, 유료·무료 공통)  
  - 유료: `slot_id` not null (기존).  
  - **무료**: `free_navershopping_id` not null (또는 동일 역할 컬럼).  
  - 공통: `id`, `keyword`, `link_url` 등.

- **sellermate_free_navershopping_rank_history**  
  - 최소:  
    - `free_navershopping_id` (FK, keywords_navershopping.free_navershopping_id 와 연결)  
    - `rank` (integer, 미발견 -1)  
    - `rank_date` (date 또는 timestamp).  
  - FK 컬럼명이 다르면 저장 함수 INSERT 컬럼만 맞추면 됨.

---

## 4. 파일별 작업 요약

| 파일 | 작업 |
|------|------|
| `rank-check/utils/save-rank-to-slot-naver.ts` 또는 `rank-check/utils/save-free-navership-rank.ts` | `saveFreeNavershoppingRankToHistory()` 추가. `sellermate_free_navershopping_rank_history` INSERT. |
| `rank-check/batch/check-free-navership-batch.ts` | 신규. **sellermate_keywords_navershopping** 에서 free_navershopping_id not null 로 1건 조회 → ParallelRankChecker → 저장 → 키워드 행 삭제. `--limit`, `--once` 지원. |
| `run-unified.ts` | `runShopFreeOnce()` 추가, 라운드에 쇼핑(무료) 1건 삽입, 순서 및 문구 수정. |
| `rank-check/config/supabase-tables.ts` (선택) | 무료용 테이블명 상수 추가 시 참고용. |

---

## 5. 실행 순서 (최종)

```
라운드 N:
  1. 쇼핑(유료) 1건     — check-batch-keywords.ts --limit=1 --once
  2. 플레이스(유료) 1건 — check-place-batch.ts --slot-only --limit=1 --once
  3. 플레이스(무료) 1건 — check-place-batch.ts --free-only --limit=1 --once
  4. 쇼핑(무료) 1건     — check-free-navership-batch.ts --limit=1 --once
  → 대기 3초 → 라운드 N+1
```

---

## 6. 정리

- **키워드 조회**: 유료·무료 모두 **sellermate_keywords_navershopping**. 무료는 `free_navershopping_id` not null 로 구분.
- **동일 로직**: 네이버쇼핑 유료와 같은 `ParallelRankChecker`로 순위만 구하고, 무료는 **순위체크만** 해서 `sellermate_free_navershopping_rank_history` 에만 넣음.
- **추가할 것**: 무료용 저장 함수 1개, 무료 전용 배치 1개(키워드 조회는 keywords_navershopping), 통합 러너에 쇼핑(무료) 1건 단계 추가.
- **순서**: 쇼핑 1건 → 플레이스(유료) 1건 → 플레이스(무료) 1건 → **쇼핑(무료) 1건** → 반복.

이대로 적용하면 네이버쇼핑 무료 프로그램이 유료와 동일한 순위체크 로직으로 동작하고, 지정한 순서로 통합 러너에 붙게 됨.
