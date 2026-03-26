/**
 * map.js — отрисовка точек поверх схемы карьера.
 *
 * Координаты: GPS (lat/lon) → СК-42 (X/Y) → пиксели на canvas.
 *
 * Угловые точки схемы (фиксированные для данного карьера):
 *   X: 45850 — 47350  (локальные, без смещения OFF_X)
 *   Y: 15800 — 17350  (локальные, без смещения OFF_Y)
 *
 * Смещение СК-42: OFF_X = 5800000, OFF_Y = 0
 * Полные координаты СК-42: X_full = xLocal + OFF_X
 */

var MapModule = (function() {

  // ── Параметры карьера ─────────────────────────────────────
  var OFF_X = 5800000;  // смещение X для зоны 6 СК-42
  var OFF_Y = 0;

  // Локальные границы схемы (без смещения)
  var BOUNDS = {
    xMin: 45850, xMax: 47350,
    yMin: 15800, yMax: 17350,
  };

  // ── Цвета по статусу ─────────────────────────────────────
  var STATUS_COLORS = {
    'Новая':     '#1a73e8',  // синий
    'Активная':  '#34a853',  // зелёный
    'Иссякает':  '#f9ab00',  // жёлтый
    'Пересохла': '#ea4335',  // красный
  };

  // ── Конвертер WGS-84 → СК-42 ─────────────────────────────

  function wgs84ToSK42(lat, lon) {
    // Эллипсоид Красовского
    var a  = 6378245.0;
    var b  = 6356863.019;
    var e2 = (a * a - b * b) / (a * a);
    var n  = (a - b) / (a + b);

    var latR = lat * Math.PI / 180;
    var lonR = lon * Math.PI / 180;

    var zone = Math.floor(lon / 6) + 1;
    var L0   = (zone * 6 - 3) * Math.PI / 180;

    var sinLat  = Math.sin(latR);
    var cosLat  = Math.cos(latR);
    var tanLat  = Math.tan(latR);
    var eta2    = e2 * cosLat * cosLat / (1 - e2);

    var N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    var t = tanLat * tanLat;
    var dL = lonR - L0;

    // Длина дуги меридиана
    var e4 = e2 * e2;
    var e6 = e4 * e2;
    var M = a * (
      (1 - e2/4 - 3*e4/64 - 5*e6/256) * latR
      - (3*e2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*latR)
      + (15*e4/256 + 45*e6/1024) * Math.sin(4*latR)
      - (35*e6/3072) * Math.sin(6*latR)
    );

    var x = M + N * sinLat * cosLat * dL*dL/2
      + N * sinLat * cosLat*cosLat*cosLat * (5 - t + 9*eta2 + 4*eta2*eta2) * dL*dL*dL*dL/24
      + N * sinLat * Math.pow(cosLat,5) * (61 - 58*t + t*t) * Math.pow(dL,6)/720;

    var y = N * cosLat * dL
      + N * cosLat*cosLat*cosLat * (1 - t + eta2) * dL*dL*dL/6
      + N * Math.pow(cosLat,5) * (5 - 18*t + t*t + 14*eta2 - 58*t*eta2) * Math.pow(dL,5)/120;

    y = y + zone * 1000000 + 500000;

    // Убираем зональный номер и смещение 500000
    var yLocal = y - zone * 1000000 - 500000 + OFF_Y;
    var xLocal = x - OFF_X;

    return { x: Math.round(xLocal), y: Math.round(yLocal) };
  }

  // ── Координаты → пиксели ──────────────────────────────────

  function toPixel(xLocal, yLocal, imgW, imgH) {
    var px = (yLocal - BOUNDS.yMin) / (BOUNDS.yMax - BOUNDS.yMin) * imgW;
    var py = (1 - (xLocal - BOUNDS.xMin) / (BOUNDS.xMax - BOUNDS.xMin)) * imgH;
    return { px: px, py: py };
  }

  // ── Отрисовка точек ───────────────────────────────────────

  function drawPoints(ctx, points, imgW, imgH) {
    points.forEach(function(p) {
      // Нужны локальные координаты
      var xL = p.xLocal;
      var yL = p.yLocal;

      // Если нет — пробуем вычислить из GPS
      if ((xL == null || yL == null) && p.lat && p.lon) {
        var sk = wgs84ToSK42(p.lat, p.lon);
        xL = sk.x;
        yL = sk.y;
      }

      if (xL == null || yL == null) return;
      if (xL < BOUNDS.xMin || xL > BOUNDS.xMax) return;
      if (yL < BOUNDS.yMin || yL > BOUNDS.yMax) return;

      var pos   = toPixel(xL, yL, imgW, imgH);
      var color = STATUS_COLORS[p.status] || '#666666';
      var r     = 8;

      // Тень
      ctx.shadowColor   = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur    = 4;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      // Круг
      ctx.beginPath();
      ctx.arc(pos.px, pos.py, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur  = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 2;
      ctx.stroke();

      // Номер точки
      ctx.fillStyle   = '#ffffff';
      ctx.font        = 'bold 9px sans-serif';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.pointNumber || '?'), pos.px, pos.py);
    });
  }

  // ── Hit-test: нашли ли клик по точке ─────────────────────

  function findPointAt(clickX, clickY, points, imgW, imgH, scale, offsetX, offsetY) {
    var r = 12; // радиус захвата с запасом
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var xL = p.xLocal;
      var yL = p.yLocal;
      if ((xL == null || yL == null) && p.lat && p.lon) {
        var sk = wgs84ToSK42(p.lat, p.lon);
        xL = sk.x; yL = sk.y;
      }
      if (xL == null || yL == null) continue;
      var pos = toPixel(xL, yL, imgW, imgH);
      var cx  = pos.px * scale + offsetX;
      var cy  = pos.py * scale + offsetY;
      var dx  = clickX - cx;
      var dy  = clickY - cy;
      if (Math.sqrt(dx*dx + dy*dy) <= r) return p;
    }
    return null;
  }

  // ── Пиксели → локальные координаты (обратное) ──────────
  function pixelToLocal(px, py, imgW, imgH) {
    var xLocal = BOUNDS.xMin + (1 - py / imgH) * (BOUNDS.xMax - BOUNDS.xMin);
    var yLocal = BOUNDS.yMin + (px / imgW)     * (BOUNDS.yMax - BOUNDS.yMin);
    return { x: Math.round(xLocal), y: Math.round(yLocal) };
  }

  // ── СК-42 → WGS-84 (приближённый обратный конвертер) ────
  function sk42ToWgs84(xLocal, yLocal) {
    // Восстанавливаем полные координаты СК-42
    var xFull = xLocal + OFF_X;
    var yFull = yLocal + OFF_Y;

    // Зона (для данного карьера — зона 6, lon ~69°)
    var zone = 6;
    var y0   = yFull - zone * 1000000 - 500000;
    var x0   = xFull;

    // Эллипсоид Красовского
    var a  = 6378245.0;
    var b  = 6356863.019;
    var e2 = (a*a - b*b) / (a*a);

    // Итерационное вычисление широты из длины меридиана
    var lat = x0 / (a * (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256));
    for (var i = 0; i < 5; i++) {
      var sinL = Math.sin(lat);
      var M = a * (
        (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * lat
        - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*lat)
        + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*lat)
        - (35*e2*e2*e2/3072) * Math.sin(6*lat)
      );
      lat = lat + (x0 - M) / (a * (1 - e2));
    }

    var sinLat  = Math.sin(lat);
    var cosLat  = Math.cos(lat);
    var tanLat  = Math.tan(lat);
    var eta2    = e2 * cosLat * cosLat / (1 - e2);
    var N       = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    var t       = tanLat * tanLat;

    var dL = y0 / (N * cosLat)
      - y0*y0*y0 / (6 * N*N*N * cosLat) * (1 + 2*t + eta2)
      + Math.pow(y0, 5) / (120 * Math.pow(N, 5) * cosLat) * (5 + 28*t + 24*t*t);

    var L0  = (zone * 6 - 3) * Math.PI / 180;
    var lon = (L0 + dL) * 180 / Math.PI;
    var latDeg = lat * 180 / Math.PI;

    return { lat: latDeg, lon: lon };
  }

  return {
    wgs84ToSK42:   wgs84ToSK42,
    sk42ToWgs84:   sk42ToWgs84,
    toPixel:       toPixel,
    pixelToLocal:  pixelToLocal,
    drawPoints:    drawPoints,
    findPointAt:   findPointAt,
    BOUNDS:        BOUNDS,
    STATUS_COLORS: STATUS_COLORS,
  };
})();
