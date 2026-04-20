# 플레이스 무료 순위체크 vs 쇼핑 무료 순위체크 파악 보고서

**요청**:  
- `http://localhost:3000/sellermate/placerank?sellermate=1` 에는 **순위체크**(유료) + **플레이스 무료 순위체크** 가 있음.  
- `http://localhost:3000/sellermate/shoprank?sellermate=1` 에 **쇼핑 무료 순위체크** 테이블을 만들어 두었음.  
- 플레이스 무료 순위체크와 똑같이, **쇼핑 무료 순위체크**도 있게 추가하려 함.  
- **파악해서 보고만 함 (소스 수정 없음).**

---

## 1. placerank 페이지 구조 (추정)

| 구분 | 설명 | 데이터 소스 (이 레포 기준) |
|------|------|----------------------------|
| **순위체크** | 유료 슬롯 순위 | `sellermate_slot_place` + `sellermate_slot_rank_place_history` |
| **플레이스 무료 순위체크** | 무료 플레이스 순위 | `sellermate_free_place_rank_history` (및 대기열 `sellermate_keywords_place` 중 free_place_id 있는 항목) |

---

## 2. 플레이스 무료 순위체크 — 이 레포에서의 흐름 (전부 구현됨)

### 2.1 테이블

| 테이블 | 역할 |
|--------|------|
| **sellermate_keywords_place** | 대기열. `free_place_id` 가 not null 이면 "무료 플레이스" 작업. 처리 후 해당 행 삭제. |
| **sellermate_free_place_rank_history** | 무료 플레이스 순위 히스토리. 컬럼: `free_place_id`, `rank`(미발견 시 -1), `rank_date`(YYYY-MM-DD). |

### 2.2 배치 진입점

- **파일**: `place-check/batch/check-place-batch.ts`
- **옵션**: `--free-only` 시 무료만 처리.
- **쿼리**:  
  `sellermate_keywords_place` 에서  
  `free_place_id` is not null,  
  `keyword`, `link_url` not null,  
  order by id, limit N.

### 2.3 처리 로직 (무료 분기)

- **분기**: 각 키워드 행에서 `kw.free_place_id != null` 이면 무료 플레이스 분기.
- **순위 체크**:  
  `place-check/check-place-rank-core.ts` 의 **checkPlaceRankRankOnly(page, link_url, keyword)**  
  - 네이버 모바일 검색 → 플레이스 리스트에서 순위만 검색 (상세 진입 없음).  
  - 반환: `PlaceRankResult | null` (rank, placeName 등).
- **저장**:  
  `place-check/utils/save-rank-to-slot-place.ts` 의 **saveFreePlaceRankToHistory(supabase, free_place_id, rank)**  
  - `sellermate_free_place_rank_history` 에 INSERT:  
    `free_place_id`, `rank`(1 이상 또는 미발견 시 -1), `rank_date`(날짜).
- **후처리**: 저장 성공 시 `sellermate_keywords_place` 에서 해당 행(id) DELETE.

### 2.4 통합 러너

- **파일**: `run-unified.ts`
- **순서**: 쇼핑 1건 → 플레이스(유료) 1건 → **플레이스(무료) 1건** → 반복.
- 플레이스 무료는 `check-place-batch.ts --free-only --limit=1 --once` 로 1건씩 실행.

---

## 3. shoprank 페이지 구조 (추정)

| 구분 | 설명 | 데이터 소스 (이 레포 기준) |
|------|------|----------------------------|
| **순위체크** | 유료 슬롯 순위 | `sellermate_slot_naver` + `sellermate_slot_rank_naver_history` |
| **쇼핑 무료 순위체크** | 무료 쇼핑 순위 | **키워드 조회**: `sellermate_keywords_navershopping` (free_navershopping_id not null). **히스토리**: `sellermate_free_navershopping_rank_history`. 이 레포 배치/저장 로직은 미구현. |

---

## 4. 쇼핑 무료 순위체크 — 이 레포에서의 현황

### 4.1 사용자가 만든 테이블 / 키워드 조회

| 테이블 | 역할 (추정) |
|--------|--------------|
| **sellermate_keywords_navershopping** | **키워드 조회는 여기서 함** (유료·무료 공통). 무료는 `free_navershopping_id` not null 로 구분. 처리 후 해당 행 삭제. |
| **sellermate_free_navershopping** | 쇼핑 무료 마스터/메타 (필요 시). 키워드 조회는 위 keywords 테이블 기준. |
| **sellermate_free_navershopping_rank_history** | 쇼핑 무료 순위 히스토리. `free_navershopping_id`, `rank`, `rank_date` 등 저장용. |

### 4.2 코드 상 존재 여부

- **이 레포**에서는 위 두 테이블명을 참조하는 코드 **없음**.
- `rank-check` 쪽은 `sellermate_keywords_navershopping`(유료 슬롯용)만 사용.
- 쇼핑 “무료” 전용 배치·`saveFreeShopRankToHistory` 같은 함수 **없음**.

