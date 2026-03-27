/**
 * app.js — инициализация, роутинг, UI.
 * Весь JS здесь. В index.html нет inline-скриптов.
 */

window.APP_CONFIG = {
  SCRIPT_URL:       'https://script.google.com/macros/s/AKfycbxYfkdHku11BabfoZ8qQsSqyPehKSfOs5nsA3jXDjuDHavL4IzogGO4o-2GN6-AVsba/exec',
  SYNC_INTERVAL_MS: 30000,
};

var AppState = {
  currentTab:     'points',
  editingPointId: null,
  syncing:        false,  // блокировка параллельных синхронизаций
};

// ── Инициализация ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  showLoader('Загрузка...');

  // Конфигурация
  var devEl = document.getElementById('device-id-display');
  if (devEl) devEl.textContent = Storage.getDeviceId();
  var suEl  = document.getElementById('script-url-status');
  if (suEl)  suEl.textContent  = (APP_CONFIG.SCRIPT_URL && APP_CONFIG.SCRIPT_URL.indexOf('ВСТАВЬ') < 0) ? '✅ задан' : '❌ не задан';

  initTabs();
  initAddForm();
  initEditModal();
  initDiagButtons();
  Photos.initPhotoInput('f-photo', 'f-photo-preview');
  initSettings();
  Diagnostics.render();
  // Статус-бар: сеть
  function updateNetStatus() {
    var el = document.getElementById('sb-net');
    if (el) el.textContent = navigator.onLine ? '🟢 онлайн' : '🔴 офлайн';
  }
  updateNetStatus();
  window.addEventListener('online',  updateNetStatus);
  window.addEventListener('offline', updateNetStatus);

  Promise.all([Workers.load(), Points.load(), Schemes.load()]).then(function() {
    renderWorkers();
    renderPointsList();
    Diagnostics.clearError();
    Diagnostics.set('queueSize', Storage.getQueue().length);
    hideLoader();
  }).catch(function(err) {
    Diagnostics.setError('sync', 'Начальная загрузка: ' + err.message);
    renderWorkers();
    renderPointsList();
    hideLoader();
  });

  setInterval(syncAll, APP_CONFIG.SYNC_INTERVAL_MS);
  window.addEventListener('online', function() { Points.flushQueue(); syncAll(); });
});

// ── Синхронизация ─────────────────────────────────────────
function syncAll() {
  if (!navigator.onLine) return;
  if (AppState.syncing) return; // не запускаем параллельно
  AppState.syncing = true;
  Points.flushQueue().then(function() {
    return Promise.all([Points.load(), Workers.load(), Schemes.load()]);
  }).then(function() {
    renderPointsList();
    renderWorkers();
    Diagnostics.clearError();
  }).catch(function(err) {
    Diagnostics.setError('sync', err.message);
  }).then(function() {
    AppState.syncing = false; // всегда сбрасываем
  });
}

// ── Вкладки ───────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('[data-tab]').forEach(function(btn) {
    btn.addEventListener('click', function() { switchTab(this.dataset.tab); });
  });
}

function switchTab(name) {
  AppState.currentTab = name;
  document.querySelectorAll('.tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.page').forEach(function(p) {
    p.classList.toggle('active', p.id === 'page-' + name);
  });
  if (name === 'add')     resetAddForm();
  if (name === 'diag')     Diagnostics.render();
  if (name === 'map')    { _mapSchemeImg = null; renderMap(); initMapLegend(); updateMapLegendPoints(); }
  if (name === 'settings') renderSettingsSchemes();
  if (name === 'workers') renderWorkerManageList();
}

// ── Лоадер ───────────────────────────────────────────────
function showLoader(msg) {
  var el = document.getElementById('loader');
  if (el) { el.textContent = msg || '⏳'; el.style.display = 'flex'; }
}
function hideLoader() {
  var el = document.getElementById('loader');
  if (el) el.style.display = 'none';
}

// ── Список точек ─────────────────────────────────────────
function renderPointsList() {
  var container = document.getElementById('points-list');
  if (!container) return;
  var points = Points.getList();
  if (!points.length) {
    container.innerHTML = '<p class="empty-msg">Точек пока нет</p>';
    return;
  }
  var html = '';
  for (var i = 0; i < points.length; i++) {
    var p = points[i];
    var pending     = p.syncStatus !== 'synced';
    var statusClass = (p.status || '').toLowerCase().replace(/\s/g, '-');
    var hasPhoto    = p.photoUrls && p.photoUrls[0];
    html += '<div class="point-card' + (pending ? ' point-pending' : '') + '">';
    html += '<div class="point-card__header">';
    html += '<span class="point-card__num">#' + (p.pointNumber || '—') + '</span>';
    html += '<span class="point-card__status status-' + statusClass + '">' + (p.status || '') + '</span>';
    if (pending) html += '<span class="sync-badge">⏳</span>';
    html += '</div>';
    if (hasPhoto) {
      html += '<div class="point-card__photo-wrap">';
      html += '<img class="card-photo-thumb" data-url="' + p.photoUrls[0] + '" src="" alt="фото">';
      html += '</div>';
    }
    html += '<div class="point-card__body">';
    html += '<div>👤 ' + (p.worker || '—') + '</div>';
    html += '<div>📅 ' + formatDate(p.createdAt) + '</div>';
    if (p.intensity) {
      html += '<div>💧 ' + p.intensity;
      if (p.flowRate != null) html += ' · ' + p.flowRate + ' л/с';
      html += '</div>';
    }
    if (p.domain)  html += '<div>📍 ' + p.domain + '</div>';
    if (p.xLocal != null || p.yLocal != null) {
      var xStr = p.xLocal != null ? Number(p.xLocal).toFixed(4) : '—';
      var yStr = p.yLocal != null ? Number(p.yLocal).toFixed(4) : '—';
      html += '<div style="font-size:11px;color:var(--gray-600)">X: ' + xStr + '  Y: ' + yStr + '</div>';
    }
    if (p.comment) html += '<div class="point-card__comment">' + p.comment + '</div>';

    html += '</div>';
    html += '<div class="point-card__actions">';
    html += '<button class="btn btn-sm btn-outline btn-edit" data-pid="' + p.id + '">✏️ Изменить</button>';
    html += '<button class="btn btn-sm btn-danger btn-del"  data-pid="' + p.id + '">🗑 Удалить</button>';
    html += '</div></div>';
  }
  container.innerHTML = html;

  container.querySelectorAll('.btn-edit').forEach(function(btn) {
    btn.addEventListener('click', function() { openEditModal(this.dataset.pid); });
  });
  container.querySelectorAll('.btn-del').forEach(function(btn) {
    btn.addEventListener('click', function() { confirmDelete(this.dataset.pid); });
  });
  // Загружаем фото через прокси
  container.querySelectorAll('.card-photo-thumb').forEach(function(img) {
    Photos.setImageSrc(img, img.dataset.url);
  });
  updateMapLegendPoints();
}

