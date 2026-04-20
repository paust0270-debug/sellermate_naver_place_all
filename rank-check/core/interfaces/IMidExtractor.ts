/**
 * MID 추출기 인터페이스 (OCP 준수)
 *
 * 새로운 URL 패턴이 추가되면 이 인터페이스를 구현하는
 * 새 클래스를 만들면 됨 (기존 코드 수정 불필요)
 */
export interface IMidExtractor {
  /** 이 추출기가 해당 URL을 처리할 수 있는지 확인 */
  canHandle(url: string): boolean;

  /** URL에서 MID 추출 */
  extract(url: string): string | null;

  /** 추출기 이름 (디버깅용) */
  readonly name: string;
}
