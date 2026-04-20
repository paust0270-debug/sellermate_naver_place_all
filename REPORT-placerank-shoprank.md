# placerank → shoprank 페이지 로직 적용 조사 보고서

**작성 목적**: `https://www.sellermate.ai.kr/sellermate/placerank?sellermate=1` 페이지 로직을  
`https://www.sellermate.ai.kr/sellermate/shoprank?sellermate=1` 페이지에 동일하게 적용하기 위한 **데이터·로직 정리 및 적용 가이드**.

**조사 범위**: 이 저장소(`sellermate_naver_place_all`)는 **자동화(배치)** 만 포함.  
placerank / shoprank **웹 페이지 UI 코드는 별도 프론트엔드 프로젝트**에 있음.  
동일 DB(Supabase)를 사용하므로, 이 레포의 **테이블·필드·저장 로직**을 기준으로 프론트 적용 시 참고.

---

## 1. 저장소 역할 정리

| 구분 | 내용 |
|------|------|
| **이 레포** | 네이버 플레이스/쇼핑 순위 자동 체크 → Supabase 저장 (배치만) |
| **placerank 페이지** | 셀러메이트 웹에서 **플레이스 순위** 조회/표시 (프론트, 별도 레포) |
| **shoprank 페이지** | 셀러메이트 웹에서 **쇼핑 순위** 조회/표시 (프론트, 별도 레포) |
| **DB** | `rank-check/config/supabase-tables.ts` 주석: *localhost:3000/sellermate/naver 와 동일 DB 사용* |

---

## 2. placerank (플레이스) 데이터 구조

### 2.1 테이블 관계

```
sellermate_keywords_place  (대기열, 처리 후 삭제)
    ↓ slot_id / free_place_id
sellermate_slot_place      (유료 슬롯 현재 상태)
    ↓ id = slot_status_id
sellermate_slot_rank_place_history   (유료 순위 히스토리, 건별 INSERT)
sellermate_free_place_rank_history   (무료 순위 히스토리, free_place_id 기준)
sellermate_place_competitors          (상위 20개 경쟁사, 키워드당 하루 1회)
```

### 2.2 키워드 테이블: `sellermate_keywords_place`

| 필드 | 용도 |
|------|------|
| id | PK |
| slot_id | 유료 슬롯 ID (유료일 때) |
| free_place_id | 무료 플레이스 ID (무료일 때) |
| keyword | 검색 키워드 |
| link_url | 플레이스 URL (naver.me 또는 place URL) |
| slot_sequence, slot_type, customer_id | 메타 |

- 배치 옵션: `--slot-only`(유료만), `--free-only`(무료만). 없으면 둘 다.

### 2.3 슬롯 테이블: `sellermate_slot_place`

- **업데이트 필드**: `current_rank`, `keyword`, `link_url`, `updated_at`
- **시작순위**: `start_rank` 는 최초 1회만 기록(기존 null일 때만)
- **조회**: `slot_id` 로 키워드와 매칭

### 2.4 히스토리 테이블: `sellermate_slot_rank_place_history`

**공통 필드 (프론트에서 placerank/shoprank 동일 로직 적용 시 기준)**:

| 컬럼 | 타입 | 설명 |
|------|------|------|
| slot_status_id | FK | 슬롯 PK (sellermate_slot_place.id) |
| keyword | string | 검색 키워드 |
| link_url | string | 타겟 URL |
| current_rank | number | 현재 순위 (미발견 -1) |
| start_rank | number | 시작 순위 |
| previous_rank | number \| null | 이전 순위 |
| rank_change | number \| null | current - previous |
| rank_diff | number \| null | rank_change 와 동일 |
| start_rank_diff | number \| null | current - start_rank |
| slot_sequence | number \| null | |
| slot_type | string | '플레이스' |
| customer_id | string | |
| rank_date | timestamp | 기록 시각 |
| keyword_name | string \| null | 장소명/상품명 |

**플레이스 전용 추가 필드**:

| 컬럼 | 설명 |
|------|------|
| review_count | 방문자 리뷰 수 |
| star_count | 별점 |
| product_image_url | 대표 이미지 URL |
| visitor_review_count | 방문자 리뷰 |
| blog_review_count | 블로그 리뷰 |
| category | 카테고리 |

- 저장: `place-check/utils/save-rank-to-slot-place.ts` → `saveRankToSlotPlace()` 한 번 호출당 1건 INSERT.

### 2.5 무료 플레이스: `sellermate_free_place_rank_history`

| 컬럼 | 설명 |
|------|------|
| free_place_id | 무료 플레이스 ID |
| rank | 순위 (미발견 -1) |
| rank_date | YYYY-MM-DD |

