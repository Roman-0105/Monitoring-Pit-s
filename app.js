/**
 * app.js — инициализация приложения и маршрутизация вкладок.
 */

// ── Конфигурация ──────────────────────────────────────────
window.APP_CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbx7aqrKEHtn1VItIdWqGFX6QIcRw5wxx2jhr_E5mw5Gjp3CbjeUAIA_RLzHAn4u38ee/exec',
  SYNC_INTERVAL_MS: 30000, // 30 сек
};

// ── Состояние UI ──────────────────────────────────────────
const AppState = {
  currentTab:     'points',   // points | add | edit | workers | diag
  editingPointId: null,
  selectedWorker: null,
};

// ── Инициализация ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Показываем лоадер
  showLoader('Загрузка...');

  // Инициализируем UI компоненты
  initTabs();
  initForms();
  Diagnostics.render();

  // Первичная загрузка данных
  await initialLoad();

  // Запускаем polling
  setInterval(syncAll, APP_CONFIG.SYNC_INTERVAL_MS);

  // При восстановлении сети — сбрасываем очередь
  window.addEventListener('online', () => {
    Points.flushQueue();
    syncAll();
  });

  hideLoader();
});

async function initialLoad() {
  try {
    await Promise.all([Workers.load(), Points.load()]);
    renderWorkers();
    renderPointsList();
    Diagnostics.clearError();
  } catch (err) {
    Diagnostics.setError('sync', 'Начальная загрузка: ' + err.message);
  }
  Diagnostics.set('queueSize', Storage.getQueue().length);
}

async function syncAll() {
  if (!navigator.onLine) return;
  try {
    await Points.flushQueue();
    await Points.load();
    await Workers.load();
    renderPointsList();
    renderWorkers();
    Diagnostics.clearError();
  } catch (err) {
    Diagnostics.setError('sync', err.message);
  }
}

// ── Вкладки ───────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  AppState.currentTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === 'page-' + name);
  });
  if (name === 'add' && !AppState.editingPointId) {
    resetForm();
  }
  if (name === 'diag') {
    Diagnostics.render();
  }
}

// ── Лоадер ───────────────────────────────────────────────
function showLoader(msg) {
  const el = document.getElementById('loader');
  if (el) { el.textContent = msg; el.style.display = 'flex'; }
}
function hideLoader() {
  const el = document.getElementById('loader');
  if (el) el.style.display = 'none';
}

// ── Рендер списка точек ───────────────────────────────────
function renderPointsList() {
  const container = document.getElementById('points-list');
  if (!container) return;
  const points = Points.getList();

  if (!points.length) {
    container.innerHTML = '<p class="empty-msg">Точек пока нет</p>';
    return;
  }

  container.innerHTML = points.map(p => `
    <div class="point-card ${p.syncStatus !== 'synced' ? 'point-pending' : ''}" data-id="${p.id}">
      <div class="point-card__header">
        <span class="point-card__num">#${p.pointNumber || '—'}</span>
        <span class="point-card__status status-${p.status.toLowerCase().replace(/\s/g,'-')}">${p.status}</span>
        ${p.syncStatus !== 'synced' ? '<span class="sync-badge">⏳</span>' : ''}
      </div>
      <div class="point-card__body">
        <div>👤 ${p.worker || '—'}</div>
        <div>📅 ${formatDate(p.createdAt)}</div>
        ${p.intensity ? `<div>💧 ${p.intensity}${p.flowRate != null ? ' · ' + p.flowRate + ' л/с' : ''}</div>` : ''}
        ${p.domain ? `<div>📍 ${p.domain}</div>` : ''}
        ${p.comment ? `<div class="point-card__comment">${p.comment}</div>` : ''}
        ${p.photoUrls && p.photoUrls[0] ? `<div class="point-card__photo" data-url="${p.photoUrls[0]}">📷 Фото</div>` : ''}
      </div>
      <div class="point-card__actions">
        <button class="btn btn-sm btn-outline" onclick="startEdit('${p.id}')">✏️ Изменить</button>
        <button class="btn btn-sm btn-danger" onclick="confirmDelete('${p.id}')">🗑 Удалить</button>
      </div>
    </div>
  `).join('');
}