// ── Сотрудники ────────────────────────────────────────────
function renderWorkers() {
  var grid = document.getElementById('worker-grid');
  if (grid) {
    var workers = Workers.getList();
    var html = '';
    for (var i = 0; i < workers.length; i++) {
      var w = workers[i];
      html += '<div class="worker-btn" data-wname="' + escAttr(w.name) + '">';
      html += '<span class="worker-btn__avatar">' + initials(w.name) + '</span>';
      html += '<span>' + w.name + '</span></div>';
    }
    grid.innerHTML = html || '<p class="empty-msg" style="padding:8px 0">Нет сотрудников</p>';
  }
  updateWorkerSelects();
}

function updateWorkerSelects() {
  var workers = Workers.getList();
  ['f-worker', 'e-worker'].forEach(function(id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">— выберите —</option>';
    workers.forEach(function(w) {
      var opt = document.createElement('option');
      opt.value = w.name;
      opt.textContent = w.name;
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  });
}

function renderWorkerManageList() {
  var container = document.getElementById('workers-manage-list');
  if (!container) return;
  var workers = Workers.getList();
  if (!workers.length) {
    container.innerHTML = '<p class="empty-msg" style="padding:8px 0">Список пуст</p>';
    return;
  }
  var html = '';
  for (var i = 0; i < workers.length; i++) {
    var w = workers[i];
    html += '<div class="worker-manage-row" data-wid="' + w.id + '">';
    html += '<input type="text" value="' + escAttr(w.name) + '">';
    html += '<button class="btn-icon btn-icon-del" type="button">×</button>';
    html += '</div>';
  }
  container.innerHTML = html;
  container.querySelectorAll('.worker-manage-row').forEach(function(row) {
    var wid = row.dataset.wid;
    row.querySelector('input').addEventListener('change', function() {
      renameWorker(wid, this.value);
    });
    row.querySelector('.btn-icon-del').addEventListener('click', function() {
      removeWorker(wid);
    });
  });

  // Кнопка добавить
  var addBtn = document.getElementById('btn-add-worker');
  if (addBtn && !addBtn._bound) {
    addBtn._bound = true;
    addBtn.addEventListener('click', addWorker);
    document.getElementById('new-worker-name').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); addWorker(); }
    });
  }
}

function addWorker() {
  var inp  = document.getElementById('new-worker-name');
  var name = inp ? inp.value.trim() : '';
  if (!name) { alert('Введите имя'); return; }
  Workers.add(name).then(function() {
    if (inp) inp.value = '';
    renderWorkers();
    renderWorkerManageList();
  });
}

function removeWorker(id) {
  if (!confirm('Удалить сотрудника?')) return;
  Workers.remove(id).then(function() {
    renderWorkers();
    renderWorkerManageList();
  });
}

function renameWorker(id, newName) {
  if (!newName.trim()) return;
  var list = Workers.getList();
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      list[i].name      = newName.trim();
      list[i].updatedAt = new Date().toISOString();
      Storage.cacheWorkers(list);
      Api.saveWorker(list[i]).catch(function(e) { console.warn(e); });
      renderWorkers();
      break;
    }
  }
}

// ── Форма добавления ──────────────────────────────────────
function initAddForm() {
  var form = document.getElementById('add-form');
  if (form) form.addEventListener('submit', function(e) { e.preventDefault(); saveNewPoint(); });

  var gps = document.getElementById('btn-gps');
  if (gps) gps.addEventListener('click', function() { getGPSForForm('f'); });

  // Пересчёт X/Y при ручном вводе lat/lon
  var fLat = document.getElementById('f-lat');
  var fLon = document.getElementById('f-lon');
  if (fLat) fLat.addEventListener('change', function() { recalcLocalCoords('f'); });
  if (fLon) fLon.addEventListener('change', function() { recalcLocalCoords('f'); });
}

function resetAddForm() {
  var form = document.getElementById('add-form');
  if (form) form.reset();
  Photos.clearInput('f-photo', 'f-photo-preview');
}

function saveNewPoint() {
  var data      = readFormFields('f');
  if (!data.pointNumber) { alert('Укажите номер точки'); return; }
  var photoFile = Photos.getFile('f-photo');
  AppState.syncing = true;
  showLoader('Сохранение...');

  // Шаг 1: создаём точку (postWithConfirm)
  Points.create(data).then(function(savedPoint) {
    if (!photoFile || !savedPoint || !savedPoint.id) return null;
    // Шаг 2: загружаем фото (compress → uploadPhotoConfirmed → polling)
    showLoader('Загрузка фото...');
    return Photos.upload(photoFile, savedPoint.id).then(function(driveUrl) {
      // Шаг 3: фиксируем URL в точке (уже записан сервером, обновляем кэш)
      var pt = Points.getById(savedPoint.id);
      if (pt) { pt.photoUrls = [driveUrl]; Storage.cachePoints(Points.getList()); }
    }).catch(function(photoErr) {
      // Фото не загрузилось — точка уже создана, показываем предупреждение
      Diagnostics.setError('photo', photoErr.message);
      alert('Точка сохранена, но фото не загрузилось: ' + photoErr.message);
    });
  }).then(function() {
    resetAddForm();
    return Points.load();
  }).then(function() {
    renderPointsList();
    if (_mapSchemeImg) redrawMap();
    switchTab('points');
    Diagnostics.set('pointsLoaded', Points.getList().length);
    AppState.syncing = false;
    hideLoader();
  }).catch(function(err) {
    Diagnostics.setError('sync', err.message);
    alert('Ошибка: ' + err.message);
    AppState.syncing = false;
    hideLoader();
  });
}

