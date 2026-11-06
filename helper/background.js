// 컷토리 도우미: 내 브라우저의 네이버 로그인으로 브랜드커넥트 상품을 찾고 링크를 발급해요.
// 사용자가 컷토리에서 검색하거나 탭을 열 때만 요청하고, 짧은 간격의 연속 요청은 막아요.
const GW = 'https://gw-brandconnect.naver.com';
let spaceId = null;
let lastAt = 0;
const recent = [];

function fail(code, message) { const e = new Error(message); e.code = code; return e; }
async function pace() {
  const now = Date.now();
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (recent.length >= 20) throw fail('too_fast', '잠깐 쉬었다가 다시 시도해 주세요. 1분에 20번까지만 불러와요.');
  const wait = Math.max(0, 800 - (now - lastAt));
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastAt = Date.now(); recent.push(lastAt);
}
async function call(path, { method = 'GET', body, space = true } = {}) {
  await pace();
  const headers = { Accept: 'application/json, text/plain, */*' };
  if (space) headers['X-Space-Id'] = String(await getSpace());
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(GW + path, { method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 || r.status === 403) { spaceId = null; throw fail('login', '네이버 브랜드커넥트에 로그인해 주세요. 로그인 후 다시 시도하면 돼요.'); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw fail('bc_error', (j && (j.detail || j.title)) || `브랜드커넥트 응답 오류 (${r.status})`);
  return j;
}
async function getSpace() {
  if (spaceId) return spaceId;
  const me = await call('/brand-connect/query/me', { space: false });
  const id = me && (me.space?.spaceId || (me.activeSpaceIds || [])[0]);
  if (!id) throw fail('no_space', '브랜드커넥트 크리에이터 스페이스를 찾지 못했어요.');
  if (me.space && me.space.affiliateTermsAgreed === false) throw fail('terms', '브랜드커넥트에서 쇼핑 커넥트 약관에 먼저 동의해 주세요.');
  spaceId = id; return id;
}
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
function shopItem(p, group) {
  const price = p.price || {};
  return {
    kind: 'shopping', id: String(p.id ?? p.affiliateProductId), name: p.productName, store: p.storeName || group || '',
    image: p.representativeProductImageUrl || p.productImageUrl || '',
    listPrice: num(p.salePrice ?? price.salePrice), price: num(p.discountedSalePrice ?? price.discountedSalePrice ?? p.salePrice ?? price.salePrice),
    discountRate: num(p.discountedRate ?? price.discountedRate), commissionRate: num(p.commissionRate) || 0, promotionRate: num(p.promotionCommissionRate) || 0,
    rating: num(p.reviewInfo?.averageReviewScore), reviews: num(p.reviewInfo?.totalReviewCount), productUrl: p.productUrl || '', shortenUrl: p.shortenUrl || null,
    badge: p.promotionTitle || '', enabled: p.enabled !== false && p.productStatus !== 'SUSPENSION'
  };
}
function travelItem(p) {
  const x = p.extra || {};
  return {
    kind: 'travel', id: String(p.productId), name: p.name, store: p.storeName || '', image: p.representativeProductImageUrl || '',
    listPrice: num(p.salePrice), price: num(p.discountedSalePrice ?? p.salePrice), discountRate: num(p.discountedRate),
    commissionRate: num(p.commissionRate) || 0, promotionRate: num(p.promotionCommissionRate) || 0, productUrl: p.url || '', shortenUrl: p.shortenUrl || null,
    duration: x.duration || '', startDate: x.startDate || '', places: [...(x.countryNames || []), ...(x.cityNames || [])].join(', '), productType: x.productType || ''
  };
}
const handlers = {
  async status() { const me = await call('/brand-connect/query/me', { space: false }); const s = me?.spaces?.[0]; return { connected: true, profileName: s?.profileName || '', shoppingAgreed: me?.space?.affiliateTermsAgreed !== false }; },
  async 'shopping.recommend'() {
    const groups = await call('/affiliate/query/popup-stores?');
    return (Array.isArray(groups) ? groups : []).flatMap(g => (g.products || []).map(p => ({ ...shopItem(p, g.storeName), group: g.title || '' }))).slice(0, 60);
  },
  async 'shopping.search'({ query }) {
    const q = String(query || '').trim().slice(0, 50); if (!q) throw fail('bad_request', '검색어를 입력해 주세요.');
    const j = await call('/affiliate/query/affiliate-products/search-by-query?query=' + encodeURIComponent(q) + '&limit=40');
    return (j?.data || []).map(p => shopItem(p)).filter(p => p.enabled);
  },
  async 'shopping.issue'({ id }) {
    if (!/^\d{5,25}$/.test(String(id || ''))) throw fail('bad_request', '상품 번호가 올바르지 않아요.');
    const j = await call('/affiliate/command/affiliate-urls?affiliateProductId=' + encodeURIComponent(id), { method: 'POST', body: {} });
    if (!j?.shortenUrl) throw fail('issue_failed', '링크를 발급하지 못했어요. 브랜드커넥트에서 직접 확인해 주세요.');
    return { shortenUrl: j.shortenUrl };
  },
  async 'travel.recommend'({ section }) {
    const s = ['REGION_BEST', 'PRICE_DROP'].includes(section) ? section : 'REGION_BEST';
    const j = await call('/affiliate/query/connect/recommend-products?serviceType=TRAVEL_PACKAGE&section=' + s + '&tabId=ALL');
    return (j?.data || []).map(travelItem);
  },
  async 'travel.search'({ query }) {
    const q = String(query || '').trim().slice(0, 40); if (!q) throw fail('bad_request', '여행지를 입력해 주세요.');
    const j = await call('/affiliate/query/connect/products?serviceType=TRAVEL_PACKAGE&query=' + encodeURIComponent(q));
    return (j?.data || []).map(travelItem);
  },
  async 'travel.issue'({ url }) {
    if (!/^https:\/\/pkgtour\.naver\.com\//.test(String(url || ''))) throw fail('bad_request', '여행 상품 주소가 올바르지 않아요.');
    const j = await call('/affiliate/command/connect-urls', { method: 'POST', body: { url } });
    if (!j?.url) throw fail('issue_failed', '링크를 발급하지 못했어요. 브랜드커넥트에서 직접 확인해 주세요.');
    return { shortenUrl: j.url };
  }
};
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = handlers[msg && msg.type];
  const okSender = sender.url && sender.url.startsWith('https://wsxqaz1015.github.io/cuttory/');
  if (!h || !okSender) { reply({ ok: false, error: '지원하지 않는 요청이에요.' }); return false; }
  h(msg.payload || {}).then(data => reply({ ok: true, data })).catch(e => reply({ ok: false, code: e.code || 'error', error: e.message || '요청을 처리하지 못했어요.' }));
  return true;
});
