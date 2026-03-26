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
  if (name === 'map')      renderMap();
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
  if (gps) gps.addEventListener('click', getGPS);
}

function resetAddForm() {
  var form = document.getElementById('add-form');
  if (form) form.reset();
  Photos.clearInput('f-photo', 'f-photo-preview');
}

function saveNewPoint() {
  var data = readFormFields('f');
  if (!data.pointNumber) { alert('Укажите номер точки'); return; }
  var photoFile = Photos.getFile('f-photo');
  AppState.syncing = true; // блокируем фоновую синхронизацию
  showLoader('Сохранение...');
  Points.create(data).then(function(savedPoint) {
    if (!photoFile || !savedPoint || !savedPoint.id) return null;
    showLoader('Загрузка фото...');
    return Photos.uploadAndReplace(photoFile, savedPoint.id).then(function(url) {
      if (url) {
        return Points.update(savedPoint.id, { photoUrls: [url] });
      }
      // url=null — таймаут или ошибка, точка сохранена без фото
    });
  }).then(function() {
    resetAddForm();
    return Points.load();
  }).then(function() {
    renderPointsList();
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
  setField('e-intensity', p.intensity   || '');
  setField('e-flowrate',  p.flowRate != null ? p.flowRate : '');
  setField('e-color',     p.waterColor  || '');
  setField('e-wall',      p.wall        || '');
  setField('e-domain',    p.domain      || '');
  setField('e-status',    p.status      || 'Новая');
  setField('e-comment',   p.comment     || '');
  updateWorkerSelects();
  setField('e-worker', p.worker || '');

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
}

function saveEditedPoint() {
  if (!AppState.editingPointId) return;
  var id        = AppState.editingPointId;
  var data      = readFormFields('e');
  var photoFile = Photos.getFile('e-photo');
  if (!data.pointNumber) { alert('Укажите номер точки'); return; }
  showLoader('Сохранение...');
  closeEditModal();

  AppState.syncing = true; // блокируем фоновую синхронизацию
  var chain;
  if (photoFile) {
    showLoader('Загрузка фото...');
    chain = Photos.uploadAndReplace(photoFile, id).then(function(newUrl) {
      if (newUrl) {
        data.photoUrls = [newUrl]; // атомарная замена подтверждена
      }
      // newUrl=null — таймаут, сохраняем поля без изменения photoUrls
      return Points.update(id, data);
    });
  } else {
    // Фото не меняем — не передаём photoUrls, сервер возьмёт из Sheets
    chain = Points.update(id, data);
  }

  chain.then(function() {
    return Points.load();
  }).then(function() {
    renderPointsList();
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

  Api.deletePhoto(id).then(function() {
    // Ждём 1.5 сек — Apps Script завершает запись
    return new Promise(function(r) { setTimeout(r, 1500); });
  }).then(function() {
    return Points.update(id, { photoUrls: [] });
  }).then(function() {
    return Points.load();
  }).then(function() {
    // Обновляем UI только после подтверждения
    var preview = document.getElementById('e-photo-preview');
    if (preview) preview.innerHTML = '';
    var delBtn = document.getElementById('e-delete-photo-btn');
    if (delBtn) delBtn.style.display = 'none';
    renderPointsList();
    AppState.syncing = false;
    hideLoader();
  }).catch(function(err) {
    Diagnostics.setError('photo', 'Удаление фото: ' + err.message);
    AppState.syncing = false;
    hideLoader();
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
function getGPS() {
  if (!navigator.geolocation) { alert('GPS не поддерживается'); return; }
  var btn = document.getElementById('btn-gps');
  if (btn) btn.textContent = '⏳...';
  navigator.geolocation.getCurrentPosition(function(pos) {
    setField('f-lat', pos.coords.latitude.toFixed(7));
    setField('f-lon', pos.coords.longitude.toFixed(7));
    if (btn) btn.textContent = '📍 GPS';
  }, function(err) {
    alert('GPS: ' + err.message);
    if (btn) btn.textContent = '📍 GPS';
  }, { enableHighAccuracy: true, timeout: 15000 });
}

// ── Карта ────────────────────────────────────────────────
function renderMap() {
  var canvas  = document.getElementById('map-canvas');
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

  Schemes.getCurrentImage().then(function(dataUrl) {
    if (!dataUrl) {
      canvas.style.display = 'none';
      if (noScheme) noScheme.style.display = 'block';
      return;
    }
    var img = new Image();
    img.onload = function() {
      canvas.width  = img.width;
      canvas.height = img.height;
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
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

// ── Утилиты ───────────────────────────────────────────────
function readFormFields(prefix) {
  return {
    pointNumber: getField(prefix + '-num'),
    worker:      getField(prefix + '-worker'),
    lat:         parseFloatOrNull(getField(prefix + '-lat')),
    lon:         parseFloatOrNull(getField(prefix + '-lon')),
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
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function initials(name) {
  return (name || '').split(' ').map(function(s) { return s[0] || ''; }).join('').slice(0, 2).toUpperCase();
}
function escAttr(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
function formatDate(iso) {
  if (!iso) return '—';
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10) || '—';
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch(e) { return '—'; }
}
