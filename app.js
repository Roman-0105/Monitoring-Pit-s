/**
 * app.js — инициализация и UI.
 * Все строки используют одинарные кавычки.
 * Нет шаблонных строк (backtick).
 * onclick заменены на addEventListener через data-атрибуты.
 */

window.APP_CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxTV9f7gHMC7iYktKznRMdoocDVZ6CF8_G00WfOFxxeP7ztMmY2CBgchgc3-XgRCDev/exec',
  SYNC_INTERVAL_MS: 30000,
};

var AppState = {
  currentTab:     'points',
  editingPointId: null,
  selectedWorker: null,
};

// ── Инициализация ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  showLoader('Загрузка...');
  initTabs();
  initForms();
  Diagnostics.render();
  initialLoad();
  setInterval(syncAll, APP_CONFIG.SYNC_INTERVAL_MS);
  window.addEventListener('online', function() {
    Points.flushQueue();
    syncAll();
  });
  var devEl = document.getElementById('device-id-display');
  if (devEl) devEl.textContent = Storage.getDeviceId();
  var suEl = document.getElementById('script-url-status');
  if (suEl) suEl.textContent = (APP_CONFIG.SCRIPT_URL && APP_CONFIG.SCRIPT_URL.indexOf('ВСТАВЬ') < 0) ? '✅ задан' : '❌ не задан';
});

function initialLoad() {
  Promise.all([Workers.load(), Points.load()]).then(function() {
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
}

function syncAll() {
  if (!navigator.onLine) return;
  Points.flushQueue().then(function() {
    return Points.load();
  }).then(function() {
    return Workers.load();
  }).then(function() {
    renderPointsList();
    renderWorkers();
    Diagnostics.clearError();
  }).catch(function(err) {
    Diagnostics.setError('sync', err.message);
  });
}

// ── Вкладки ───────────────────────────────────────────────
function initTabs() {
  var btns = document.querySelectorAll('[data-tab]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function() {
      switchTab(this.dataset.tab);
    });
  }
}

function switchTab(name) {
  AppState.currentTab = name;
  var btns = document.querySelectorAll('.tab-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].dataset.tab === name);
  }
  var pages = document.querySelectorAll('.page');
  for (var j = 0; j < pages.length; j++) {
    pages[j].classList.toggle('active', pages[j].id === 'page-' + name);
  }
  if (name === 'add' && !AppState.editingPointId) {
    resetForm();
  }
  if (name === 'diag') {
    Diagnostics.render();
  }
  if (name === 'workers') {
    renderWorkerManageList();
  }
}

// ── Лоадер ───────────────────────────────────────────────
function showLoader(msg) {
  var el = document.getElementById('loader');
  if (el) { el.textContent = msg; el.style.display = 'flex'; }
}
function hideLoader() {
  var el = document.getElementById('loader');
  if (el) el.style.display = 'none';
}

// ── Рендер точек ─────────────────────────────────────────
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
    var pending = p.syncStatus !== 'synced';
    var statusClass = (p.status || '').toLowerCase().replace(/\s/g, '-');
    html += '<div class="point-card' + (pending ? ' point-pending' : '') + '" data-id="' + p.id + '">';
    html += '<div class="point-card__header">';
    html += '<span class="point-card__num">#' + (p.pointNumber || '—') + '</span>';
    html += '<span class="point-card__status status-' + statusClass + '">' + (p.status || '') + '</span>';
    if (pending) html += '<span class="sync-badge">⏳</span>';
    html += '</div>';
    html += '<div class="point-card__body">';
    html += '<div>👤 ' + (p.worker || '—') + '</div>';
    html += '<div>📅 ' + formatDate(p.createdAt) + '</div>';
    if (p.intensity) {
      html += '<div>💧 ' + p.intensity;
      if (p.flowRate != null) html += ' · ' + p.flowRate + ' л/с';
      html += '</div>';
    }
    if (p.domain) html += '<div>📍 ' + p.domain + '</div>';
    if (p.comment) html += '<div class="point-card__comment">' + p.comment + '</div>';
    if (p.photoUrls && p.photoUrls[0]) html += '<div class="point-card__photo">📷 Фото</div>';
    html += '</div>';
    html += '<div class="point-card__actions">';
    html += '<button class="btn btn-sm btn-outline btn-edit" data-pid="' + p.id + '">✏️ Изменить</button>';
    html += '<button class="btn btn-sm btn-danger btn-del" data-pid="' + p.id + '">🗑 Удалить</button>';
    html += '</div></div>';
  }
  container.innerHTML = html;

  container.querySelectorAll('.btn-edit').forEach(function(btn) {
    btn.addEventListener('click', function() { startEdit(this.dataset.pid); });
  });
  container.querySelectorAll('.btn-del').forEach(function(btn) {
    btn.addEventListener('click', function() { confirmDelete(this.dataset.pid); });
  });
}

