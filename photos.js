/**
 * photos.js — загрузка фото в Google Drive и отображение.
 *
 * Поток:
 *   1. Пользователь выбирает файл
 *   2. compress() → base64 JPEG ≤ 1600px
 *   3. Api.uploadPhoto() → POST на Apps Script → Drive → URL
 *   4. URL сохраняется в точке через Points.update()
 *   5. Отображение: через прокси Api.getImage() (обход CORS)
 */

const Photos = (() => {

  // ── Сжатие изображения ────────────────────────────────

  function compress(file, maxSize = 1600, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);

        let w = img.width;
        let h = img.height;

        if (w > maxSize || h > maxSize) {
          if (w >= h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else        { w = Math.round(w * maxSize / h); h = maxSize; }
        }

        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64  = dataUrl.split(',')[1];
        const sizeMB  = (base64.length * 0.75 / 1024 / 1024).toFixed(2);
        console.log('[Photos] сжато: ' + w + '×' + h + ', ' + sizeMB + ' MB');
        resolve(base64);
      };

      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Ошибка загрузки изображения')); };
      img.src = url;
    });
  }

  // ── Загрузка в Drive ──────────────────────────────────

  /**
   * Загружает фото и возвращает URL.
   * pointId нужен для имени файла и обновления записи в Sheets.
   */
  async function upload(file, pointId) {
    Diagnostics.set('photoStatus', 'uploading');

    try {
      const base64   = await compress(file);
      const fileName = 'photo_' + pointId + '_' + Date.now() + '.jpg';

      await Api.uploadPhoto(pointId, fileName, base64, 'image/jpeg');

      // Перечитываем точку чтобы получить актуальный photoUrls
      // (Apps Script сам дописал URL в строку)
      await new Promise(r => setTimeout(r, 2000));
      const points = await Api.getPoints();
      const p = points.find(x => x.id === pointId);
      const url = p && p.photoUrls && p.photoUrls[0] ? p.photoUrls[0] : null;

      Diagnostics.set('photoStatus', url ? 'uploaded' : 'error');
      return url;

    } catch (err) {
      Diagnostics.setError('photo', err.message);
      Diagnostics.set('photoStatus', 'error');
      throw err;
    }
  }

  // ── Отображение фото ──────────────────────────────────

  /**
   * Загружает изображение через прокси и возвращает data URL.
   * Используется для отображения фото с Drive (обход CORS).
   */
  async function loadForDisplay(driveUrl) {
    const match = driveUrl.match(/id=([^&]+)/);
    if (!match) return driveUrl; // не Drive ссылка — отдаём как есть

    try {
      const { base64, mimeType } = await Api.getImage(match[1]);
      return 'data:' + mimeType + ';base64,' + base64;
    } catch (err) {
      console.warn('[Photos] loadForDisplay error:', err.message);
      return null;
    }
  }

  // ── UI: превью выбранного файла ───────────────────────

  function initPhotoInput(inputId, previewId) {
    const input   = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) { preview.innerHTML = ''; return; }

      // Показываем превью сразу из локального файла
      const url = URL.createObjectURL(file);
      preview.innerHTML =
        '<div class="photo-preview">' +
        '<img src="' + url + '" alt="фото">' +
        '<button type="button" class="photo-remove" onclick="Photos.clearInput(\'' + inputId + '\',\'' + previewId + '\')">×</button>' +
        '</div>';
    });
  }

  function clearInput(inputId, previewId) {
    const input = document.getElementById(inputId);
    if (input) input.value = '';
    const preview = document.getElementById(previewId);
    if (preview) preview.innerHTML = '';
  }

  function getFile(inputId) {
    const input = document.getElementById(inputId);
    return input && input.files && input.files[0] ? input.files[0] : null;
  }

  return { compress, upload, loadForDisplay, initPhotoInput, clearInput, getFile };
})();

// ── Загрузка и кэш изображений для отображения ───────────

var _imageCache = {};

/**
 * Загружает изображение через прокси Apps Script (обход CORS Drive).
 * Результат кэшируется в памяти.
 * Возвращает Promise<dataUrl|null>.
 */
function loadDriveImage(driveUrl) {
  if (!driveUrl) return Promise.resolve(null);

  // Если уже в кэше — отдаём сразу
  // Кэш отключён — всегда грузим свежее для актуальности
  // if (_imageCache[driveUrl]) return Promise.resolve(_imageCache[driveUrl]);

  var match = driveUrl.match(/id=([^&]+)/);
  if (!match) return Promise.resolve(driveUrl); // не Drive — отдаём как есть

  return Api.getImage(match[1]).then(function(data) {
    var dataUrl = 'data:' + data.mimeType + ';base64,' + data.base64;
    _imageCache[driveUrl] = dataUrl;
    return dataUrl;
  }).catch(function() {
    return null;
  });
}

/**
 * Устанавливает src изображению через прокси.
 * imgEl — элемент <img>.
 */
function setImageSrc(imgEl, driveUrl) {
  if (!imgEl || !driveUrl) return;
  imgEl.src = ''; // placeholder
  loadDriveImage(driveUrl).then(function(src) {
    if (src) imgEl.src = src;
  });
}

// Экспортируем в Photos
Photos.loadDriveImage = loadDriveImage;
Photos.setImageSrc    = setImageSrc;
