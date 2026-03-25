/**
 * app.js — инициализация и UI.
 * Форма добавления — только новые точки, всегда сбрасывается.
 * Редактирование — в модальном окне поверх любой вкладки.
 */

window.APP_CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxTV9f7gHMC7iYktKznRMdoocDVZ6CF8_G00WfOFxxeP7ztMmY2CBgchgc3-XgRCDev/exec',
  SYNC_INTERVAL_MS: 30000,
};

var AppState = {
  currentTab:     'points',
  editingPointId: null,
};

// ── Инициализация ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  showLoader('Загрузка...');
  initTabs();
  initAddForm();
  initEditModal();
  Diagnostics.render();

  var devEl = document.getElementById('device-id-display');
  if (devEl) devEl.textContent = Storage.getDeviceId();
  var suEl = document.getElementById('script-url-status');
  if (suEl) suEl.textContent = (APP_CONFIG.SCRIPT_URL && APP_CONFIG.SCRIPT_URL.indexOf('ВСТАВЬ') < 0) ? '✅ задан' : '❌ не задан';

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

  setInterval(syncAll, APP_CONFIG.SYNC_INTERVAL_MS);
  window.addEventListener('online', function() {
    Points.flushQueue();
    syncAll();
  });
});

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
  // При переходе на "Добавить" — всегда сбрасываем форму
  if (name === 'add') {
    resetAddForm();
  }
  if (name === 'diag') Diagnostics.render();
  if (name === 'workers') renderWorkerManageList();
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
    html += '<div class="point-card' + (pending ? ' point-pending' : '') + '">';
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
    btn.addEventListener('click', function() { openEditModal(this.dataset.pid); });
  });
  container.querySelectorAll('.btn-del').forEach(function(btn) {
    btn.addEventListener('click', function() { confirmDelete(this.dataset.pid); });
  });
}

// ── Рендер сотрудников ────────────────────────────────────
function renderWorkers() {
  var grid = document.getElementById('worker-grid');
  if (grid) {
    var workers = Workers.getList();
    var html = '';
    for (var i = 0; i < workers.length; i++) {
      var w = workers[i];
      html += '<button class="worker-btn" data-wname="' + w.name.replace(/"/g, '&quot;') + '">';
      html += '<span class="worker-btn__avatar">' + initials(w.name) + '</span>';
      html += '<span>' + w.name + '</span></button>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.worker-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { selectWorker(this.dataset.wname); });
    });
  }
  updateWorkerSelects();
}

function updateWorkerSelects() {
  var workers = Workers.getList();
  var selects = ['f-worker', 'e-worker'];
  for (var s = 0; s < selects.length; s++) {
    var sel = document.getElementById(selects[s]);
    if (!sel) continue;
    var cur = sel.value;
    sel.innerHTML = '<option value="">— выберите —</option>';
    for (var i = 0; i < workers.length; i++) {
      var opt = document.createElement('option');
      opt.value = workers[i].name;
      opt.textContent = workers[i].name;
      sel.appendChild(opt);
    }
    if (cur) sel.value = cur;
  }
}

function selectWorker(name) {
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
    row.querySelector('input').addEventListener('change', function() { renameWorker(wid, this.value); });
    row.querySelector('.btn-icon-del').addEventListener('click', function() { removeWorkerFromUI(wid); });
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

// ── ФОРМА ДОБАВЛЕНИЯ (только новые точки) ────────────────
function initAddForm() {
  var form = document.getElementById('add-form');
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      saveNewPoint();
    });
  }
  var gpsBtn = document.getElementById('btn-gps');
  if (gpsBtn) gpsBtn.addEventListener('click', getGPS);
  if (typeof Photos !== 'undefined') Photos.initPhotoInput('f-photo', 'f-photo-preview');
}

function resetAddForm() {
  var form = document.getElementById('add-form');
  if (form) form.reset();
  if (typeof Photos !== 'undefined') Photos.clearInput('f-photo', 'f-photo-preview');
}