- 상위 20개/경쟁사 분석 없음. 순위만 저장.

### 2.6 플레이스 배치 흐름 (요약)

1. `sellermate_keywords_place` 조회 (slot_only / free_only / 혼합)
2. 브라우저 1개로 순차 처리
3. **유료**: `checkPlaceRank()` 또는 `checkPlaceRankRankOnly()` → `saveRankToSlotPlace()` → `sellermate_slot_place` UPDATE, `sellermate_slot_rank_place_history` INSERT. 상위 20개는 `sellermate_place_competitors` (키워드당 하루 1회).
4. **무료**: `checkPlaceRankRankOnly()` → `saveFreePlaceRankToHistory()` → `sellermate_free_place_rank_history` INSERT, 키워드 행 삭제.
5. 처리한 키워드는 `sellermate_keywords_place` 에서 삭제.

---

## 3. shoprank (쇼핑) 데이터 구조

### 3.1 테이블 관계

```
sellermate_keywords_navershopping  (대기열, 처리 후 삭제)
    ↓ slot_id / slot_sequence / keyword+link_url
sellermate_slot_naver              (슬롯 현재 상태)
    ↓ id = slot_status_id
sellermate_slot_rank_naver_history  (순위 히스토리, 건별 INSERT)
```

- 무료/경쟁사 전용 테이블 없음.

### 3.2 키워드 테이블: `sellermate_keywords_navershopping`

| 필드 | 용도 |
|------|------|
| id | PK |
| slot_id | 슬롯 ID (우선 매칭) |
| keyword | 검색 키워드 |
| link_url | 상품 URL (/products/숫자 포함) |
| slot_sequence, slot_type, customer_id | 메타 |
| last_check_date | 배치가 오래된 순으로 할당 시 사용 |

- 배치: `rank-check/batch/check-batch-keywords.ts` → `last_check_date` 오래된 순, `slot_id` not null 등 조건.

### 3.3 슬롯 테이블: `sellermate_slot_naver`

- **업데이트**: `current_rank`, `start_rank`, `keyword`, `link_url`, `updated_at`
- **순위권 밖(-1)**: `current_rank` 는 갱신하지 않고, 히스토리만 INSERT.
- **신규**: 슬롯 없으면 INSERT (expiry_date 등 포함).

### 3.4 히스토리 테이블: `sellermate_slot_rank_naver_history`

**placerank 히스토리와 공통인 필드**:

- slot_status_id, keyword, link_url  
- current_rank, start_rank, previous_rank  
- rank_change, rank_diff, start_rank_diff  
- slot_sequence, slot_type, customer_id  
- rank_date, created_at  
- keyword_name (상품명)

**쇼핑 전용 추가 필드**:

| 컬럼 | 설명 |
|------|------|
| price | 가격 |
| price_sale | 배송비 등 |
| review_count | 리뷰 수 |
| product_image_url | 상품 이미지 |
| star_count | 별점 |
| month_count | 6개월 구매 수 등 |

- 저장: `rank-check/utils/save-rank-to-slot-naver.ts` → `saveRankToSlotNaver()` 한 번당 1건 INSERT.

### 3.5 쇼핑 배치 흐름 (요약)

1. `sellermate_keywords_navershopping` 에서 `last_check_date` 오래된 순으로 할당.
2. `ParallelRankChecker.checkUrls()` 로 순위 체크 (1건이면 브라우저 1개 순차).
3. `saveRankToSlotNaver()` → `sellermate_slot_naver` UPDATE/INSERT, `sellermate_slot_rank_naver_history` INSERT.
4. 처리한 키워드는 `sellermate_keywords_navershopping` 에서 삭제.

---

## 4. placerank vs shoprank 비교 요약

| 항목 | placerank (플레이스) | shoprank (쇼핑) |
|------|----------------------|-----------------|
| **키워드 테이블** | sellermate_keywords_place | sellermate_keywords_navershopping |
| **슬롯 테이블** | sellermate_slot_place | sellermate_slot_naver |
| **히스토리 테이블** | sellermate_slot_rank_place_history | sellermate_slot_rank_naver_history |
| **추가 테이블** | sellermate_free_place_rank_history, sellermate_place_competitors | 없음 |
| **공통 히스토리 컬럼** | slot_status_id, keyword, link_url, current_rank, start_rank, previous_rank, rank_change, rank_diff, start_rank_diff, rank_date, keyword_name, slot_sequence, slot_type, customer_id | 동일 |
| **도메인 전용 필드** | visitor_review_count, blog_review_count, category, review_count, star_count, product_image_url | price, price_sale, review_count, product_image_url, star_count, month_count |
| **미발견 순위** | -1 | -1 |
| **시작순위** | 최초 1회만 기록 | 동일 로직 |

