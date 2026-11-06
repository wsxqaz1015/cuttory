// 컷토리 페이지 <-> 도우미 연결. 컷토리 화면이 보낸 요청만 전달하고, 다른 사이트에서는 동작하지 않아요.
(() => {
  const VERSION = '1.0.0';
  const announce = () => window.postMessage({ source: 'cuttory-helper', type: 'ready', version: VERSION }, location.origin);
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.source !== 'cuttory' || typeof m.type !== 'string') return;
    if (m.type === 'ping') return announce();
    chrome.runtime.sendMessage({ type: m.type, payload: m.payload || {} }, res => {
      const err = chrome.runtime.lastError;
      window.postMessage({ source: 'cuttory-helper', id: m.id, ok: !err && res && res.ok, data: res && res.data, error: err ? '도우미와 연결하지 못했어요. 페이지를 새로고침해 주세요.' : res && res.error, code: res && res.code }, location.origin);
    });
  });
  announce();
  document.addEventListener('DOMContentLoaded', announce);
})();