// ── Модал редактирования ──────────────────────────────────
function initEditModal() {
  var closeBtn = document.getElementById('edit-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeEditModal);
  var overlay  = document.getElementById('edit-modal');
  if (overlay) overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeEditModal();
  });
  var form = document.getElementById('edit-form');
  if (form) form.addEventListener('submit', function(e) { e.preventDefault(); saveEditedPoint(); });
  var delBtn = document.getElementById('e-delete-photo-btn');
  if (delBtn) delBtn.addEventListener('click', deletePointPhoto);

  // GPS кнопка в edit-форме
  var gpsEditBtn = document.getElementById('e-btn-gps');
  if (gpsEditBtn) gpsEditBtn.addEventListener('click', function() { getGPSForForm('e'); });

  // При изменении lat/lon вручную — пересчитываем X/Y
  var eLat = document.getElementById('e-lat');
  var eLon = document.getElementById('e-lon');
  if (eLat) eLat.addEventListener('change', function() { recalcLocalCoords('e'); });
  if (eLon) eLon.addEventListener('change', function() { recalcLocalCoords('e'); });

  // Кнопка добавления точки на карте
  var addMapBtn = document.getElementById('btn-map-add-point');
  if (addMapBtn) addMapBtn.addEventListener('click', toggleMapAddMode);
  Photos.initPhotoInput('e-photo', 'e-new-photo-preview');
}

