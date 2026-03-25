/**
 * api.js — единственный модуль для общения с Apps Script.
 *
 * Чтение: JSONP (GET).
 * Запись: fetch POST no-cors + подтверждение через JSONP.
 *
 * Ключевое правило JSONP:
 *   window[cbName] живёт до тех пор пока не получен ответ.
 *   Удаляем его ТОЛЬКО после вызова — не по таймауту, не по onerror.
 *   Таймаут/onerror только переводят промис в rejected, но callback
 *   остаётся в window чтобы поглотить запоздалый ответ без ошибки.
 */

var Api = (function() {

  function scriptUrl() {
    return window.APP_CONFIG && window.APP_CONFIG.SCRIPT_URL;
  }

  // ── JSONP GET ─────────────────────────────────────────────

  function jsonpGet(params, timeoutMs) {
    timeoutMs = timeoutMs || 20000;
    return new Promise(function(resolve, reject) {
      var url = scriptUrl();
      if (!url) return reject(new Error('SCRIPT_URL не задан'));

      var cbName  = '_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      var settled = false; // промис уже resolved/rejected?

      // Таймаут — реджектим промис, но НЕ удаляем window[cbName]
      var timer = setTimeout(function() {
        if (!settled) {
          settled = true;
          reject(new Error('JSONP timeout: ' + JSON.stringify(params)));
        }
        // window[cbName] остаётся — поглотит запоздалый ответ
      }, timeoutMs);

      // Callback — вызывается когда Apps Script вернул данные
      window[cbName] = function(data) {
        // Всегда убираем тег и таймер
        clearTimeout(timer);
        var el = document.getElementById(cbName);
        if (el) el.remove();
        // Удаляем себя из window
        delete window[cbName];

        if (settled) return; // таймаут уже был — тихо игнорируем
        settled = true;

        if (data && data.error) return reject(new Error(data.error));
        resolve(data);
      };

      // Строим URL
      var parts = [];
      var keys  = Object.keys(params).concat(['callback']);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = k === 'callback' ? cbName : params[k];
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      }

      var script  = document.createElement('script');
      script.id   = cbName;
      script.src  = url + '?' + parts.join('&');
      script.onerror = function() {
        // Убираем тег, но НЕ удаляем window[cbName] и НЕ делаем clearTimeout
        // Промис реджектим только если ещё не settled
        var el = document.getElementById(cbName);
        if (el) el.remove();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('JSONP script load error'));
        }
      };
      document.head.appendChild(script);
    });
  }

  // ── POST no-cors ─────────────────────────────────────────

  function post(body) {
    var url = scriptUrl();
    if (!url) return Promise.reject(new Error('SCRIPT_URL не задан'));
    return fetch(url, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  }

  // POST + подтверждение через getPoint polling
  function postWithConfirm(body, confirmFn, opts) {
    opts = opts || {};
    var retryMs    = opts.retryMs    || 2000;
    var maxRetries = opts.maxRetries || 5;
    return post(body).then(function() {
      return poll(confirmFn, retryMs, maxRetries);
    });
  }

  function poll(fn, intervalMs, maxAttempts) {
    return new Promise(function(resolve, reject) {
      var attempt = 0;
      function next() {
        attempt++;
        fn().then(function(ok) {
          if (ok) return resolve(true);
          if (attempt >= maxAttempts) return reject(new Error('Не подтверждено за ' + maxAttempts + ' попыток'));
          setTimeout(next, intervalMs);
        }).catch(function() {
          if (attempt >= maxAttempts) return reject(new Error('Polling error'));
          setTimeout(next, intervalMs);
        });
      }
      setTimeout(next, intervalMs); // первая попытка через intervalMs
    });
  }

  // ── Публичные методы чтения ───────────────────────────────

  function getPoints() {
    return jsonpGet({ action: 'getPoints' }).then(function(d) { return d.points || []; });
  }

  function getWorkers() {
    return jsonpGet({ action: 'getWorkers' }).then(function(d) { return d.workers || []; });
  }

  function getSchemes() {
    return jsonpGet({ action: 'getSchemes' }).then(function(d) { return d.schemes || []; });
  }

  function getPoint(id) {
    return jsonpGet({ action: 'getPoint', id: id }).then(function(d) { return d.point || null; });
  }

  function getImage(fileId) {
    return jsonpGet({ action: 'getImage', fileId: fileId }, 30000); // дольше для больших фото
  }

  function ping() {
    return jsonpGet({ action: 'ping' }).then(function(d) { return d.ok === true; });
  }

  // ── Публичные методы записи ───────────────────────────────

  function createPoint(point) {
    return postWithConfirm(
      { action: 'createPoint', point: point },
      function() { return getPoint(point.id).then(function(p) { return !!p; }); }
    );
  }

  function updatePoint(point) {
    return postWithConfirm(
      { action: 'updatePoint', point: point },
      function() { return getPoint(point.id).then(function(p) { return !!p; }); }
    );
  }

  function deletePoint(id) {
    return postWithConfirm(
      { action: 'deletePoint', id: id },
      function() { return getPoint(id).then(function(p) { return !p; }); }
    );
  }

  function saveWorker(worker) {
    return post({ action: 'saveWorker', worker: worker });
  }

  function deleteWorker(id) {
    return post({ action: 'deleteWorker', id: id });
  }

  function uploadPhoto(pointId, fileName, base64, mimeType) {
    return post({ action: 'uploadPhoto', pointId: pointId, fileName: fileName,
                  base64: base64, mimeType: mimeType });
  }

  function deletePhoto(pointId) {
    return post({ action: 'deletePhoto', pointId: pointId });
  }

  function uploadScheme(params) {
    return post({ action: 'uploadScheme',
                  weekKey: params.weekKey, fileName: params.fileName,
                  base64: params.base64, mimeType: params.mimeType,
                  uploadedBy: params.uploadedBy });
  }

  return {
    getPoints:    getPoints,
    getWorkers:   getWorkers,
    getSchemes:   getSchemes,
    getPoint:     getPoint,
    getImage:     getImage,
    ping:         ping,
    createPoint:  createPoint,
    updatePoint:  updatePoint,
    deletePoint:  deletePoint,
    saveWorker:   saveWorker,
    deleteWorker: deleteWorker,
    uploadPhoto:  uploadPhoto,
    deletePhoto:  deletePhoto,
    uploadScheme: uploadScheme,
  };
})();
