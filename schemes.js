/**
 * schemes.js — загрузка и отображение схем карьера.
 *
 * Схема привязана к weekKey (напр. "2026-W13").
 * Хранится в Drive, метаданные в листе Схемы.
 * Отображается как фон на вкладке Карта.
 */

var Schemes = (function() {

  var _list      = [];   // кэш списка схем
  var _imgCache  = {};   // кэш base64 изображений по weekKey

  // ── Текущая неделя ────────────────────────────────────────

  function currentWeekKey() {
    var now  = new Date();
    var jan1 = new Date(now.getFullYear(), 0, 1);
    var week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return now.getFullYear() + '-W' + (week < 10 ? '0' + week : week);
  }

  function formatWeekKey(weekKey) {
    // "2026-W13" → "Неделя 13, 2026"
    var parts = weekKey.split('-W');
    if (parts.length === 2) return 'Неделя ' + parts[1] + ', ' + parts[0];
    return weekKey;
  }

  // ── Загрузка списка с сервера ─────────────────────────────

  function load() {
    return Api.getSchemes().then(function(schemes) {
      _list = schemes || [];
      Storage.cacheSchemes(_list);
      Diagnostics.set('schemeStatus', _list.length ? 'loaded' : 'none');
      return _list;
    }).catch(function(err) {
      _list = Storage.getCachedSchemes() || [];
      Diagnostics.setError('scheme', err.message);
      Diagnostics.set('schemeStatus', _list.length ? 'loaded' : 'error');
      return _list;
    });
  }

  function getList() { return _list; }

  function getByWeek(weekKey) {
    return _list.find(function(s) { return s.weekKey === weekKey; }) || null;
  }

  function getCurrent() {
    return getByWeek(currentWeekKey());
  }

  // ── Загрузка схемы на сервер ──────────────────────────────

  function upload(file, weekKey, deviceId) {
    Diagnostics.set('schemeStatus', 'loading');
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var dataUrl = e.target.result;
        var base64  = dataUrl.split(',')[1];
        var mime    = dataUrl.split(';')[0].split(':')[1];
        resolve({ base64: base64, mime: mime });
      };
      reader.onerror = function() { reject(new Error('Ошибка чтения файла')); };
      reader.readAsDataURL(file);
    }).then(function(data) {
      return Api.uploadScheme({
        weekKey:    weekKey,
        fileName:   'scheme_' + weekKey + '_' + Date.now() + '.png',
        base64:     data.base64,
        mimeType:   data.mime || 'image/png',
        uploadedBy: deviceId || Storage.getDeviceId(),
      });
    }).then(function() {
      // Сбрасываем кэш изображения для этой недели
      delete _imgCache[weekKey];
      // Перечитываем список схем
      return new Promise(function(r) { setTimeout(r, 2000); });
    }).then(function() {
      return load();
    }).then(function() {
      Diagnostics.set('schemeStatus', 'loaded');
    }).catch(function(err) {
      Diagnostics.setError('scheme', err.message);
      Diagnostics.set('schemeStatus', 'error');
      throw err;
    });
  }

  // ── Получение изображения через прокси ───────────────────

  function getImage(weekKey) {
    if (_imgCache[weekKey]) {
      return Promise.resolve(_imgCache[weekKey]);
    }
    var scheme = getByWeek(weekKey);
    if (!scheme || !scheme.driveFileId) {
      return Promise.resolve(null);
    }
    return Api.getImage(scheme.driveFileId).then(function(data) {
      if (!data || !data.base64) return null;
      var dataUrl = 'data:' + data.mimeType + ';base64,' + data.base64;
      _imgCache[weekKey] = dataUrl;
      return dataUrl;
    }).catch(function() { return null; });
  }

  function getCurrentImage() {
    return getImage(currentWeekKey());
  }

  return {
    currentWeekKey:  currentWeekKey,
    formatWeekKey:   formatWeekKey,
    load:            load,
    getList:         getList,
    getByWeek:       getByWeek,
    getCurrent:      getCurrent,
    upload:          upload,
    getImage:        getImage,
    getCurrentImage: getCurrentImage,
  };
})();