function openEditModal(id) {
  var p = Points.getById(id);
  if (!p) return;
  AppState.editingPointId = id;
  document.getElementById('edit-modal-title').textContent = 'Редактирование #' + p.pointNumber;
  setField('e-num',       p.pointNumber);
  setField('e-lat',       p.lat      != null ? p.lat      : '');
  setField('e-lon',       p.lon      != null ? p.lon      : '');
  // X↔Y переставлены для отображения
  if (p.xLocal != null || p.yLocal != null) {
    setField('e-xlocal', p.xLocal != null ? Number(p.xLocal).toFixed(4) : '');
    setField('e-ylocal', p.yLocal != null ? Number(p.yLocal).toFixed(4) : '');
  } else {
    setField('e-xlocal', '');
    setField('e-ylocal', '');
  }
  setField('e-intensity', p.intensity   || '');
  setField('e-flowrate',  p.flowRate != null ? p.flowRate : '');
  setField('e-color',     p.waterColor  || '');
  setField('e-wall',      p.wall        || '');
  setField('e-domain',    p.domain      || '');
  setField('e-status',    p.status      || 'Новая');
  setField('e-comment',   p.comment     || '');
  setField('e-xlocal', p.xLocal != null ? Number(p.xLocal).toFixed(4) : '');
  setField('e-ylocal', p.yLocal != null ? Number(p.yLocal).toFixed(4) : '');
  updateWorkerSelects();
  setField('e-worker', p.worker || '');
  // Очищаем coord-info при редактировании
  var coordInfo = document.getElementById('e-map-coord-info');
  if (coordInfo) coordInfo.textContent = '';

  // Текущее фото
  var preview = document.getElementById('e-photo-preview');
  if (preview) {
    preview.innerHTML = '';
    if (p.photoUrls && p.photoUrls[0]) {
      var img = document.createElement('img');
      img.alt = 'текущее фото';
      img.style.cssText = 'max-width:100%;max-height:160px;border-radius:6px;display:block;margin-bottom:4px';
      var lbl = document.createElement('p');
      lbl.className   = 'form-hint';
      lbl.textContent = 'Загрузка фото...';
      preview.appendChild(img);
      preview.appendChild(lbl);
      Photos.setImageSrc(img, p.photoUrls[0]);
      img.onload  = function() { lbl.textContent = 'Текущее фото'; };
      img.onerror = function() { lbl.textContent = 'Фото недоступно'; };
    }
  }

  // Кнопка удаления фото
  var delBtn = document.getElementById('e-delete-photo-btn');
  if (delBtn) delBtn.style.display = (p.photoUrls && p.photoUrls[0]) ? 'inline-flex' : 'none';

  // Сбрасываем preview нового фото
  Photos.clearInput('e-photo', 'e-new-photo-preview');

  document.getElementById('edit-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  document.body.style.overflow = '';
  AppState.editingPointId = null;
  var form = document.getElementById('edit-form');
  if (form) form._mapCoords = null;
  var title = document.getElementById('edit-modal-title');
  if (title) title.textContent = 'Редактирование';
  var submitBtn = form && form.querySelector('[type=submit]');
  if (submitBtn) submitBtn.textContent = 'Сохранить изменения';
  // Убираем строку с местными координатами
  var coordInfo = document.getElementById('e-map-coord-info');
  if (coordInfo) coordInfo.textContent = '';
}

function saveEditedPoint() {
  var form      = document.getElementById('edit-form');
  var mapCoords = form ? form._mapCoords : null;
  var isMapAdd  = !AppState.editingPointId && !!mapCoords;
  var id        = AppState.editingPointId;
  var data      = readFormFields('e');
  var photoFile = Photos.getFile('e-photo');
  if (!data.pointNumber) { alert('Укажите номер точки'); return; }

  // Подставляем координаты из клика по карте ПРИНУДИТЕЛЬНО
  // (readFormFields применяет перестановку для GPS, а для карты нужны сырые значения)
  if (mapCoords) {
    data.xLocal = mapCoords.xLocal;
    data.yLocal = mapCoords.yLocal;
  }
  // Если есть GPS но нет xLocal — вычисляем
  if ((data.xLocal == null || data.yLocal == null) && data.lat && data.lon &&
      typeof MapModule !== 'undefined') {
    var sk = MapModule.wgs84ToXY(data.lat, data.lon);
    data.xLocal = sk.x; data.yLocal = sk.y;
  }

  showLoader('Сохранение...');
  closeEditModal();
  AppState.syncing = true;
  var chain;

  if (isMapAdd) {
    // Новая точка с карты: create → upload → redraw
    chain = Points.create(data).then(function(savedPoint) {
      if (!photoFile || !savedPoint || !savedPoint.id) return null;
      showLoader('Загрузка фото...');
      return Photos.upload(photoFile, savedPoint.id).catch(function(photoErr) {
        Diagnostics.setError('photo', photoErr.message);
        alert('Точка сохранена, но фото не загрузилось: ' + photoErr.message);
      });
    }).then(function() {
      if (_mapSchemeImg) redrawMap();
    });

  } else if (photoFile) {
    // Редактирование с заменой фото: upload → update с новым URL
    showLoader('Загрузка фото...');
    chain = Photos.upload(photoFile, id).then(function(driveUrl) {
      data.photoUrls = [driveUrl];
      return Points.update(id, data);
    }).catch(function(photoErr) {
      Diagnostics.setError('photo', photoErr.message);
      alert('Фото не загрузилось: ' + photoErr.message);
      // Сохраняем остальные поля без изменения фото
      return Points.update(id, data);
    });

  } else {
    // Редактирование без фото — сервер сохранит текущий photoUrls
    chain = Points.update(id, data);
  }

  chain.then(function() {
    return Points.load();
  }).then(function() {
    renderPointsList();
    if (_mapSchemeImg) redrawMap();
    Diagnostics.set('pointsLoaded', Points.getList().length);
    AppState.syncing = false;
    hideLoader();
  }).catch(function(err) {
    Diagnostics.setError('sync', err.message);
    alert('Ошибка: ' + err.message);
    AppState.syncing = false;
    hideLoader();
  });
}

function deletePointPhoto() {
  if (!AppState.editingPointId) return;
  if (!confirm('Удалить фото этой точки?')) return;
  var id = AppState.editingPointId;
  AppState.syncing = true;
  showLoader('Удаление фото...');

  // Сразу обновляем UI и кэш
  var pt = Points.getById(id);
  if (pt && pt.photoUrls && pt.photoUrls[0] && typeof Photos !== 'undefined') {
    Photos.clearCache(pt.photoUrls[0]);
  }
  if (pt) { pt.photoUrls = []; Storage.cachePoints(Points.getList()); }
  var preview = document.getElementById('e-photo-preview');
  if (preview) preview.innerHTML = '';
  var delBtn = document.getElementById('e-delete-photo-btn');
  if (delBtn) delBtn.style.display = 'none';
  renderPointsList();
  hideLoader();
  AppState.syncing = false;

  // В фоне: удаляем с сервера и синхронизируем
  Api.deletePhoto(id).then(function() {
    return Points.update(id, { photoUrls: [] });
  }).catch(function(err) {
    Diagnostics.setError('photo', 'Удаление фото: ' + err.message);
  });
}

// ── Удаление точки ────────────────────────────────────────
function confirmDelete(id) {
  var p = Points.getById(id);
  if (!p) return;
  if (!confirm('Удалить точку #' + p.pointNumber + '?')) return;
  showLoader('Удаление...');
  Points.remove(id).then(function() {
    return Points.load();
  }).then(function() {
    renderPointsList();
    Diagnostics.set('pointsLoaded', Points.getList().length);
    hideLoader();
  }).catch(function(err) {
    Diagnostics.setError('sync', err.message);
    alert('Ошибка: ' + err.message);
    hideLoader();
  });
}

// ── Диагностика ───────────────────────────────────────────
function initDiagButtons() {
  var s = document.getElementById('btn-sync-now');
  if (s) s.addEventListener('click', syncAll);
  var f = document.getElementById('btn-flush-queue');
  if (f) f.addEventListener('click', function() { Points.flushQueue(); });
  var c = document.getElementById('btn-clear-cache');
  if (c) c.addEventListener('click', function() {
    if (confirm('Очистить локальный кэш?')) { Storage.clearAll(); location.reload(); }
  });
}

// ── GPS ──────────────────────────────────────────────────
// getGPS заменён на getGPSForForm(prefix)

// ── Карта ────────────────────────────────────────────────
// ── Состояние карты ──────────────────────────────────────
var _mapSchemeImg  = null;
var _mapScale      = 1.0;   // текущий масштаб
var _mapOffX       = 0;     // смещение X (pan)
var _mapOffY       = 0;     // смещение Y (pan)
var _mapAddMode    = false;  // режим добавления точки
var _mapDragging   = false;
var _mapDragStartX = 0;
var _mapDragStartY = 0;

function renderMap() {
  var canvas   = document.getElementById('map-canvas');
  var noScheme = document.getElementById('map-no-scheme');
  var weekLabel = document.getElementById('map-week-label');
  if (!canvas) return;

  var weekKey = Schemes.currentWeekKey();
  if (weekLabel) weekLabel.textContent = Schemes.formatWeekKey(weekKey);

  var scheme = Schemes.getCurrent();
  if (!scheme) {
    canvas.style.display = 'none';
    if (noScheme) noScheme.style.display = 'block';
    return;
  }
  if (noScheme) noScheme.style.display = 'none';
  canvas.style.display = 'block';

  if (_mapSchemeImg) {
    redrawMap();
    return;
  }

  Schemes.getCurrentImage().then(function(dataUrl) {
    if (!dataUrl) {
      canvas.style.display = 'none';
      if (noScheme) noScheme.style.display = 'block';
      return;
    }
    var img = new Image();
    img.onload = function() {
      _mapSchemeImg = img;
      // Начальный масштаб: вписываем схему в контейнер
      var wrap = document.getElementById('map-scheme-wrap');
      if (wrap) {
        var fitScale = Math.min(wrap.clientWidth / img.width, wrap.clientHeight / img.height);
        _mapScale = fitScale > 0 ? fitScale : 1;
      } else {
        _mapScale = 1;
      }
      _mapOffX = 0;
      _mapOffY = 0;
      setupMapCanvas(canvas);
      redrawMap();
      initMapInteraction(canvas);
      initMapZoomButtons();
    };
    img.src = dataUrl;
  });
}

function setupMapCanvas(canvas) {
  // Canvas отображается через transform, размер = контейнер
  var wrap = document.getElementById('map-scheme-wrap');
  if (!wrap) return;
  canvas.width  = wrap.clientWidth  || 400;
  canvas.height = wrap.clientHeight || 600;
}

function redrawMap() {
  var canvas = document.getElementById('map-canvas');
  if (!canvas || !_mapSchemeImg) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(_mapOffX, _mapOffY);
  ctx.scale(_mapScale, _mapScale);
  ctx.drawImage(_mapSchemeImg, 0, 0);
  // Домены — под точками
  if (typeof Domens !== 'undefined') {
    Domens.draw(ctx, _mapSchemeImg.width, _mapSchemeImg.height);
  }
  if (typeof MapModule !== 'undefined') {
    MapModule.drawPoints(ctx, Points.getList(), _mapSchemeImg.width, _mapSchemeImg.height);
  }
  ctx.restore();
  // Обновляем масштаб в статус-баре
  var sbScale = document.getElementById('sb-scale');
  if (sbScale) sbScale.textContent = 'x' + _mapScale.toFixed(2);
}

function initMapInteraction(canvas) {
  if (canvas._mapBound) return;
  canvas._mapBound = true;

  // ── Колесо мыши — зум ───────────────────────────────────
  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    var rect   = canvas.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;
    var mouseY = e.clientY - rect.top;
    var delta  = e.deltaY > 0 ? 0.85 : 1.18;
    var newScale = Math.max(0.2, Math.min(10, _mapScale * delta));
    // Зум относительно точки курсора
    _mapOffX = mouseX - (mouseX - _mapOffX) * (newScale / _mapScale);
    _mapOffY = mouseY - (mouseY - _mapOffY) * (newScale / _mapScale);
    _mapScale = newScale;
    redrawMap();
  }, { passive: false });

  // ── Touch — pinch zoom + pan ─────────────────────────────
  var lastTouchDist = 0;
  var lastTouchX = 0;
  var lastTouchY = 0;

  canvas.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.sqrt(dx*dx + dy*dy);
    } else if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      _mapDragging = true;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
      var dx   = e.touches[0].clientX - e.touches[1].clientX;
      var dy   = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx*dx + dy*dy);
      if (lastTouchDist > 0) {
        var ratio    = dist / lastTouchDist;
        var midX     = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var midY     = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        var rect     = canvas.getBoundingClientRect();
        var mx       = midX - rect.left;
        var my       = midY - rect.top;
        var newScale = Math.max(0.2, Math.min(10, _mapScale * ratio));
        _mapOffX = mx - (mx - _mapOffX) * (newScale / _mapScale);
        _mapOffY = my - (my - _mapOffY) * (newScale / _mapScale);
        _mapScale = newScale;
        redrawMap();
      }
      lastTouchDist = dist;
    } else if (e.touches.length === 1 && _mapDragging && !_mapAddMode) {
      var dx = e.touches[0].clientX - lastTouchX;
      var dy = e.touches[0].clientY - lastTouchY;
      _mapOffX += dx;
      _mapOffY += dy;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      redrawMap();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', function(e) {
    if (e.touches.length < 2) lastTouchDist = 0;
    if (e.touches.length === 0) _mapDragging = false;
  }, { passive: true });

  // ── Mouse drag — pan ─────────────────────────────────────
  canvas.addEventListener('mousedown', function(e) {
    if (_mapAddMode) return;
    _mapDragging   = true;
    _mapDragStartX = e.clientX - _mapOffX;
    _mapDragStartY = e.clientY - _mapOffY;
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('mousemove', function(e) {
    var rect = canvas.getBoundingClientRect();
    var cx   = e.clientX - rect.left;
    var cy   = e.clientY - rect.top;

    if (_mapDragging && !_mapAddMode) {
      _mapOffX = e.clientX - _mapDragStartX;
      _mapOffY = e.clientY - _mapDragStartY;
      redrawMap();
      hideMapTooltip();
      return;
    }

    // Обновляем статус-бар с координатами курсора
    if (_mapSchemeImg && typeof MapModule !== 'undefined') {
      var imgX2 = (cx - _mapOffX) / _mapScale;
      var imgY2 = (cy - _mapOffY) / _mapScale;
      if (imgX2 >= 0 && imgX2 <= _mapSchemeImg.width &&
          imgY2 >= 0 && imgY2 <= _mapSchemeImg.height) {
        var loc = MapModule.pixelToXY(imgX2, imgY2, _mapSchemeImg.width, _mapSchemeImg.height);
        var wgs = MapModule.xyToWgs84(loc.x, loc.y);
        var sbEl = document.getElementById('sb-coords');
        if (sbEl) {
          sbEl.textContent =
            'X: ' + loc.x.toFixed(4) + '  Y: ' + loc.y.toFixed(4) +
            '  |  ' + wgs.lat.toFixed(5) + '°N  ' + wgs.lon.toFixed(5) + '°E';
        }
      }
    }

    // Tooltip при наведении на точку
    if (!_mapAddMode && _mapSchemeImg && typeof MapModule !== 'undefined') {
      var imgX = (cx - _mapOffX) / _mapScale;
      var imgY = (cy - _mapOffY) / _mapScale;
      var p = MapModule.findPointAt(imgX, imgY, Points.getList(),
                _mapSchemeImg.width, _mapSchemeImg.height, 1, 0, 0);
      if (p) {
        showMapTooltip(p, e.clientX, e.clientY);
      } else {
        hideMapTooltip();
      }
    }
  });
  canvas.addEventListener('mouseup', function() {
    _mapDragging = false;
    canvas.style.cursor = _mapAddMode ? 'crosshair' : 'grab';
  });
  canvas.addEventListener('mouseleave', function() {
    _mapDragging = false;
    hideMapTooltip();
  });

  // Tooltip при наведении
  canvas.addEventListener('mousemove', function(e) {
    if (_mapDragging || _mapAddMode || !_mapSchemeImg) {
      hideMapTooltip();
      return;
    }
    var rect = canvas.getBoundingClientRect();
    var cx   = e.clientX - rect.left;
    var cy   = e.clientY - rect.top;
    var imgX = (cx - _mapOffX) / _mapScale;
    var imgY = (cy - _mapOffY) / _mapScale;
    if (typeof MapModule !== 'undefined') {
      var p = MapModule.findPointAt(imgX, imgY, Points.getList(),
                _mapSchemeImg.width, _mapSchemeImg.height, 1, 0, 0);
      if (p) {
        showMapTooltip(p, e.clientX, e.clientY);
      } else {
        hideMapTooltip();
      }
    }
  });

  canvas.style.cursor = 'grab';

  // ── Клик — добавить точку или открыть карточку ───────────
  canvas.addEventListener('click', function(e) {
    if (_mapDragging) return;
    hideMapTooltip();
    var rect   = canvas.getBoundingClientRect();
    var cx     = e.clientX - rect.left;
    var cy     = e.clientY - rect.top;
    // Обратное преобразование: экран → координаты схемы
    var imgX   = (cx - _mapOffX) / _mapScale;
    var imgY   = (cy - _mapOffY) / _mapScale;

    if (_mapAddMode && typeof MapModule !== 'undefined') {
      // Вычисляем локальные координаты из пикселей
      var local = MapModule.pixelToXY(imgX, imgY, _mapSchemeImg.width, _mapSchemeImg.height);
      openAddPointModal(local.x, local.y);
      return;
    }

    if (typeof MapModule !== 'undefined') {
      var p = MapModule.findPointAt(imgX, imgY, Points.getList(),
                _mapSchemeImg.width, _mapSchemeImg.height, 1, 0, 0);
      if (p) showMapPointCard(p);
    }
  });
}



function initMapLegend() {
  // Кнопка легенды
  var btn = document.getElementById('btn-legend-toggle');
  if (btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener('click', function() {
      var panel = document.getElementById('map-legend-panel');
      if (!panel) return;
      var collapsed = panel.classList.toggle('collapsed');
      btn.textContent = collapsed ? '+' : '−';
    });
  }
  // Кнопка доменов
  var dBtn = document.getElementById('btn-domens-toggle');
  if (dBtn && !dBtn._bound) {
    dBtn._bound = true;
    dBtn.addEventListener('click', function() {
      if (typeof Domens === 'undefined') return;
      var visible = Domens.toggle();
      dBtn.style.background  = visible ? 'var(--blue)' : '';
      dBtn.style.color       = visible ? '#fff'        : '';
      dBtn.style.borderColor = visible ? 'var(--blue)' : '';
      if (_mapSchemeImg) redrawMap();
    });
    // По умолчанию домены включены — подсвечиваем кнопку
    dBtn.style.background  = 'var(--blue)';
    dBtn.style.color       = '#fff';
    dBtn.style.borderColor = 'var(--blue)';
  }
}

function updateMapLegendPoints() {
  var container = document.getElementById('map-legend-points');
  if (!container) return;
  var points = Points.getList();
  var byStatus = {};
  points.forEach(function(p) {
    var s = p.status || 'Неизвестно';
    byStatus[s] = (byStatus[s] || 0) + 1;
  });
  var html = 'Всего точек: <b>' + points.length + '</b><br><br>';
  Object.keys(byStatus).forEach(function(s) {
    html += s + ': ' + byStatus[s] + '<br>';
  });
  // Добавляем счётчики по доменам
  if (typeof Domens !== 'undefined') {
    html += '<br><b>По доменам:</b><br>';
    var byDomen = {};
    points.forEach(function(p) {
      var d = p.domain || '—';
      byDomen[d] = (byDomen[d] || 0) + 1;
    });
    Object.keys(byDomen).sort().forEach(function(d) {
      html += d + ': ' + byDomen[d] + '<br>';
    });
  }
  container.innerHTML = html;
}

function initMapZoomButtons() {
  var wrap = document.getElementById('map-scheme-wrap');
  if (!wrap || wrap.querySelector('.map-zoom-controls')) return;

  var controls = document.createElement('div');
  controls.className = 'map-zoom-controls';
  controls.innerHTML =
    '<button class="map-zoom-btn" id="map-zoom-in" title="Приблизить">+</button>' +
    '<button class="map-zoom-btn" id="map-zoom-out" title="Отдалить">−</button>' +
    '<button class="map-zoom-btn" id="map-zoom-fit" title="По размеру" style="font-size:13px">⊡</button>';
  wrap.appendChild(controls);

  document.getElementById('map-zoom-in').addEventListener('click', function() {
    zoomMap(1.3);
  });
  document.getElementById('map-zoom-out').addEventListener('click', function() {
    zoomMap(0.77);
  });
  document.getElementById('map-zoom-fit').addEventListener('click', function() {
    fitMap();
  });
}

function zoomMap(factor) {
  var canvas = document.getElementById('map-canvas');
  if (!canvas) return;
  var cx = canvas.width  / 2;
  var cy = canvas.height / 2;
  var newScale = Math.max(0.2, Math.min(10, _mapScale * factor));
  _mapOffX = cx - (cx - _mapOffX) * (newScale / _mapScale);
  _mapOffY = cy - (cy - _mapOffY) * (newScale / _mapScale);
  _mapScale = newScale;
  redrawMap();
}

function fitMap() {
  if (!_mapSchemeImg) return;
  var canvas = document.getElementById('map-canvas');
  if (!canvas) return;
  var fitScale = Math.min(canvas.width / _mapSchemeImg.width, canvas.height / _mapSchemeImg.height);
  _mapScale = fitScale > 0 ? fitScale : 1;
  _mapOffX  = (canvas.width  - _mapSchemeImg.width  * _mapScale) / 2;
  _mapOffY  = (canvas.height - _mapSchemeImg.height * _mapScale) / 2;
  redrawMap();
}

// ── Режим добавления точки ────────────────────────────────
function toggleMapAddMode() {
  _mapAddMode = !_mapAddMode;
  var canvas = document.getElementById('map-canvas');
  var btn    = document.getElementById('btn-map-add-point');
  var hint   = document.getElementById('map-add-hint');
  if (canvas) {
    canvas.classList.toggle('adding-mode', _mapAddMode);
    canvas.style.cursor = _mapAddMode ? 'crosshair' : 'grab';
  }
  if (btn) {
    btn.style.background   = _mapAddMode ? 'var(--blue)' : '';
    btn.style.color        = _mapAddMode ? '#fff'        : '';
    btn.style.borderColor  = _mapAddMode ? 'var(--blue)' : '';
    btn.style.fontWeight   = _mapAddMode ? '700'         : '';
    btn.textContent        = _mapAddMode ? '🎯 Выберите место...' : '➕ Добавить точку';
  }
  if (hint) hint.style.display = _mapAddMode ? 'inline' : 'none';
}

function openAddPointModal(xLocal, yLocal) {
  _mapAddMode = false;
  var canvas = document.getElementById('map-canvas');
  var btn    = document.getElementById('btn-map-add-point');
  var hint   = document.getElementById('map-add-hint');
  if (canvas) { canvas.classList.remove('adding-mode'); canvas.style.cursor = 'grab'; }
  if (btn)    { btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; btn.style.fontWeight = ''; btn.textContent = '➕ Добавить точку'; }
  if (hint)   hint.style.display = 'none';

  AppState.editingPointId = null;
  ['e-num','e-intensity','e-flowrate','e-color','e-wall','e-comment']
    .forEach(function(id) { setField(id, ''); });
  setField('e-status', 'Новая');
  updateWorkerSelects();
  // Координаты из клика по карте — pixelToLocal уже даёт правильный порядок:
  //   xLocal = 45850..47350 (горизонталь, растёт слева направо) → поле X
  //   yLocal = 15800..17350 (вертикаль,  растёт сверху вниз)    → поле Y
  if (typeof MapModule !== 'undefined') {
    setField('e-xlocal', xLocal.toFixed(4));
    setField('e-ylocal', yLocal.toFixed(4));
    var wgs = MapModule.xyToWgs84(xLocal, yLocal);
    if (wgs && wgs.lat) {
      setField('e-lat', wgs.lat.toFixed(7));
      setField('e-lon', wgs.lon.toFixed(7));
    }
    var coordInfo = document.getElementById('e-map-coord-info');
    if (coordInfo) coordInfo.textContent = 'X: ' + xLocal.toFixed(4) + '  Y: ' + yLocal.toFixed(4) + ' (из карты)';
  }

  var preview = document.getElementById('e-photo-preview');
  if (preview) preview.innerHTML = '';
  Photos.clearInput('e-photo', 'e-new-photo-preview');
  var delBtn = document.getElementById('e-delete-photo-btn');
  if (delBtn) delBtn.style.display = 'none';

  var form = document.getElementById('edit-form');
  form._mapCoords = { xLocal: xLocal, yLocal: yLocal };

  document.getElementById('edit-modal-title').textContent = 'Новая точка на карте';
  var submitBtn = document.querySelector('#edit-form [type=submit]');
  if (submitBtn) submitBtn.textContent = 'Сохранить точку';

  // Автоопределяем домен ПОСЛЕДНИМ — после всех инициализаций
  (function() {
    var domainEl = document.getElementById('e-domain');
    if (!domainEl || typeof Domens === 'undefined') { return; }
    var autoDomen = Domens.findDomenAt(xLocal, yLocal);
    if (autoDomen) {
      domainEl.value = autoDomen;
    }
  })();

  document.getElementById('edit-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(function() {
    var f = document.getElementById('e-num');
    if (f) f.focus();
  }, 150);
}


