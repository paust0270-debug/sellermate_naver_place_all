/**
 * 브라우저 컨텍스트 전용 (tsx 번들 없음). parallel-rank-checker에서 문자열로 주입.
 */
function findRankByProductIdOnPage(targetId) {
  function extractNvMidFromHref(href) {
    if (!href) return null;
    const m = href.match(/[?&]nv_mid=(\d+)/i) || href.match(/[?&]nvMid=(\d+)/i);
    return m ? m[1] : null;
  }

  const result = {
    found: false,
    pageRank: null,
    nvMid: null,
    contentsId: null,
    catalogNvMid: null,
    chnlProdNo: null,
    productName: null,
    isAd: false,
    productIndex: null,
    wishCount: null,
    reviewCount: null,
    starCount: null,
    monthCount: null,
    productImageUrl: null,
    price: null,
    shippingFee: null,
    keywordName: null,
    tradeName: null,
  };

  const anchors = document.querySelectorAll(
    'a[data-shp-contents-id][data-shp-contents-rank][data-shp-contents-dtl]'
  );

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const mid = anchor.getAttribute('data-shp-contents-id');
    if (!mid || !/^\d{10,}$/.test(mid)) continue;

    const dtl = anchor.getAttribute('data-shp-contents-dtl');
    const rankStr = anchor.getAttribute('data-shp-contents-rank');
    const inventory = anchor.getAttribute('data-shp-inventory') || '';

    if (!dtl || !rankStr) continue;

    try {
      const normalized = dtl.replace(/&quot;/g, '"');
      const parsed = JSON.parse(normalized);

      if (!Array.isArray(parsed)) continue;

      let chnlProdNo = null;
      let catalogNvMid = null;
      let prodName = null;
      let chnlNm = null;

      for (let j = 0; j < parsed.length; j++) {
        const item = parsed[j];
        if (item.key === 'chnl_prod_no' && item.value) {
          chnlProdNo = String(item.value);
        }
        if (item.key === 'catalog_nv_mid' && item.value) {
          catalogNvMid = String(item.value);
        }
        if (item.key === 'prod_nm' && item.value) {
          prodName = String(item.value).substring(0, 60);
        }
        if ((item.key === 'chnl_nm' || item.key === 'mall_nm') && item.value) {
          chnlNm = String(item.value).trim();
        }
      }

      if (!targetId || chnlProdNo !== targetId) continue;

      result.found = true;
      result.pageRank = parseInt(rankStr, 10);
      result.catalogNvMid = catalogNvMid;
      result.chnlProdNo = chnlProdNo;
      result.productName = prodName;
      result.isAd = /lst\*(A|P|D)/.test(inventory);
      result.productIndex = i;

      const contentsType = anchor.getAttribute('data-shp-contents-type') || '';
      let nvMid = extractNvMidFromHref(anchor.getAttribute('href'));

      const contentsId =
        contentsType === 'nv_mid' && mid && /^\d{10,}$/.test(mid)
          ? mid
          : mid && /^\d{10,}$/.test(mid)
            ? mid
            : null;

      const productItem = anchor.closest('.product_item__KQayS');
      if (productItem) {
        const bridgeLinks = productItem.querySelectorAll(
          'a[href*="nv_mid="], a[href*="nvMid="], a[href*="shopping.naver.com"], a.H8pFM9kD, a[class*="H8pFM9kD"]'
        );
        for (let li = 0; li < bridgeLinks.length; li++) {
          const linkEl = bridgeLinks[li];
          const fromBridge = extractNvMidFromHref(
            linkEl && linkEl.href ? linkEl.href : null
          );
          if (fromBridge) {
            nvMid = fromBridge;
            break;
          }
        }

        const wishElement = productItem.querySelector(
          '.product_text__UdGUv .product_num__WuH26'
        );
        if (wishElement) {
          const wishText =
            (wishElement.textContent || '').trim().replace(/,/g, '') || '';
          result.wishCount = parseInt(wishText, 10) || null;
        }

        const reviewElements = productItem.querySelectorAll('.product_etc__Z7jnS');
        for (let re = 0; re < reviewElements.length; re++) {
          const elem = reviewElements[re];
          const text = elem.textContent || '';
          if (text.includes('리뷰')) {
            const reviewMatch = text.match(/리뷰\s*(\d+)|\((\d+(?:,\d+)*)\)/);
            if (reviewMatch) {
              const reviewNum = reviewMatch[1] || reviewMatch[2];
              result.reviewCount =
                parseInt(String(reviewNum).replace(/,/g, ''), 10) || null;
              break;
            }
          }
        }

        const starElement = productItem.querySelector('.product_grade__O_5f5');
        if (starElement) {
          const starText = (starElement.textContent || '').trim() || '';
          const starMatch = starText.match(/(\d+\.?\d*)/);
          if (starMatch) {
            result.starCount = parseFloat(starMatch[1]) || null;
          }
        }

        const purchaseElements = productItem.querySelectorAll('.product_etc__Z7jnS');
        for (let pe = 0; pe < purchaseElements.length; pe++) {
          const elem = purchaseElements[pe];
          const text = elem.textContent || '';
          if (text.includes('구매')) {
            const purchaseMatch = text.match(/구매\s*(\d+(?:,\d+)*)/);
            if (purchaseMatch) {
              result.monthCount =
                parseInt(purchaseMatch[1].replace(/,/g, ''), 10) || null;
              break;
            }
          }
        }

        const imgElement = productItem.querySelector(
          'img[src*="shopping-phinf.pstatic.net"], img[src*="shop-phinf.pstatic.net"]'
        );
        if (imgElement) {
          result.productImageUrl =
            imgElement.src || imgElement.getAttribute('data-src') || null;
          const altText = imgElement.getAttribute('alt');
          if (altText) {
            result.keywordName = altText.trim();
          }
        }

        const priceElement = productItem.querySelector(
          '.price_num__Y66T7 em, .product_price__ozt5Q em, .price em'
        );
        if (priceElement) {
          const priceText =
            (priceElement.textContent || '')
              .trim()
              .replace(/,/g, '')
              .replace(/원/g, '') || '';
          result.price = parseInt(priceText, 10) || null;
        }

        const shippingElement = productItem.querySelector(
          '.price_delivery_fee__8n1e5, .deliveryInfo_info_shipping__rRt1K'
        );
        if (shippingElement) {
          const shippingText = shippingElement.textContent || '';
          if (shippingText.includes('무료') || shippingText.includes('무료배송')) {
            result.shippingFee = 0;
          } else {
            const shippingMatch = shippingText.match(/(\d+(?:,\d+)*)\s*원/);
            if (shippingMatch) {
              result.shippingFee =
                parseInt(shippingMatch[1].replace(/,/g, ''), 10) || null;
            }
          }
        }

        const storeLinkSelectors = [
          'a[href*="smartstore.naver.com/inflow/outlink"]',
          'a[href*="brand.naver.com/inflow/outlink"]',
          'a.iMhVFYLc',
          'a[class*="iMhVFYLc"]',
        ];
        for (let si = 0; si < storeLinkSelectors.length; si++) {
          const storeEl = productItem.querySelector(storeLinkSelectors[si]);
          if (storeEl) {
            const text = (storeEl.textContent || '').trim();
            if (text && text.length > 0 && text.length <= 50) {
              result.tradeName = text;
              break;
            }
          }
        }
      }

      if (!result.tradeName && chnlNm) {
        result.tradeName = chnlNm;
      }

      result.nvMid = nvMid;
      result.contentsId = contentsId;
      return result;
    } catch (_e) {
      /* next anchor */
    }
  }

  return result;
}
