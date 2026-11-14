/* Shared namespace, math helpers, procedural textures and ray intersections. */
window.G = window.G || {};

(function (G) {
  'use strict';

  // ---- error surface: anything thrown ends up on screen instead of a silent black canvas
  G.errors = [];
  window.addEventListener('error', function (e) {
    G.errors.push((e.message || 'error') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0));
    var el = document.getElementById('err');
    if (el) { el.style.display = 'block'; el.textContent = G.errors.join('\n'); }
  });

  var U = G.util = {};

  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  // frame-rate independent smoothing ("damp" from Game Programming Gems)
  U.damp = function (a, b, lambda, dt) { return U.lerp(a, b, 1 - Math.exp(-lambda * dt)); };
  U.sign = function (v) { return v < 0 ? -1 : v > 0 ? 1 : 0; };
  U.dist2 = function (ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); };

  U.angleDiff = function (a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
  U.turnToward = function (cur, target, maxStep) {
    var d = U.angleDiff(cur, target);
    return cur + U.clamp(d, -maxStep, maxStep);
  };

  // deterministic RNG so the city layout is stable between reloads
  U.mulberry = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  var rng = U.rng = U.mulberry(0xC0FFEE);
  U.rand = function (a, b) { return a + rng() * (b - a); };
  U.randInt = function (a, b) { return Math.floor(a + rng() * (b - a + 1)); };
  U.pick = function (arr) { return arr[Math.floor(rng() * arr.length)]; };

  U.v1 = new THREE.Vector3();
  U.v2 = new THREE.Vector3();
  U.v3 = new THREE.Vector3();
  U.v4 = new THREE.Vector3();

  // ---- procedural canvas textures (keeps the project asset-free / offline) ----
  function canvas(w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  U.noiseTexture = function (size, base, spread, repeats) {
    var c = canvas(size, size), x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, size, size);
    var img = x.getImageData(0, 0, size, size), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var n = (Math.random() - 0.5) * spread;
      d[i] = U.clamp(d[i] + n, 0, 255);
      d[i + 1] = U.clamp(d[i + 1] + n, 0, 255);
      d[i + 2] = U.clamp(d[i + 2] + n, 0, 255);
    }
    x.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeats || 1, repeats || 1);
    return t;
  };

  // facade with lit windows; a second canvas holds the emissive mask used at night
  U.buildingTextures = function (uRepeat, vRepeat) {
    var W = 256, H = 256, cols = Math.round(uRepeat), rows = Math.round(vRepeat);
    var c = canvas(W, H), x = c.getContext('2d');
    var e = canvas(W, H), ex = e.getContext('2d');
    x.fillStyle = '#00000000'; ex.fillStyle = '#000'; x.clearRect(0, 0, W, H); ex.fillRect(0, 0, W, H);
    var cw = W / cols, ch = H / rows;
    for (var j = 0; j < rows; j++) {
      for (var i = 0; i < cols; i++) {
        var px = i * cw, py = j * ch;
        var pad = cw * 0.18;
        var lit = Math.random() < 0.55;
        var g = 30 + Math.random() * 40;
        x.fillStyle = 'rgb(' + (g * 0.7 | 0) + ',' + (g * 0.85 | 0) + ',' + (g | 0) + ')';
        x.fillRect(px + pad, py + ch * 0.22, cw - pad * 2, ch * 0.56);
        if (lit) {
          var warm = Math.random() < 0.7;
          var col = warm ? 'rgb(255,' + (200 + Math.random() * 40 | 0) + ',140)' : 'rgb(170,215,255)';
          ex.fillStyle = col;
          ex.fillRect(px + pad, py + ch * 0.22, cw - pad * 2, ch * 0.56);
        }
      }
    }
    var map = new THREE.CanvasTexture(c), emis = new THREE.CanvasTexture(e);
    map.wrapS = map.wrapT = emis.wrapS = emis.wrapT = THREE.RepeatWrapping;
    return { map: map, emissive: emis };
  };

  U.roadTexture = function () {
    var c = canvas(128, 256), x = c.getContext('2d');
    x.fillStyle = '#2b2b30'; x.fillRect(0, 0, 128, 256);
    for (var i = 0; i < 4000; i++) {
      var v = 40 + Math.random() * 80;
      x.fillStyle = 'rgba(' + (v | 0) + ',' + (v | 0) + ',' + ((v + 4) | 0) + ',.5)';
      x.fillRect(Math.random() * 128, Math.random() * 256, 2, 2);
    }
    // dashed centre line (runs along V)
    x.fillStyle = '#e8c34a';
    for (var y = 0; y < 256; y += 64) x.fillRect(62, y, 4, 34);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };

  U.grassTexture = function () {
    var c = canvas(128, 128), x = c.getContext('2d');
    x.fillStyle = '#3f5b34'; x.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 3000; i++) {
      x.fillStyle = 'rgba(' + (40 + Math.random() * 60 | 0) + ',' + (80 + Math.random() * 70 | 0) + ',' + (40 + Math.random() * 40 | 0) + ',.6)';
      x.fillRect(Math.random() * 128, Math.random() * 128, 2, 3);
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };

  // radial glow sprite used for muzzle flashes, tracers and fires
  U.glowTexture = function (color) {
    var s = 64, c = canvas(s, s), x = c.getContext('2d');
    var g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, color); g.addColorStop(0.4, color.replace('1)', '0.55)'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  };

  // ---- geometry queries ----
  // Ray vs axis-aligned box (slab method). dir need not be normalised.
  U.rayAABB = function (ox, oy, oz, dx, dy, dz, b) {
    var tmin = -Infinity, tmax = Infinity, t1, t2, inv;
    inv = 1 / (dx || 1e-9); t1 = (b.minX - ox) * inv; t2 = (b.maxX - ox) * inv;
    if (t1 > t2) { var s = t1; t1 = t2; t2 = s; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    inv = 1 / (dy || 1e-9); t1 = (b.minY - oy) * inv; t2 = (b.maxY - oy) * inv;
    if (t1 > t2) { s = t1; t1 = t2; t2 = s; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    inv = 1 / (dz || 1e-9); t1 = (b.minZ - oz) * inv; t2 = (b.maxZ - oz) * inv;
    if (t1 > t2) { s = t1; t1 = t2; t2 = s; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    return (tmax >= Math.max(tmin, 0)) ? (tmin > 0 ? tmin : 0) : Infinity;
  };

  // Ray vs upright cylinder (people are cylinders: cheap + good enough for gunfire).
  U.rayCylinder = function (ox, oy, oz, dx, dy, dz, cx, cz, r, yMin, yMax) {
    var mx = ox - cx, mz = oz - cz;
    var a = dx * dx + dz * dz;
    if (a < 1e-8) { return Infinity; }
    var b = 2 * (mx * dx + mz * dz);
    var c = mx * mx + mz * mz - r * r;
    var disc = b * b - 4 * a * c;
    if (disc < 0) return Infinity;
    disc = Math.sqrt(disc);
    var ts = [(-b - disc) / (2 * a), (-b + disc) / (2 * a)];
    for (var i = 0; i < 2; i++) {
      var t = ts[i];
      if (t < 0) continue;
      var y = oy + dy * t;
      if (y >= yMin && y <= yMax) return t;
    }
    return Infinity;
  };

  // Ray vs oriented box: rotate the ray into box space, then reuse rayAABB.
  var _q = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  U.rayOBB = function (ox, oy, oz, dx, dy, dz, cx, cy, cz, yaw, hx, hy, hz) {
    var cs = Math.cos(-yaw), sn = Math.sin(-yaw);
    var px = ox - cx, pz = oz - cz;
    var rx = px * cs - pz * sn, rz = px * sn + pz * cs;
    var rdx = dx * cs - dz * sn, rdz = dx * sn + dz * cs;
    _q.minX = -hx; _q.maxX = hx; _q.minY = -hy; _q.maxY = hy; _q.minZ = -hz; _q.maxZ = hz;
    var t = U.rayAABB(rx, oy - cy, rz, rdx, dy, rdz, _q);
    _q.minY = -999; _q.maxY = 999;
    return t;
  };

  // Push a circle out of a list of axis-aligned boxes; returns {x,z,hit}
  U.resolveCircleAABB = function (x, z, r, boxes, out) {
    out = out || { x: 0, z: 0, hit: false };
    out.x = x; out.z = z; out.hit = false;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var cx = U.clamp(out.x, b.minX, b.maxX), cz = U.clamp(out.z, b.minZ, b.maxZ);
      var dx = out.x - cx, dz = out.z - cz;
      var d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      if (d2 > 1e-9) {
        var d = Math.sqrt(d2), push = r - d;
        out.x += (dx / d) * push; out.z += (dz / d) * push;
      } else { // centre inside the box: eject along the shallowest axis
        var l = out.x - b.minX, rr = b.maxX - out.x, u = out.z - b.minZ, dn = b.maxZ - out.z;
        var m = Math.min(l, rr, u, dn);
        if (m === l) out.x = b.minX - r; else if (m === rr) out.x = b.maxX + r;
        else if (m === u) out.z = b.minZ - r; else out.z = b.maxZ + r;
      }
      out.hit = true;
    }
    return out;
  };

})(window.G);
