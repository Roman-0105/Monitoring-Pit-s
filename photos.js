/**
 * photos.js — сжатие, загрузка и отображение фото.
 *
 * Единственный поток загрузки:
 *   1. compress(file) → base64
 *   2. Api.uploadPhotoConfirmed(pointId, ...) → driveUrl
 *      (внутри: POST uploadPhoto + polling getPoint)
 *   3. Вернуть driveUrl вызывающему коду
 *
 * При ошибке — бросаем Error, не возвращаем null.
 */

var Photos = (function() {

  // ── Сжатие ───────────────────────────────────────────────

  function compress(file, maxSize, quality) {
    maxSize = maxSize || 1200;  // уменьшено с 1600 — меньше payload
    quality = quality || 0.80;
    return new Promise(function(resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w >= h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else        { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        reject(new Error('Ошибка чтения изображения'));
      };
      img.src = url;
    });
  }

  // ── Загрузка с подтверждением ────────────────────────────

  /**
   * Сжимает файл и загружает с подтверждением через API.
   * Возвращает Promise<string> — driveUrl.
   * При любой ошибке бросает Error.
   */
  function upload(file, pointId) {
    if (!file)    return Promise.reject(new Error('Файл не выбран'));
    if (!pointId) return Promise.reject(new Error('pointId не задан'));

    Diagnostics.set('photoStatus', 'uploading');

    var TIMEOUT_MS = 70000;  // 30 сек polling + 40 сек запас
    var timeoutP   = new Promise(function(_, reject) {
      setTimeout(function() {
        reject(new Error('Таймаут загрузки фото (40 сек)'));
      }, TIMEOUT_MS);
    });

    var uploadP = compress(file).then(function(base64) {
      var fileName = 'photo_' + pointId + '_' + Date.now() + '.jpg';
      return Api.uploadPhotoConfirmed(pointId, fileName, base64, 'image/jpeg');
    }).then(function(driveUrl) {
      Diagnostics.set('photoStatus', 'uploaded');
      return driveUrl;
    });

    return Promise.race([uploadP, timeoutP]).catch(function(err) {
      Diagnostics.set('photoStatus', 'error');
      Diagnostics.setError('photo', err.message);
      throw err; // не глотаем ошибку
    });
  }

  // ── Отображение через прокси ─────────────────────────────

  function loadForDisplay(driveUrl) {
    if (!driveUrl) return Promise.resolve(null);
    var match = driveUrl.match(/id=([^&]+)/);
    if (!match) return Promise.resolve(driveUrl);
    return Api.getImage(match[1]).then(function(data) {
      if (!data || !data.base64) return null;
      return 'data:' + data.mimeType + ';base64,' + data.base64;
    }).catch(function() { return null; });
  }

  function setImageSrc(imgEl, driveUrl) {
    if (!imgEl || !driveUrl) return;
    loadForDisplay(driveUrl).then(function(src) {
      if (src && imgEl) imgEl.src = src;
    });
  }

  // ── UI: input + preview ───────────────────────────────────

  function initPhotoInput(inputId, previewId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    newInput.addEventListener('change', function() {
      var file    = newInput.files && newInput.files[0];
      var preview = document.getElementById(previewId);
      if (!preview) return;
      if (!file) { preview.innerHTML = ''; return; }
      var url = URL.createObjectURL(file);
      var img = document.createElement('img');
      img.style.cssText = 'max-width:100%;max-height:180px;border-radius:6px;display:block';
      img.onload = function() { URL.revokeObjectURL(url); };
      img.src = url;
      preview.innerHTML = '';
      preview.appendChild(img);
    });
  }

  function clearInput(inputId, previewId) {
    var input = document.getElementById(inputId);
    if (input) {
      var newInput = input.cloneNode(true);
      input.parentNode.replaceChild(newInput, input);
      initPhotoInput(inputId, previewId);
    }
    var preview = document.getElementById(previewId);
    if (preview) preview.innerHTML = '';
  }

  function getFile(inputId) {
    var input = document.getElementById(inputId);
    return (input && input.files && input.files[0]) ? input.files[0] : null;
  }

  return {
    compress:       compress,
    upload:         upload,
    loadForDisplay: loadForDisplay,
    setImageSrc:    setImageSrc,
    initPhotoInput: initPhotoInput,
    clearInput:     clearInput,
    getFile:        getFile,
  };
})();