// ── Рендер сотрудников ────────────────────────────────────
function renderWorkers() {
  const grid = document.getElementById('worker-grid');
  if (!grid) return;
  const workers = Workers.getList();

  grid.innerHTML = workers.map(w => `
    <button class="worker-btn ${AppState.selectedWorker === w.name ? 'selected' : ''}"
            onclick="selectWorker('${w.name}')">
      <span class="worker-btn__avatar">${initials(w.name)}</span>
      <span>${w.name}</span>
    </button>
  `).join('');

  // Обновляем список в форме
  const sel = document.getElementById('f-worker');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">— выберите —</option>' +
      workers.map(w => `<option value="${w.name}">${w.name}</option>`).join('');
    if (cur) sel.value = cur;
  }
}

function selectWorker(name) {
  AppState.selectedWorker = name;
  renderWorkers();
}

// ── Форма добавления/редактирования ──────────────────────
function initForms() {
  const form = document.getElementById('point-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      savePointFromForm();
    });
  }

  const gpsBtn = document.getElementById('btn-gps');
  if (gpsBtn) {
    gpsBtn.addEventListener('click', getGPS);
  }

  Photos.initPhotoInput('f-photo', 'f-photo-preview');
}

function resetForm() {
  const form = document.getElementById('point-form');
  if (form) form.reset();
  Photos.clearInput('f-photo', 'f-photo-preview');
  document.getElementById('form-title').textContent = 'Новая точка';
  document.getElementById('btn-save').textContent = 'Сохранить';
  AppState.editingPointId = null;
}

function startEdit(id) {
  const p = Points.getById(id);
  if (!p) return;
  AppState.editingPointId = id;

  // Сначала переключаем вкладку, потом заполняем поля
  switchTab('add');

  // requestAnimationFrame гарантирует что DOM уже отображён
  requestAnimationFrame(() => {
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

    // Показываем текущее фото если есть
    const preview = document.getElementById('f-photo-preview');
    if (preview) {
      if (p.photoUrls && p.photoUrls[0]) {
        preview.innerHTML = \`<div class="photo-preview photo-preview--existing">
          <img src="\${p.photoUrls[0]}" alt="фото" onerror="this.parentNode.innerHTML='<span class=\\'photo-error\\'>Фото загружается...</span>'">
          <span class="photo-label">Текущее фото</span>
        </div>\`;
      } else {
        preview.innerHTML = '';
      }
    }
  });
}

async function savePointFromForm() {
  const data = {
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

  if (!data.pointNumber) {
    alert('Укажите номер точки');
    return;
  }

  showLoader('Сохранение...');
  try {
    let savedPoint;
    if (AppState.editingPointId) {
      savedPoint = await Points.update(AppState.editingPointId, data);
    } else {
      savedPoint = await Points.create(data);
    }

    // Загружаем фото если выбрано
    const photoFile = Photos.getFile('f-photo');
    if (photoFile && savedPoint && savedPoint.id) {
      showLoader('Загрузка фото...');
      try {
        await Photos.upload(photoFile, savedPoint.id);
      } catch (photoErr) {
        console.warn('[Photo upload]', photoErr.message);
        // Не блокируем — точка уже сохранена
      }
      Photos.clearInput('f-photo', 'f-photo-preview');
    }

    // Перечитываем с сервера
    await Points.load();
    renderPointsList();
    switchTab('points');
    Diagnostics.set('pointsLoaded', Points.getList().length);
  } catch (err) {
    Diagnostics.setError('sync', 'Сохранение: ' + err.message);
    alert('Ошибка сохранения: ' + err.message);
  }
  hideLoader();
}

async function confirmDelete(id) {
  const p = Points.getById(id);
  if (!p) return;
  if (!confirm('Удалить точку #' + p.pointNumber + '?')) return;
  showLoader('Удаление...');
  try {
    await Points.remove(id);
    await Points.load();
    renderPointsList();
    Diagnostics.set('pointsLoaded', Points.getList().length);
  } catch (err) {
    Diagnostics.setError('sync', 'Удаление: ' + err.message);
    alert('Ошибка удаления: ' + err.message);
  }
  hideLoader();
}

// ── GPS ──────────────────────────────────────────────────
function getGPS() {
  if (!navigator.geolocation) { alert('GPS не поддерживается'); return; }
  const btn = document.getElementById('btn-gps');
  if (btn) btn.textContent = '⏳ Определяем...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      setField('f-lat', pos.coords.latitude.toFixed(7));
      setField('f-lon', pos.coords.longitude.toFixed(7));
      if (btn) btn.textContent = '📍 GPS';
    },
    err => {
      alert('GPS ошибка: ' + err.message);
      if (btn) btn.textContent = '📍 GPS';
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

// ── Утилиты UI ────────────────────────────────────────────
function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value != null ? value : '';
}
function getField(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}
function parseFloatOrNull(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function initials(name) {
  return (name || '').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}
function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return iso; }
}
