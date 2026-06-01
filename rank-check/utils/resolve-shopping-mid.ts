/**
 * 네이버 쇼핑 순위체크 MID(nv_mid) 저장 우선순위
 */

export function isValidMidId(value: string | null | undefined): boolean {
  return /^\d{10,}$/.test(String(value ?? '').trim());
}

/** data-shp-contents-id → contentsId (type=nv_mid 이거나 10자리+ 숫자) */
export function extractContentsIdFromAnchor(
  contentsType: string | null | undefined,
  contentsIdAttr: string | null | undefined
): string | null {
  const id = String(contentsIdAttr ?? '').trim();
  if (!isValidMidId(id)) return null;
  const type = String(contentsType ?? '').trim().toLowerCase();
  if (type === 'nv_mid' || isValidMidId(id)) return id;
  return null;
}

/** DB mid: nv_mid → contentsId → catalog_nv_mid → productId */
export function resolveStoredMid(
  nvMid: string | null | undefined,
  contentsId: string | null | undefined,
  catalogNvMid: string | null | undefined,
  productId: string | null | undefined
): string | null {
  for (const candidate of [nvMid, contentsId, catalogNvMid, productId]) {
    if (isValidMidId(candidate)) return String(candidate).trim();
  }
  return null;
}

export function midSourceLabel(
  storedMid: string | null,
  nvMid: string | null | undefined,
  contentsId: string | null | undefined,
  catalogNvMid: string | null | undefined,
  productId: string | null | undefined
): 'nv_mid' | 'contents_id' | 'catalog_nv_mid' | 'product_id' | 'failed' {
  if (!storedMid) return 'failed';
  if (isValidMidId(nvMid) && String(nvMid).trim() === storedMid) return 'nv_mid';
  if (isValidMidId(contentsId) && String(contentsId).trim() === storedMid) return 'contents_id';
  if (isValidMidId(catalogNvMid) && String(catalogNvMid).trim() === storedMid)
    return 'catalog_nv_mid';
  if (isValidMidId(productId) && String(productId).trim() === storedMid) return 'product_id';
  return 'failed';
}