---

## 5. placerank 로직을 shoprank에 적용할 때 체크리스트

프론트엔드(placerank / shoprank 페이지)에서 **동일한 페이지 로직**을 적용하려면 아래를 기준으로 하면 됨.

### 5.1 데이터 소스만 교체

- **placerank**:  
  - 슬롯: `sellermate_slot_place`  
  - 히스토리: `sellermate_slot_rank_place_history`  
  - (무료) `sellermate_free_place_rank_history`  
  - (경쟁사) `sellermate_place_competitors`
- **shoprank**:  
  - 슬롯: `sellermate_slot_naver`  
  - 히스토리: `sellermate_slot_rank_naver_history`  
  - 추가 테이블 없음.

### 5.2 공통으로 쓸 수 있는 것

- **공통 히스토리 컬럼**:  
  `slot_status_id`, `keyword`, `link_url`, `current_rank`, `start_rank`, `previous_rank`, `rank_change`, `rank_diff`, `start_rank_diff`, `rank_date`, `keyword_name`, `slot_sequence`, `slot_type`, `customer_id`
- **표시 로직**:  
  순위 상승/하락, 시작대비 변화, 미발견(-1) 처리, 기간 필터, 정렬, 페이징 등은 **테이블명·도메인 필드만 바꿔서** 동일하게 적용 가능.

### 5.3 도메인별로만 다른 것

- **표시 필드**:  
  - 플레이스: 리뷰 수, 별점, 카테고리, 이미지 등 → place 히스토리/competitors 컬럼.  
  - 쇼핑: 가격, 리뷰 수, 별점, 이미지, 월 구매 수 등 → naver 히스토리 컬럼.
- **무료/경쟁사**:  
  - placerank: 무료 탭/경쟁사 상위 20 등 → free_place_rank_history, place_competitors 사용.  
  - shoprank: 해당 기능 없음 → 동일 UI를 쓰지 않거나, 쇼핑용 별도 API만 두면 됨.

### 5.4 적용 순서 제안

1. **placerank 페이지**에서 사용하는 **API/훅/컴포넌트**를 정리 (슬롯 목록, 히스토리 조회, 필터, 차트 등).
2. **공통 컴포넌트** 추출:  
   - 테이블/카드 레이아웃, 기간 선택, 정렬, 순위 변화 뱃지 등은 **데이터 소스만 props로 받도록** 분리.
3. **shoprank**에서는 위 공통 컴포넌트에 **sellermate_slot_naver + sellermate_slot_rank_naver_history** 기반 데이터만 넣고,  
   컬럼명은 위 표의 **공통 필드 + 쇼핑 전용 필드**로 매핑.
4. **필드 매핑표**를 프론트에 두고,  
   - placerank: `keyword_name` ← placeName, `review_count` ← visitorReviewCount 등  
   - shoprank: `keyword_name` ← productName, `price`, `review_count` 등  
   로 통일해 두면 유지보수 용이.

---

## 6. 이 저장소 내 참고 파일

| 용도 | 경로 |
|------|------|
| 플레이스 저장 로직 | `place-check/utils/save-rank-to-slot-place.ts` |
| 플레이스 배치 (유료/무료 분리) | `place-check/batch/check-place-batch.ts` |
| 플레이스 순위 체크 코어 | `place-check/check-place-rank-core.ts` |
| 쇼핑 테이블명 | `rank-check/config/supabase-tables.ts` |
| 쇼핑 저장 로직 | `rank-check/utils/save-rank-to-slot-naver.ts` |
| 쇼핑 배치 | `rank-check/batch/check-batch-keywords.ts` |
| 통합 러너 (쇼핑→플레이스 유료→플레이스 무료) | `run-unified.ts` |

---

## 7. 결론

- **placerank**와 **shoprank**는 **같은 Supabase**를 쓰며, **히스토리 테이블의 공통 컬럼 구조**가 같아서,  
  프론트에서 **같은 페이지 로직(목록/필터/기간/순위 변화 표시)** 을 쓰기 좋게 되어 있음.
- **적용 방법**:  
  - placerank 페이지의 **데이터 소스만** `sellermate_slot_naver` / `sellermate_slot_rank_naver_history` 로 바꾸고,  
  - **도메인 전용 컬럼**(가격, 리뷰, 이미지 등)만 쇼핑 스키마에 맞게 매핑하면,  
  **동일한 페이지 로직**을 shoprank에 적용할 수 있음.
- **실제 UI 코드**는 셀러메이트 웹(프론트) 레포에서 수정해야 하며,  
  이 레포는 **테이블·필드·저장 규칙**을 정의하는 기준으로 참고하면 됨.