// ── Рендер сотрудников ────────────────────────────────────
function renderWorkers() {
  var grid = document.getElementById('worker-grid');
  if (!grid) return;
  var workers = Workers.getList();
  var html = '';
  for (var i = 0; i < workers.length; i++) {
    var w = workers[i];
    var sel = AppState.selectedWorker === w.name ? ' selected' : '';
    html += '<button class="worker-btn' + sel + '" data-wname="' + w.name.replace(/"/g, '&quot;') + '">';
    html += '<span class="worker-btn__avatar">' + initials(w.name) + '</span>';
    html += '<span>' + w.name + '</span></button>';
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.worker-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      selectWorker(this.dataset.wname);
    });
  });

  var sel = document.getElementById('f-worker');
  if (sel) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">— выберите —</option>';
    for (var j = 0; j < workers.length; j++) {
      var opt = document.createElement('option');
      opt.value = workers[j].name;
      opt.textContent = workers[j].name;
      sel.appendChild(opt);
    }
    if (cur) sel.value = cur;
  }
}

function selectWorker(name) {
  AppState.selectedWorker = name;
  renderWorkers();
}

// ── Управление сотрудниками ───────────────────────────────
function renderWorkerManageList() {
  var container = document.getElementById('workers-manage-list');
  if (!container) return;
  var workers = Workers.getList();
  if (!workers.length) {
    container.innerHTML = '<p class="empty-msg" style="padding:12px 0">Список пуст</p>';
    return;
  }
  var html = '';
  for (var i = 0; i < workers.length; i++) {
    var w = workers[i];
    html += '<div class="worker-manage-row" data-wid="' + w.id + '">';
    html += '<input type="text" value="' + w.name.replace(/"/g, '&quot;') + '">';
    html += '<button class="btn-icon btn-icon-del">×</button>';
    html += '</div>';
  }
  container.innerHTML = html;

  container.querySelectorAll('.worker-manage-row').forEach(function(row) {
    var wid = row.dataset.wid;
    var inp = row.querySelector('input');
    var btn = row.querySelector('.btn-icon-del');
    inp.addEventListener('change', function() { renameWorker(wid, this.value); });
    btn.addEventListener('click', function() { removeWorkerFromUI(wid); });
  });
}

function addWorkerFromUI() {
  var inp = document.getElementById('new-worker-name');
  var name = inp ? inp.value.trim() : '';
  if (!name) { alert('Введите имя'); return; }
  Workers.add(name).then(function() {
    if (inp) inp.value = '';
    renderWorkers();
    renderWorkerManageList();
  });
}

function removeWorkerFromUI(id) {
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
      list[i].name = newName.trim();
      list[i].updatedAt = new Date().toISOString();
      Storage.cacheWorkers(list);
      Api.saveWorker(list[i]).catch(function(e) { console.warn(e); });
      renderWorkers();
      break;
    }
  }
}

// ── Форма добавления/редактирования ──────────────────────
function initForms() {
  var form = document.getElementById('point-form');
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      savePointFromForm();
    });
  }
  var gpsBtn = document.getElementById('btn-gps');
  if (gpsBtn) gpsBtn.addEventListener('click', getGPS);
  if (typeof Photos !== 'undefined') Photos.initPhotoInput('f-photo', 'f-photo-preview');
}

function resetForm() {
  var form = document.getElementById('point-form');
  if (form) form.reset();
  if (typeof Photos !== 'undefined') Photos.clearInput('f-photo', 'f-photo-preview');
  document.getElementById('form-title').textContent = 'Новая точка';
  document.getElementById('btn-save').textContent = 'Сохранить';
  AppState.editingPointId = null;
}