// ── Tooltip при наведении ────────────────────────────────
var _tooltipEl = null;

function showMapTooltip(p, clientX, clientY) {
  if (!_tooltipEl) {
    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'map-tooltip';
    document.body.appendChild(_tooltipEl);
  }
  var color = (typeof MapModule !== 'undefined')
    ? (MapModule.STATUS_COLORS[p.status] || '#666') : '#666';

  _tooltipEl.innerHTML =
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
    '<span style="width:10px;height:10px;border-radius:50%;background:' + color +
    ';border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3);flex-shrink:0"></span>' +
    '<strong>#' + (p.pointNumber || '?') + '</strong>' +
    '<span style="color:' + color + ';font-size:11px">' + (p.status || '') + '</span>' +
    '</div>' +
    (p.worker    ? '<div>👤 ' + p.worker + '</div>' : '') +
    (p.flowRate != null ? '<div>💧 ' + p.flowRate + ' л/с</div>' : '') +
    (p.intensity ? '<div>' + p.intensity + '</div>' : '') +
    '<div style="color:var(--gray-600);font-size:11px">' + formatDate(p.createdAt) + '</div>';

  var tw = 180, th = 90;
  var left = clientX + 12;
  var top  = clientY - 10;
  if (left + tw > window.innerWidth)  left = clientX - tw - 12;
  if (top  + th > window.innerHeight) top  = clientY - th - 10;
  _tooltipEl.style.left    = left + 'px';
  _tooltipEl.style.top     = top  + 'px';
  _tooltipEl.style.display = 'block';
}

