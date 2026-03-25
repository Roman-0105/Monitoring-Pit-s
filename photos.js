/**
 * photos.js — загрузка, замена и отображение фото.
 *
 * Все функции внутри замыкания Photos.
 * Нет глобальных переменных. Нет дублирования.
 */

var Photos = (function() {

  // ── Сжатие ───────────────────────────────────────────────

  function compress(file, maxSize, quality) {
    maxSize  = maxSize  || 1600;
    quality  = quality  || 0.85;
    return new Promise(function(resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var w = img.width;
        var h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w >= h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else        { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        var canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        reject(new Error('Ошибка загрузки изображения'));
      };
      img.src = url;
    });
  }

  // ── Загрузка / атомарная замена ──────────────────────────

  /**
   * Загружает фото для точки. Если фото уже есть — сервер
   * автоматически удаляет старое и сохраняет только новый URL.
   * Возвращает Promise<string|null> — новый driveUrl.
   */
  function uploadAndReplace(file, pointId) {
    Diagnostics.set('photoStatus', 'uploading');
    return compress(file).then(function(base64) {
      var fileName = 'photo_' + pointId + '_' + Date.now() + '.jpg';
      // POST: сервер атомарно удаляет старое и загружает новое
      return Api.uploadPhoto(pointId, fileName, base64, 'image/jpeg');
    }).then(function() {
      // Ждём 2 сек чтобы Apps Script завершил запись
      return new Promise(function(r) { setTimeout(r, 2000); });
    }).then(function() {
      // Читаем актуальный URL из Sheets
      return Api.getPoints();
    }).then(function(points) {
      var p   = points.find(function(x) { return x.id === pointId; });
      var url = (p && p.photoUrls && p.photoUrls[0]) ? p.photoUrls[0] : null;
      Diagnostics.set('photoStatus', url ? 'uploaded' : 'error');
      return url;
    }).catch(function(err) {
      Diagnostics.setError('photo', err.message);
      Diagnostics.set('photoStatus', 'error');
      throw err;
    });
  }

  // ── Прокси-загрузка для отображения ─────────────────────

  /**
   * Загружает изображение через Apps Script (обход CORS Drive).
   * Возвращает Promise<dataUrl|null>.
   */
  function loadForDisplay(driveUrl) {
    if (!driveUrl) return Promise.resolve(null);
    var match = driveUrl.match(/id=([^&]+)/);
    if (!match) return Promise.resolve(driveUrl);
    return Api.getImage(match[1]).then(function(data) {
      return 'data:' + data.mimeType + ';base64,' + data.base64;
    }).catch(function() { return null; });
  }

  /**
   * Устанавливает src у img-элемента через прокси.
   */
  function setImageSrc(imgEl, driveUrl) {
    if (!imgEl || !driveUrl) return;
    loadForDisplay(driveUrl).then(function(src) {
      if (src && imgEl) imgEl.src = src;
    });
  }

  // ── UI: input + preview ───────────────────────────────────

  function initPhotoInput(inputId, previewId) {
    var input   = document.getElementById(inputId);
    var preview = document.getElementById(previewId);
    if (!input || !preview) return;
    // Сбрасываем старый обработчик
    var newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    newInput.addEventListener('change', function() {
      var file = newInput.files && newInput.files[0];
      if (!file) { preview.innerHTML = ''; return; }
      var url = URL.createObjectURL(file);
      var img = document.createElement('img');
      img.src   = url;
      img.style.cssText = 'max-width:100%;max-height:180px;border-radius:6px;display:block';
      img.onload = function() { URL.revokeObjectURL(url); };
      var wrap = document.createElement('div');
      wrap.className = 'photo-preview';
      wrap.appendChild(img);
      preview.innerHTML = '';
      preview.appendChild(wrap);
    });
  }

  function clearInput(inputId, previewId) {
    var input = document.getElementById(inputId);
    if (input) {
      // Сбрасываем value через замену элемента
      var newInput = input.cloneNode(true);
      input.parentNode.replaceChild(newInput, input);
      // Переинициализируем обработчик
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
    compress:         compress,
    uploadAndReplace: uploadAndReplace,
    loadForDisplay:   loadForDisplay,
    setImageSrc:      setImageSrc,
    initPhotoInput:   initPhotoInput,
    clearInput:       clearInput,
    getFile:          getFile,
  };
})();
