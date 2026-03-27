/**
 * map.js — конвертер координат, отрисовка, взаимодействие с картой.
 *
 * Привязка схемы карьера (фиксированная):
 *   Верхний левый:  X=45850, Y=17350  → px=0,    py=0
 *   Верхний правый: X=47350, Y=17350  → px=imgW, py=0
 *   Нижний правый:  X=47350, Y=15800  → px=imgW, py=imgH
 *   Нижний левый:   X=45850, Y=15800  → px=0,    py=imgH
 *
 * Производственная логика отображения:
 *   Поле "X" в UI = значение yLocal из СК-42
 *   Поле "Y" в UI = значение xLocal из СК-42
 *   (т.е. X/Y поменяны местами для отображения пользователю)
 *
 * OFF_X = 5800000 (зона 6 СК-42)
 */

var MapModule = (function() {

  var OFF_X = 5800000;

  // Границы схемы в локальных координатах
  var BOUNDS = {
    xMin: 45850, xMax: 47350,  // xLocal (ось север-юг)
    yMin: 15800, yMax: 17350,  // yLocal (ось запад-восток)
  };

  var STATUS_COLORS = {
    'Новая':     '#1a73e8',
    'Активная':  '#34a853',
    'Иссякает':  '#f9ab00',
    'Пересохла': '#ea4335',
  };

  // ── WGS-84 → СК-42 (xLocal, yLocal) ────────────────────
  function wgs84ToSK42(lat, lon) {
    var a  = 6378245.0, b = 6356863.019;
    var e2 = (a*a - b*b) / (a*a);
    var latR = lat * Math.PI / 180;
    var lonR = lon * Math.PI / 180;
    var zone = Math.floor(lon / 6) + 1;
    var L0   = (zone * 6 - 3) * Math.PI / 180;
    var sinLat = Math.sin(latR), cosLat = Math.cos(latR), tanLat = Math.tan(latR);
    var eta2   = e2 * cosLat * cosLat / (1 - e2);
    var N      = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    var t      = tanLat * tanLat;
    var e4 = e2*e2, e6 = e4*e2;
    var dL = lonR - L0;
    var M = a * (
      (1 - e2/4 - 3*e4/64 - 5*e6/256)*latR
      - (3*e2/8 + 3*e4/32 + 45*e6/1024)*Math.sin(2*latR)
      + (15*e4/256 + 45*e6/1024)*Math.sin(4*latR)
      - (35*e6/3072)*Math.sin(6*latR)
    );
    var x = M + N*sinLat*cosLat*dL*dL/2
      + N*sinLat*Math.pow(cosLat,3)*(5-t+9*eta2+4*eta2*eta2)*Math.pow(dL,4)/24
      + N*sinLat*Math.pow(cosLat,5)*(61-58*t+t*t)*Math.pow(dL,6)/720;
    var y = N*cosLat*dL
      + N*Math.pow(cosLat,3)*(1-t+eta2)*Math.pow(dL,3)/6
      + N*Math.pow(cosLat,5)*(5-18*t+t*t+14*eta2-58*t*eta2)*Math.pow(dL,5)/120;
    y = y + zone*1000000 + 500000;
    return {
      x: parseFloat((x - OFF_X).toFixed(4)),
      y: parseFloat((y - zone*1000000 - 500000).toFixed(4)),
    };
  }

  // ── СК-42 → WGS-84 ──────────────────────────────────────
  function sk42ToWgs84(xLocal, yLocal) {
    var xFull = xLocal + OFF_X;
    var zone  = 6;
    var y0    = yLocal;
    var x0    = xFull;
    var a  = 6378245.0, b = 6356863.019;
    var e2 = (a*a - b*b) / (a*a);
    var lat = x0 / (a*(1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256));
    for (var i = 0; i < 6; i++) {
      var M = a*(
        (1-e2/4-3*e2*e2/64-5*e2*e2*e2/256)*lat
        -(3*e2/8+3*e2*e2/32+45*e2*e2*e2/1024)*Math.sin(2*lat)
        +(15*e2*e2/256+45*e2*e2*e2/1024)*Math.sin(4*lat)
        -(35*e2*e2*e2/3072)*Math.sin(6*lat)
      );
      lat = lat + (x0 - M)/(a*(1 - e2*Math.sin(lat)*Math.sin(lat)));
    }
    var sinLat = Math.sin(lat), cosLat = Math.cos(lat), tanLat = Math.tan(lat);
    var eta2   = e2*cosLat*cosLat/(1-e2);
    var N      = a/Math.sqrt(1-e2*sinLat*sinLat);
    var t      = tanLat*tanLat;
    var dL = y0/(N*cosLat)
      - Math.pow(y0,3)/(6*Math.pow(N,3)*cosLat)*(1+2*t+eta2)
      + Math.pow(y0,5)/(120*Math.pow(N,5)*cosLat)*(5+28*t+24*t*t);
    var L0 = (zone*6-3)*Math.PI/180;
    return {
      lat: parseFloat((lat * 180/Math.PI).toFixed(7)),
      lon: parseFloat(((L0+dL) * 180/Math.PI).toFixed(7)),
    };
  }

  // ── Локальные → пиксели ──────────────────────────────────
  // X (xLocal) растёт слева направо: 45850→47350
  // Y (yLocal) убывает сверху вниз:  17350→15800
  function toPixel(xLocal, yLocal, imgW, imgH) {
    var px = (xLocal - BOUNDS.xMin) / (BOUNDS.xMax - BOUNDS.xMin) * imgW;
    var py = (BOUNDS.yMax - yLocal) / (BOUNDS.yMax - BOUNDS.yMin) * imgH;
    return { px: px, py: py };
  }

  // ── Пиксели → локальные (обратное) ──────────────────────
  function pixelToLocal(px, py, imgW, imgH) {
    var xLocal = BOUNDS.xMin + (px / imgW) * (BOUNDS.xMax - BOUNDS.xMin);
    var yLocal = BOUNDS.yMax - (py / imgH) * (BOUNDS.yMax - BOUNDS.yMin);
    return {
      x: parseFloat(xLocal.toFixed(4)),
      y: parseFloat(yLocal.toFixed(4)),
    };
  }

  // ── Для отображения пользователю: X↔Y поменяны ──────────
  // displayX = yLocal (ось запад-восток, горизонтальная)
  // displayY = xLocal (ось север-юг, вертикальная)
  function toDisplay(xLocal, yLocal) {
    return {
      displayX: parseFloat(yLocal.toFixed(4)),
      displayY: parseFloat(xLocal.toFixed(4)),
    };
  }

  // Обратно: из полей формы (displayX, displayY) в xLocal/yLocal
  function fromDisplay(displayX, displayY) {
    return {
      xLocal: parseFloat(parseFloat(displayY).toFixed(4)),
      yLocal: parseFloat(parseFloat(displayX).toFixed(4)),
    };
  }

  // ── Отрисовка точек ──────────────────────────────────────
  function drawPoints(ctx, points, imgW, imgH) {
    for (var i = 0; i < points.length; i++) {
      var p  = points[i];
      var xL = p.xLocal, yL = p.yLocal;
      if ((xL == null || yL == null) && p.lat && p.lon) {
        var sk = wgs84ToSK42(p.lat, p.lon);
        xL = sk.x; yL = sk.y;
      }
      if (xL == null || yL == null) continue;
      if (xL < BOUNDS.xMin || xL > BOUNDS.xMax) continue;
      if (yL < BOUNDS.yMin || yL > BOUNDS.yMax) continue;
      var pos   = toPixel(xL, yL, imgW, imgH);
      var color = STATUS_COLORS[p.status] || '#666';
      var r     = 9;
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur  = 5;
      ctx.beginPath();
      ctx.arc(pos.px, pos.py, r, 0, Math.PI*2);
      ctx.fillStyle   = color;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur  = 0;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.fillStyle    = '#fff';
      ctx.font         = 'bold 9px sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.pointNumber || '?'), pos.px, pos.py);
    }
  }

  // ── Hit-test ─────────────────────────────────────────────
  function findPointAt(imgX, imgY, points, imgW, imgH) {
    var r = 14;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var xL = p.xLocal, yL = p.yLocal;
      if ((xL == null || yL == null) && p.lat && p.lon) {
        var sk = wgs84ToSK42(p.lat, p.lon);
        xL = sk.x; yL = sk.y;
      }
      if (xL == null || yL == null) continue;
      var pos = toPixel(xL, yL, imgW, imgH);
      var dx  = imgX - pos.px, dy = imgY - pos.py;
      if (Math.sqrt(dx*dx + dy*dy) <= r) return p;
    }
    return null;
  }

  return {
    BOUNDS: BOUNDS, STATUS_COLORS: STATUS_COLORS,
    wgs84ToSK42: wgs84ToSK42, sk42ToWgs84: sk42ToWgs84,
    toPixel: toPixel, pixelToLocal: pixelToLocal,
    toDisplay: toDisplay, fromDisplay: fromDisplay,
    drawPoints: drawPoints, findPointAt: findPointAt,
  };
})();