function hideMapTooltip() {
  if (_tooltipEl) _tooltipEl.style.display = 'none';
}

function showMapPointCard(p) {
  var existing = document.getElementById('map-point-card');
  if (existing) existing.remove();

  var card = document.createElement('div');
  card.id = 'map-point-card';
  card.className = 'map-point-card';
  card.innerHTML =
    '<div class="map-point-card__header">' +
    '<span class="point-card__num">#' + (p.pointNumber || '—') + '</span>' +
    '<button class="modal-close" id="map-card-close">✕</button>' +
    '</div>' +
    '<div class="map-point-card__body">' +
    '<div>👤 ' + (p.worker || '—') + '</div>' +
    '<div>📅 ' + formatDate(p.createdAt) + '</div>' +
    (p.status    ? '<div>📌 ' + p.status    + '</div>' : '') +
    (p.intensity ? '<div>💧 ' + p.intensity + (p.flowRate != null ? ' · ' + p.flowRate + ' л/с' : '') + '</div>' : '') +
    (p.waterColor ? '<div>🎨 ' + p.waterColor + '</div>' : '') +
    (p.wall       ? '<div>🏔 ' + p.wall      + '</div>' : '') +
    (p.domain     ? '<div>📍 ' + p.domain    + '</div>' : '') +
    (p.xLocal != null || p.yLocal != null
      ? '<div style="font-size:11px;color:var(--gray-600)">X: ' +
        (p.xLocal != null ? Number(p.xLocal).toFixed(4) : '—') + '  Y: ' +
        (p.yLocal != null ? Number(p.yLocal).toFixed(4) : '—') + '</div>'
      : '') +
    (p.comment    ? '<div class="point-card__comment">' + p.comment + '</div>' : '') +
    '</div>' +
    '<div class="map-point-card__actions">' +
    '<button class="btn btn-sm btn-outline map-card-edit" data-pid="' + p.id + '">✏️ Изменить</button>' +
    '</div>';

  document.getElementById('page-map').appendChild(card);

  document.getElementById('map-card-close').addEventListener('click', function() {
    card.remove();
  });
  card.querySelector('.map-card-edit').addEventListener('click', function() {
    card.remove();
    openEditModal(this.dataset.pid);
  });
}