function saveNewPoint() {
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
  Points.create(data).then(function(savedPoint) {
    var photoFile = (typeof Photos !== 'undefined') ? Photos.getFile('f-photo') : null;
    if (photoFile && savedPoint && savedPoint.id) {
      showLoader('Загрузка фото...');
      return Photos.upload(photoFile, savedPoint.id).catch(function(e) {
        console.warn('Photo:', e.message);
      });
    }
  }).then(function() {
    resetAddForm();
    return Points.load();
  }).then(function() {
    renderPointsList();
    switchTab('points');
    Diagnostics.set('pointsLoaded', Points.getList().length);
    hideLoader();
  }).catch(function(err) {
    Diagnostics.setError('sync', err.message);
    alert('Ошибка: ' + err.message);
    hideLoader();
  });
}

// ── МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ────────────────────────
function initEditModal() {
  var closeBtn = document.getElementById('edit-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeEditModal);

  var overlay = document.getElementById('edit-modal');
  if (overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeEditModal();
    });
  }

  var form = document.getElementById('edit-form');
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      saveEditedPoint();
    });
  }

  if (typeof Photos !== 'undefined') Photos.initPhotoInput('e-photo', 'e-photo-preview');
}

function openEditModal(id) {
  var p = Points.getById(id);
  if (!p) return;
  AppState.editingPointId = id;

  document.getElementById('edit-modal-title').textContent = 'Редактирование #' + p.pointNumber;

  setField('e-num',       p.pointNumber);
  setField('e-lat',       p.lat != null ? p.lat : '');
  setField('e-lon',       p.lon != null ? p.lon : '');
  setField('e-intensity', p.intensity);
  setField('e-flowrate',  p.flowRate != null ? p.flowRate : '');
  setField('e-color',     p.waterColor);
  setField('e-wall',      p.wall);
  setField('e-domain',    p.domain);
  setField('e-status',    p.status);
  setField('e-comment',   p.comment);

  // Заполняем список сотрудников и выбираем текущего
  updateWorkerSelects();
  setField('e-worker', p.worker);

  // Показываем текущее фото
  var preview = document.getElementById('e-photo-preview');
  if (preview) {
    if (p.photoUrls && p.photoUrls[0]) {
      var img = document.createElement('img');
      img.src = p.photoUrls[0];
      img.alt = 'фото';
      img.style.cssText = 'max-width:100%;max-height:150px;border-radius:6px;display:block;margin-bottom:6px';
      img.onerror = function() { this.style.display = 'none'; };
      preview.innerHTML = '';
      preview.appendChild(img);
      var lbl = document.createElement('span');
      lbl.className = 'photo-label';
      lbl.textContent = 'Текущее фото';
      preview.appendChild(lbl);
    } else {
      preview.innerHTML = '';
    }
  }

  if (typeof Photos !== 'undefined') Photos.clearInput('e-photo', 'e-photo-preview-new');

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
  var data = {
    pointNumber: getField('e-num'),
    worker:      getField('e-worker'),
    lat:         parseFloatOrNull(getField('e-lat')),
    lon:         parseFloatOrNull(getField('e-lon')),
    intensity:   getField('e-intensity'),
    flowRate:    parseFloatOrNull(getField('e-flowrate')),
    waterColor:  getField('e-color'),
    wall:        getField('e-wall'),
    domain:      getField('e-domain'),
    status:      getField('e-status') || 'Новая',
    comment:     getField('e-comment'),
  };
  if (!data.pointNumber) { alert('Укажите номер точки'); return; }

  var id = AppState.editingPointId;
  showLoader('Сохранение...');
  closeEditModal();

  Points.update(id, data).then(function(savedPoint) {
    if (!savedPoint) savedPoint = Points.getById(id);
    var photoFile = (typeof Photos !== 'undefined') ? Photos.getFile('e-photo') : null;
    if (photoFile && savedPoint && savedPoint.id) {
      showLoader('Загрузка фото...');
      return Photos.upload(photoFile, savedPoint.id).catch(function(e) {
        console.warn('Photo:', e.message);
      });
    }
  }).then(function() {
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

// ── Удаление ─────────────────────────────────────────────
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
  return (name || '').split(' ').map(function(p) { return p[0] || ''; }).join('').slice(0, 2).toUpperCase();
}
function formatDate(iso) {
  if (!iso) return '—';
  try {
    var d = new Date(iso);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch(e) { return iso; }
}
