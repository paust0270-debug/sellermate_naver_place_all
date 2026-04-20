# 네이버 플레이스 순위 체크

네이버 검색 → 플레이스 리스트에서 특정 장소의 순위를 찾는 테스트 스크립트입니다.

## 흐름

1. **naver.me 단축 URL 해석** → 실제 플레이스 URL, placeId, 장소명 추출
2. **네이버 메인** → 키워드 검색 (예: 강남맛집)
3. **"키워드+더보기" 클릭** → map.naver.com 플레이스 리스트 진입
4. **리스트에서 순위 검색** → placeId 또는 장소명으로 매칭

## 봇 우회

`place-check/utils/humanBehavior.ts` 참조:
- `humanType` - 자연스러운 타이핑
- `humanScroll` - 자연스러운 스크롤
- `humanClickWithWander` - 화면 훑어보기 후 클릭

## 배치 (셀러메이트 플레이스 전용)

순위 체크 배치는 **셀러메이트 전용 테이블**만 사용합니다.

- **테이블**: `sellermate_keywords_place` → `sellermate_slot_place` → `sellermate_slot_rank_place_history`
- **실행**: `npm run place-batch` 또는 `npx tsx place-check/batch/check-place-batch.ts [--limit=N] [--force-top20]`
- `sellermate_keywords_place`에 적재된 항목을 처리한 뒤 삭제하며, 순위 결과는 `sellermate_slot_rank_place_history`에 저장됩니다.

## 실행

```bash
npm run place
# 또는
run-place-check.bat
# 또는
npx tsx place-check/check-place-rank.ts
```

## 설정

`place-check/check-place-rank.ts` 상단에서 수정:
- `KEYWORD` - 검색 키워드 (기본: 강남맛집)
- `TARGET_SHORT_URL` - 확인할 naver.me 단축 URL