즉, **쇼핑 무료 순위체크**용 테이블은 DB에 만들어져 있고, **이 레포의 자동화(배치/저장)는 아직 연결되지 않은 상태**.

### 4.3 플레이스 무료와 1:1로 맞추려면 필요한 것 (정리만, 수정 없음)

플레이스 무료 순위체크와 **같은 방식**으로 쇼핑 무료 순위체크를 하려면, 개념적으로 아래가 필요함.  
**테이블은 이미 있음**: `sellermate_free_navershopping`, `sellermate_free_navershopping_rank_history`.

| 항목 | 플레이스 무료 (현재 구현) | 쇼핑 무료 (필요한 것) |
|------|---------------------------|------------------------|
| **대기열/키워드 조회** | `sellermate_keywords_place` + `free_place_id` not null | **`sellermate_keywords_navershopping`** + `free_navershopping_id` not null (같은 키워드 테이블에서 무료만 조회). |
| **히스토리** | `sellermate_free_place_rank_history` (free_place_id, rank, rank_date) | **`sellermate_free_navershopping_rank_history`** (이미 생성됨).  
  - 최소: free_navershopping_id, **rank**(미발견 -1), **rank_date**(날짜). |
| **순위 체크** | `checkPlaceRankRankOnly()` — 플레이스 검색·리스트에서 순위만 | 쇼핑 검색·리스트에서 **순위만** (ParallelRankChecker 재사용). |
| **저장** | `saveFreePlaceRankToHistory(supabase, free_place_id, rank)` | `sellermate_free_navershopping_rank_history` 에 INSERT (예: saveFreeNavershoppingRankToHistory). |
| **배치** | `check-place-batch.ts --free-only` | 쇼핑 무료 전용 배치:  
  - **sellermate_keywords_navershopping** 에서 free_navershopping_id not null 로 조회 → 순위만 체크 → **sellermate_free_navershopping_rank_history** 저장 → 키워드 행 삭제. |
| **통합 러너** | `run-unified.ts` 에서 플레이스(무료) 1건 호출 | 동일하게 “쇼핑 무료 1건” 스텝 추가 가능 (해당 배치 호출). |

---

## 5. placerank / shoprank 화면 쪽 (동일하게 갖추기)

- **placerank**:  
  - 순위체크(유료) 영역 + **플레이스 무료 순위체크** 영역(테이블/필터 등)이 있음.
- **shoprank**:  
  - 순위체크(유료) 영역 + **쇼핑 무료 순위체크** 테이블(`sellermate_free_navershopping`, `sellermate_free_navershopping_rank_history`)이 있음.  
  - 플레이스 무료와 똑같이 하려면:  
  - **쇼핑 무료 순위체크**용 UI를 **플레이스 무료 순위체크**와 같은 구조로 두고,  
  - 데이터만 `sellermate_keywords_navershopping`(무료 구분) / `sellermate_free_navershopping_rank_history` 기준으로 조회/표시하면 됨.

(실제 placerank/shoprank 페이지 소스는 이 레포에 없으므로, 화면 구조는 localhost에서 확인한 내용 기준으로 이해한 것임.)

---

## 6. 요약

| 구분 | 플레이스 무료 순위체크 | 쇼핑 무료 순위체크 |
|------|------------------------|---------------------|
| **키워드 조회** | `sellermate_keywords_place` (free_place_id not null) | **`sellermate_keywords_navershopping`** (free_navershopping_id not null) |
| **히스토리** | `sellermate_free_place_rank_history` | **`sellermate_free_navershopping_rank_history`** (DB 생성됨) |
| **이 레포 배치** | 구현됨 (`check-place-batch.ts --free-only`) | 미구현. |
| **이 레포 저장 함수** | `saveFreePlaceRankToHistory()` | 없음. |
| **통합 러너** | 플레이스(무료) 1건 포함됨 | 쇼핑 무료 단계 없음. |

**결론**:  
- **플레이스 무료 순위체크**는 이 레포에서 테이블·배치·저장·통합러너까지 전부 구현되어 있음.  
- **쇼핑 무료 순위체크**는 **키워드 조회를 `sellermate_keywords_navershopping`** 에서 하고, `free_navershopping_id` not null 로 무료만 구분. **히스토리**는 **`sellermate_free_navershopping_rank_history`** 에 저장.  
- **이 레포에는** 위 흐름(키워드 조회·순위만 체크·히스토리 저장·배치/통합러너)이 **아직 없음.**  
- 플레이스 무료와 똑같이 하려면, “**sellermate_keywords_navershopping** 에서 free_navershopping_id not null 조회 → 순위만 체크 → sellermate_free_navershopping_rank_history 저장 → 키워드 행 삭제 → 배치 및 통합 러너” 를 추가하면 됨.