// ── Настройки — схемы ────────────────────────────────────
function initSettings() {
  // Показываем текущую неделю
  var weekEl = document.getElementById('settings-week-key');
  if (weekEl) weekEl.textContent = Schemes.formatWeekKey(Schemes.currentWeekKey());

  // Превью файла
  var fileInput = document.getElementById('scheme-file');
  if (fileInput) {
    fileInput.addEventListener('change', function() {
      var file = fileInput.files && fileInput.files[0];
      var preview = document.getElementById('scheme-preview');
      if (!preview) return;
      if (!file) { preview.innerHTML = ''; return; }
      var url = URL.createObjectURL(file);
      var img = document.createElement('img');
      img.src = url;
      img.onload = function() { URL.revokeObjectURL(url); };
      preview.innerHTML = '';
      preview.appendChild(img);
    });
  }

  // Кнопка загрузки
  var uploadBtn = document.getElementById('btn-upload-scheme');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', uploadScheme);
  }
}

function renderSettingsSchemes() {
  var weekEl = document.getElementById('settings-week-key');
  if (weekEl) weekEl.textContent = Schemes.formatWeekKey(Schemes.currentWeekKey());

  var container = document.getElementById('settings-schemes-list');
  if (!container) return;
  var schemes = Schemes.getList();
  var current = Schemes.currentWeekKey();

  if (!schemes.length) {
    container.innerHTML = '<p class="form-hint">Схем пока нет</p>';
    return;
  }

  var html = '';
  for (var i = 0; i < schemes.length; i++) {
    var s = schemes[i];
    var isCurrent = s.weekKey === current;
    html += '<div class="scheme-item">';
    html += '<div>';
    html += '<div class="scheme-item__week">' + Schemes.formatWeekKey(s.weekKey) + '</div>';
    var uploadDate = (s.uploadedAt && s.uploadedAt !== 'undefined') ? formatDate(s.uploadedAt) : '—';
    html += '<div class="scheme-item__date">' + uploadDate + '</div>';
    html += '</div>';
    if (isCurrent) html += '<span class="scheme-item__current">✅ Текущая</span>';
    html += '</div>';
  }
  container.innerHTML = html;
}

