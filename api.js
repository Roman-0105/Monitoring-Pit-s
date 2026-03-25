/**
 * api.js — единственный модуль для общения с Apps Script.
 *
 * Читаем через JSONP (GET + callback).
 * Пишем через fetch POST (no-cors) + подтверждение через GET.
 *
 * Зависимости: window.APP_CONFIG.SCRIPT_URL, diagnostics.js
 */

const Api = (() => {
  // ── helpers ──────────────────────────────────────────────

  function scriptUrl() {
    return window.APP_CONFIG && window.APP_CONFIG.SCRIPT_URL;
  }

  /**
   * JSONP GET — возвращает Promise<data>.
   * Таймаут 10 сек.
   */
  function jsonpGet(params) {
    return new Promise((resolve, reject) => {
      const url = scriptUrl();
      if (!url) return reject(new Error('SCRIPT_URL не задан'));

      const cbName = '_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP timeout: ' + JSON.stringify(params)));
      }, 10000);

      function cleanup() {
        clearTimeout(timeout);
        delete window[cbName];
        const el = document.getElementById(cbName);
        if (el) el.remove();
      }

      window[cbName] = (data) => {
        cleanup();
        if (data && data.error) return reject(new Error(data.error));
        resolve(data);
      };

      const qs = Object.entries({ ...params, callback: cbName })
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
        .join('&');

      const script = document.createElement('script');
      script.id  = cbName;
      script.src = url + '?' + qs;
      script.onerror = () => { cleanup(); reject(new Error('JSONP script error')); };
      document.head.appendChild(script);
    });
  }

  /**
   * POST (no-cors) — данные уходят, но ответ недоступен.
   * Возвращает Promise<void> — resolve когда fetch завершён.
   */
  function post(body) {
    const url = scriptUrl();
    if (!url) return Promise.reject(new Error('SCRIPT_URL не задан'));
    return fetch(url, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  }

  /**
   * POST + подтверждение через GET.
   * confirmFn() — функция, возвращающая Promise<boolean>.
   * Делает до maxRetries попыток с интервалом retryMs.
   */
  async function postWithConfirm(body, confirmFn, { retryMs = 1500, maxRetries = 4 } = {}) {
    await post(body);
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(r => setTimeout(r, retryMs));
      try {
        const confirmed = await confirmFn();
        if (confirmed) return true;
      } catch (_) { /* продолжаем */ }
    }
    throw new Error('postWithConfirm: не подтверждено после ' + maxRetries + ' попыток');
  }

  // ── public API ───────────────────────────────────────────

  async function getPoints() {
    const data = await jsonpGet({ action: 'getPoints' });
    return data.points || [];
  }

  async function getWorkers() {
    const data = await jsonpGet({ action: 'getWorkers' });
    return data.workers || [];
  }

  async function getSchemes() {
    const data = await jsonpGet({ action: 'getSchemes' });
    return data.schemes || [];
  }

  /** Проверяем что точка с id существует на сервере */
  async function confirmPoint(id) {
    const data = await jsonpGet({ action: 'getPoint', id });
    return !!(data.point && data.point.id);
  }

  async function createPoint(point) {
    return postWithConfirm(
      { action: 'createPoint', point },
      () => confirmPoint(point.id)
    );
  }

  async function updatePoint(point) {
    return postWithConfirm(
      { action: 'updatePoint', point },
      () => confirmPoint(point.id)
    );
  }

  async function deletePoint(id) {
    return postWithConfirm(
      { action: 'deletePoint', id },
      async () => {
        const data = await jsonpGet({ action: 'getPoint', id });
        return !data.point; // подтверждено если точки нет
      }
    );
  }

  async function saveWorker(worker) {
    await post({ action: 'saveWorker', worker });
    return true;
  }

  async function deleteWorker(id) {
    await post({ action: 'deleteWorker', id });
    return true;
  }

  /** Загрузка фото: base64 строка (без data: префикса) */
  async function uploadPhoto(pointId, fileName, base64, mimeType) {
    await post({ action: 'uploadPhoto', pointId, fileName, base64, mimeType });
    // Подтверждение: перечитываем точку и проверяем photoUrls
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const pts = await getPoints();
        const p = pts.find(x => x.id === pointId);
        if (p && p.photoUrls && p.photoUrls.length > 0) return true;
      } catch (_) {}
    }
    throw new Error('uploadPhoto: фото не подтверждено');
  }

  /** Загрузка схемы: base64 строка */
  async function uploadScheme(params) {
    await post({ action: 'uploadScheme', ...params });
    return true;
  }

  /** Прокси-загрузка изображения с Drive (обход CORS) */
  async function getImage(fileId) {
    const data = await jsonpGet({ action: 'getImage', fileId });
    if (!data.ok) throw new Error(data.error || 'getImage failed');
    return { base64: data.base64, mimeType: data.mimeType };
  }

  async function ping() {
    const data = await jsonpGet({ action: 'ping' });
    return data.ok === true;
  }

  async function deletePhoto(pointId) {
    await post({ action: 'deletePhoto', pointId });
    return true;
  }

  return {
    getPoints, getWorkers, getSchemes,
    createPoint, updatePoint, deletePoint,
    saveWorker, deleteWorker,
    uploadPhoto, uploadScheme, deletePhoto,
    getImage, ping,
  };
})();