function startEdit(id) {
  var p = Points.getById(id);
  if (!p) return;
  AppState.editingPointId = id;
  switchTab('add');
  requestAnimationFrame(function() {
    setField('f-num',       p.pointNumber);
    setField('f-worker',    p.worker);
    setField('f-lat',       p.lat != null ? p.lat : '');
    setField('f-lon',       p.lon != null ? p.lon : '');
    setField('f-intensity', p.intensity);
    setField('f-flowrate',  p.flowRate != null ? p.flowRate : '');
    setField('f-color',     p.waterColor);
    setField('f-wall',      p.wall);
    setField('f-domain',    p.domain);
    setField('f-status',    p.status);
    setField('f-comment',   p.comment);
    document.getElementById('form-title').textContent = 'Редактирование #' + p.pointNumber;
    document.getElementById('btn-save').textContent = 'Сохранить изменения';
    var preview = document.getElementById('f-photo-preview');
    if (preview) {
      if (p.photoUrls && p.photoUrls[0]) {
        var img = document.createElement('img');
        img.src = p.photoUrls[0];
        img.alt = 'фото';
        var div = document.createElement('div');
        div.className = 'photo-preview photo-preview--existing';
        var lbl = document.createElement('span');
        lbl.className = 'photo-label';
        lbl.textContent = 'Текущее фото';
        div.appendChild(img);
        div.appendChild(lbl);
        preview.innerHTML = '';
        preview.appendChild(div);
      } else {
        preview.innerHTML = '';
      }
    }
  });
}

function savePointFromForm() {
  var data = {
    pointNumber: getField('f-num'),
    worker:      getField('f-worker'),
    lat:         parseFloatOrNull(getField('f-lat')),
    lon:         parseFloatOrNull(getField('f-lon')),
    intensity:   getField('f-intensity'),
    flowRate:    parseFloatOrNull(getField('f-flowrate')),
    waterColor:  getField('f-color'),
    wall:        getField('f-wall'),
    domain:      getField('f-domain'),
    status:      getField('f-status') || 'Новая',
    comment:     getField('f-comment'),
  };

  if (!data.pointNumber) { alert('Укажите номер точки'); return; }

  showLoader('Сохранение...');

  var savePromise;
  if (AppState.editingPointId) {
    savePromise = Points.update(AppState.editingPointId, data);
  } else {
    savePromise = Points.create(data);
  }

  savePromise.then(function(savedPoint) {
    if (!savedPoint) savedPoint = Points.getById(AppState.editingPointId);
    var photoFile = (typeof Photos !== 'undefined') ? Photos.getFile('f-photo') : null;
    if (photoFile && savedPoint && savedPoint.id) {
      showLoader('Загрузка фото...');
      return Photos.upload(photoFile, savedPoint.id).catch(function(e) {
        console.warn('Photo upload:', e.message);
      });
    }
  }).then(function() {
    if (typeof Photos !== 'undefined') Photos.clearInput('f-photo', 'f-photo-preview');
    return Points.load();
  }).then(function() {
    renderPointsList();
    switchTab('points');
    Diagnostics.set('pointsLoaded', Points.getList().length);
    hideLoader();
  }).catch(function(err) {
    Diagnostics.setError('sync', 'Сохранение: ' + err.message);
    alert('Ошибка: ' + err.message);
    hideLoader();
  });
}

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
    Diagnostics.setError('sync', 'Удаление: ' + err.message);
    alert('Ошибка удаления: ' + err.message);
    hideLoader();
  });
}

// ── GPS ──────────────────────────────────────────────────
function getGPS() {
  if (!navigator.geolocation) { alert('GPS не поддерживается'); return; }
  var btn = document.getElementById('btn-gps');
  if (btn) btn.textContent = '⏳ Определяем...';
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      setField('f-lat', pos.coords.latitude.toFixed(7));
      setField('f-lon', pos.coords.longitude.toFixed(7));
      if (btn) btn.textContent = '📍 GPS';
    },
    function(err) {
      alert('GPS ошибка: ' + err.message);
      if (btn) btn.textContent = '📍 GPS';
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

// ── Утилиты ───────────────────────────────────────────────
function setField(id, value) {
  var el = document.getElementById(id);
  if (el) el.value = (value != null) ? value : '';
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
  return (name || '').split(' ').map(function(p) { return p[0]; }).join('').slice(0, 2).toUpperCase();
}
function formatDate(iso) {
  if (!iso) return '—';
  try {
    var d = new Date(iso);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch(e) { return iso; }
}