function uploadScheme() {
  var fileInput = document.getElementById('scheme-file');
  var statusEl  = document.getElementById('scheme-upload-status');
  var file = fileInput && fileInput.files && fileInput.files[0];
  if (!file) { alert('Выберите файл схемы'); return; }

  var weekKey   = Schemes.currentWeekKey();
  var uploadBtn = document.getElementById('btn-upload-scheme');
  if (statusEl)  statusEl.textContent = '⏳ Загрузка... (~15-30 сек)';
  if (uploadBtn) uploadBtn.disabled = true;
  AppState.syncing = true;

  Schemes.upload(file, weekKey, Storage.getDeviceId()).then(function() {
    if (statusEl) statusEl.textContent = '✅ Схема загружена — ' + Schemes.formatWeekKey(weekKey);
    var preview = document.getElementById('scheme-preview');
    if (preview) preview.innerHTML = '';
    if (fileInput) fileInput.value = '';
    renderSettingsSchemes();
  }).catch(function(err) {
    if (statusEl) statusEl.textContent = '❌ ' + err.message;
  }).then(function() {
    if (uploadBtn) uploadBtn.disabled = false;
    AppState.syncing = false;
  });
}

// ── GPS для формы ────────────────────────────────────────
function getGPSForForm(prefix) {
  if (!navigator.geolocation) { alert('GPS не поддерживается'); return; }
  var btnId = (prefix === 'f') ? 'btn-gps' : (prefix + '-btn-gps');
  var btn   = document.getElementById(btnId);
  if (btn) { btn.textContent = '⏳...'; btn.disabled = true; }
  navigator.geolocation.getCurrentPosition(function(pos) {
    var lat = pos.coords.latitude;
    var lon = pos.coords.longitude;
    setField(prefix + '-lat', lat.toFixed(7));
    setField(prefix + '-lon', lon.toFixed(7));
    // Пересчитываем в локальные (X↔Y переставлены для отображения)
    if (typeof MapModule !== 'undefined') {
      var sk = MapModule.wgs84ToXY(lat, lon);
      setField(prefix + '-xlocal', sk.x.toFixed(4));
      setField(prefix + '-ylocal', sk.y.toFixed(4));
      var info = document.getElementById(prefix + '-map-coord-info');
      if (info) info.textContent = 'X: ' + sk.x.toFixed(4) + '  Y: ' + sk.y.toFixed(4) + ' (из GPS)';
    }
    if (btn) { btn.textContent = '📍 GPS'; btn.disabled = false; }
  }, function(err) {
    alert('GPS: ' + err.message);
    if (btn) { btn.textContent = '📍 GPS'; btn.disabled = false; }
  }, { enableHighAccuracy: true, timeout: 15000 });
}

// При изменении lat/lon вручную — пересчитываем X/Y
function recalcLocalCoords(prefix) {
  var lat = parseFloatOrNull(getField(prefix + '-lat'));
  var lon = parseFloatOrNull(getField(prefix + '-lon'));
  if (lat && lon && typeof MapModule !== 'undefined') {
    var sk = MapModule.wgs84ToXY(lat, lon);
    setField(prefix + '-xlocal', sk.x.toFixed(4));
    setField(prefix + '-ylocal', sk.y.toFixed(4));
    var info = document.getElementById(prefix + '-map-coord-info');
    if (info) info.textContent = 'X: ' + sk.x.toFixed(4) + '  Y: ' + sk.y.toFixed(4);
  }
}

// ── Утилиты ───────────────────────────────────────────────
function readFormFields(prefix) {
  return {
    pointNumber: getField(prefix + '-num'),
    worker:      getField(prefix + '-worker'),
    lat:         parseFloatOrNull(getField(prefix + '-lat')),
    lon:         parseFloatOrNull(getField(prefix + '-lon')),
    xLocal:      parseFloatOrNull(getField(prefix + '-xlocal')),
    yLocal:      parseFloatOrNull(getField(prefix + '-ylocal')),
    intensity:   getField(prefix + '-intensity'),
    flowRate:    parseFloatOrNull(getField(prefix + '-flowrate')),
    waterColor:  getField(prefix + '-color'),
    wall:        getField(prefix + '-wall'),
    domain:      getField(prefix + '-domain'),
    status:      getField(prefix + '-status') || 'Новая',
    comment:     getField(prefix + '-comment'),
  };
}
function setField(id, v) {
  var el = document.getElementById(id);
  if (el) el.value = (v != null) ? v : '';
}
function getField(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}
function parseFloatOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  var n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}
function initials(name) {
  return (name || '').split(' ').map(function(s) { return s[0] || ''; }).join('').slice(0, 2).toUpperCase();
}
function escAttr(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
function formatCoord(v) {
  if (v == null || v === '') return '—';
  var n = parseFloat(v);
  return isNaN(n) ? String(v) : n.toFixed(4);
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10) || '—';
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch(e) { return '—'; }
}
