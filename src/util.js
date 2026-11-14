/* Shared namespace, math helpers, procedural textures and ray intersections. */
window.G = window.G || {};

/* Bumped whenever the game changes, so a stale cached page is easy to spot: the
   badge in the corner of the HUD shows this number. */
G.BUILD = 7;

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

  // Asphalt tile: grain, tar seams, worn patches. Repeat is baked into the
  // mesh UVs (metres), so this must stay free of directional features.
  U.roadTexture = function () {
    var c = canvas(256, 256), x = c.getContext('2d');
    x.fillStyle = '#33333a'; x.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 2600; i++) {
      var v = 38 + Math.random() * 46;
      x.fillStyle = 'rgba(' + (v | 0) + ',' + (v | 0) + ',' + ((v + 5) | 0) + ',' + (0.25 + Math.random() * 0.4) + ')';
      x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // light grain so the surface is not flat grey
    for (var g = 0; g < 900; g++) {
      var w = 90 + Math.random() * 60 | 0;
      x.fillStyle = 'rgba(' + w + ',' + w + ',' + (w - 4) + ',' + (0.08 + Math.random() * 0.12) + ')';
      x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // worn / patched areas
    for (var p = 0; p < 9; p++) {
      var px = Math.random() * 256, py = Math.random() * 256, pr = 18 + Math.random() * 46;
      var grd = x.createRadialGradient(px, py, 2, px, py, pr);
      var dark = Math.random() < 0.5;
      grd.addColorStop(0, dark ? 'rgba(28,28,33,.5)' : 'rgba(72,72,78,.32)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = grd; x.beginPath(); x.arc(px, py, pr, 0, Math.PI * 2); x.fill();
    }
    // tar seams and hairline cracks
    x.lineWidth = 2;
    for (var s = 0; s < 7; s++) {
      x.strokeStyle = 'rgba(18,18,22,.55)';
      x.beginPath();
      var sx = Math.random() * 256, sy = Math.random() * 256;
      x.moveTo(sx, sy);
      for (var q = 0; q < 4; q++) x.lineTo(sx += (Math.random() - 0.5) * 90, sy += (Math.random() - 0.5) * 90);
      x.stroke();
    }
    x.lineWidth = 1;
    for (var k = 0; k < 14; k++) {
      x.strokeStyle = 'rgba(20,20,24,.4)';
      x.beginPath();
      var ax = Math.random() * 256, ay = Math.random() * 256;
      x.moveTo(ax, ay);
      for (var kk = 0; kk < 5; kk++) x.lineTo(ax += (Math.random() - 0.5) * 40, ay += (Math.random() - 0.5) * 40);
      x.stroke();
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };

  // Paving slabs for the sidewalks: 4x4 blocks of kerbstone-sized tiles.
  U.paveTexture = function () {
    var c = canvas(256, 256), x = c.getContext('2d');
    x.fillStyle = '#8f8d86'; x.fillRect(0, 0, 256, 256);
    var cell = 64, j = 3;
    for (var ry2 = 0; ry2 < 4; ry2++) {
      for (var rx2 = 0; rx2 < 4; rx2++) {
        var v = 138 + Math.random() * 32 | 0;
        x.fillStyle = 'rgb(' + v + ',' + (v - 1) + ',' + (v - 7) + ')';
        x.fillRect(rx2 * cell + j, ry2 * cell + j, cell - j * 2, cell - j * 2);
        x.fillStyle = 'rgba(64,62,58,.85)';                 // joints
        x.fillRect(rx2 * cell, ry2 * cell, cell, j);
        x.fillRect(rx2 * cell, ry2 * cell, j, cell);
        for (var sp = 0; sp < 90; sp++) {                    // stone speckle
          var sv = 110 + Math.random() * 90 | 0;
          x.fillStyle = 'rgba(' + sv + ',' + sv + ',' + (sv - 6) + ',.35)';
          x.fillRect(rx2 * cell + j + Math.random() * (cell - j * 2), ry2 * cell + j + Math.random() * (cell - j * 2), 1, 1);
        }
      }
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
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

  U.sandTexture = function () {
    var c = canvas(128, 128), x = c.getContext('2d');
    x.fillStyle = '#d9c79a'; x.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 2600; i++) {
      x.fillStyle = 'rgba(' + (200 + Math.random() * 45 | 0) + ',' + (185 + Math.random() * 40 | 0) + ',' + (140 + Math.random() * 45 | 0) + ',.55)';
      x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };

  // pale stone blocks for bank facades and kerb walls
  var stoneCache = {};
  U.stoneTexture = function () {
    if (stoneCache.t) return stoneCache.t;
    var c = canvas(128, 128), x = c.getContext('2d');
    x.fillStyle = '#cfc6b4'; x.fillRect(0, 0, 128, 128);
    for (var r = 0; r < 8; r++) {
      for (var q = 0; q < 4; q++) {
        var ox = (r % 2) * 16;
        x.fillStyle = 'rgba(' + (185 + Math.random() * 25 | 0) + ',' + (176 + Math.random() * 25 | 0) + ',' + (155 + Math.random() * 25 | 0) + ',.85)';
        x.fillRect(ox + q * 32, r * 16, 30, 14);
      }
    }
    x.strokeStyle = 'rgba(120,113,100,.5)'; x.lineWidth = 1;
    for (var i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(0, i * 16); x.lineTo(128, i * 16); x.stroke(); }
    stoneCache.t = new THREE.CanvasTexture(c);
    stoneCache.t.wrapS = stoneCache.t.wrapT = THREE.RepeatWrapping;
    return stoneCache.t;
  };

  // shop / bank signboard: a coloured plate with block letters
  var signCache = {};
  U.signTexture = function (text, bg, fg) {
    var key = text + '|' + bg + '|' + fg;
    if (signCache[key]) return signCache[key];
    var c = canvas(256, 64), x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 256, 64);
    x.strokeStyle = fg; x.lineWidth = 3; x.strokeRect(4, 4, 248, 56);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    var size = 34;
    do { x.font = 'bold ' + size + 'px sans-serif'; size -= 2; }
    while (size > 12 && x.measureText(text).width > 224);
    x.fillText(text, 128, 34);
    signCache[key] = new THREE.CanvasTexture(c);
    return signCache[key];
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

  // A face for the head sphere. Sphere UVs put the front of the head at u=0.25,
  // the chin at v=1 and the crown at v=0; texture flipY means v=1 lands on the
  // top row of the canvas, so everything below is written through fy().
  var faceCache = {};
  U.faceTexture = function (skin, hair) {
    var key = skin + '_' + hair;
    if (faceCache[key]) return faceCache[key];
    var s = 128, c = canvas(s, s), x = c.getContext('2d');
    function hex(v) { return '#' + ('000000' + v.toString(16)).slice(-6); }
    function fy(v) { return (1 - v) * s; }
    function shade(amount) {          // lighten/darken a packed hex colour
      var r = U.clamp(((skin >> 16) & 255) + amount, 0, 255);
      var g = U.clamp(((skin >> 8) & 255) + amount, 0, 255);
      var b = U.clamp((skin & 255) + amount, 0, 255);
      return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
    }
    x.fillStyle = hex(skin); x.fillRect(0, 0, s, s);
    // jaw and cheek shading, slightly darker toward the chin
    var grad = x.createLinearGradient(0, fy(0.85), 0, fy(0.5));
    grad.addColorStop(0, 'rgba(0,0,0,0.22)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = grad; x.fillRect(0, fy(0.85), s, fy(0.5) - fy(0.85));
    // hair: whole crown plus the back of the head
    x.fillStyle = hex(hair);
    x.fillRect(0, fy(0.34), s, s - fy(0.34));
    x.fillRect(s * 0.55, fy(0.60), s * 0.40, s - fy(0.60));
    x.fillRect(s * 0.05, fy(0.60), s * 0.10, s - fy(0.60));
    x.beginPath(); x.arc(s * 0.25, fy(0.34), s * 0.16, 0, Math.PI * 2); x.fill();  // fringe
    // ears
    x.fillStyle = shade(-14);
    [-0.115, 0.115].forEach(function (du) {
      x.beginPath(); x.ellipse(s * (0.25 + du), fy(0.55), s * 0.022, s * 0.042, 0, 0, Math.PI * 2); x.fill();
    });
    // eyebrows
    x.fillStyle = hex(hair);
    [-0.055, 0.055].forEach(function (du) {
      x.beginPath(); x.ellipse(s * (0.25 + du), fy(0.515), s * 0.040, s * 0.011, 0, 0, Math.PI * 2); x.fill();
    });
    // eyes
    [-0.055, 0.055].forEach(function (du) {
      x.fillStyle = '#f3efe9';
      x.beginPath(); x.ellipse(s * (0.25 + du), fy(0.55), s * 0.036, s * 0.024, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#3b2a1d';
      x.beginPath(); x.arc(s * (0.25 + du), fy(0.55), s * 0.017, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#120d09';
      x.beginPath(); x.arc(s * (0.25 + du), fy(0.55), s * 0.008, 0, Math.PI * 2); x.fill();
    });
    // nose and mouth
    x.fillStyle = 'rgba(0,0,0,0.16)';
    x.beginPath(); x.ellipse(s * 0.25, fy(0.605), s * 0.026, s * 0.030, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(90,45,40,0.75)';
    x.beginPath(); x.ellipse(s * 0.25, fy(0.665), s * 0.048, s * 0.013, 0, 0, Math.PI * 2); x.fill();
    var t = new THREE.CanvasTexture(c);
    faceCache[key] = t;
    return t;
  };

  // ---- geometry merging ----
  // Detail without draw calls: everything added to one builder comes out as a
  // single BufferGeometry, so it costs one mesh per material instead of one per
  // box. Inputs are baked into world/parent space by their matrix.
  var mergeGeo = {};   // shared unit shapes for the merge builder
  U.merge = function () {
    var pos = [], nor = [], uv = [];
    var _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
    var _e = new THREE.Euler(), _e2 = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
    var _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3();
    var api = {
      raw: function (geo, mtx, um, vm) {
        var g = geo.index ? geo.toNonIndexed() : geo;
        var p = g.attributes.position.array, n = g.attributes.normal.array;
        var t = g.attributes.uv ? g.attributes.uv.array : null;
        _m3.getNormalMatrix(mtx);
        for (var i = 0, k = 0; i < p.length; i += 3, k += 2) {
          _v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(mtx);
          pos.push(_v.x, _v.y, _v.z);
          _n.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(_m3).normalize();
          nor.push(_n.x, _n.y, _n.z);
          if (t) uv.push(t[k] * (um === undefined ? 1 : um), t[k + 1] * (vm === undefined ? 1 : vm)); else uv.push(0, 0);
        }
      },
      box: function (w, h, d, x, y, z, rx, ry, rz) {
        var q = _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0));
        var m = new THREE.Matrix4().compose(_v0.set(x || 0, y || 0, z || 0), q, _v1.set(w, h, d));
        api.raw(mergeGeo.__unitBox || (mergeGeo.__unitBox = new THREE.BoxGeometry(1, 1, 1)), m);
      },
      // flat rectangle lying in the XZ plane (roads, markings, decals)
      // tile = texture repeats per metre (UVs are baked in world units)
      plate: function (w, d, x, y, z, ry, tile) {
        var q = _q.setFromEuler(_e.set(Math.PI / 2, 0, 0));
        _q2.setFromEuler(_e2.set(0, ry || 0, 0)).multiply(q);
        var m = new THREE.Matrix4().compose(_v0.set(x || 0, y || 0, z || 0), _q2, _v1.set(w, d, 1));
        api.raw(mergeGeo.__unitPlane || (mergeGeo.__unitPlane = new THREE.PlaneGeometry(1, 1)), m,
          tile ? w * tile : undefined, tile ? d * tile : undefined);
      },
      // Box with facade UVs: every face tiles by its own size / (su,sv) in
      // metres. mask is six flags (+X -X +Y -Y +Z -Z); roofs pass the +Y face only.
      uvBox: function (w, h, d, x, y, z, su, sv, mask) {
        var hw = w / 2, hh = h / 2, hd = d / 2;
        var faces = [
          { n: [1, 0, 0], q: [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd]], u: d, v: h },
          { n: [-1, 0, 0], q: [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd]], u: d, v: h },
          { n: [0, 1, 0], q: [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd]], u: w, v: d },
          { n: [0, -1, 0], q: [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]], u: w, v: d },
          { n: [0, 0, 1], q: [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]], u: w, v: h },
          { n: [0, 0, -1], q: [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd]], u: w, v: h }
        ];
        var uq = [[0, 0], [1, 0], [1, 1], [0, 1]], idx = [0, 1, 2, 0, 2, 3];
        for (var f = 0; f < 6; f++) {
          if (mask && !mask[f]) continue;
          var face = faces[f], us = face.u / su, vs = face.v / sv;
          for (var k = 0; k < 6; k++) {
            var c = face.q[idx[k]], t = uq[idx[k]];
            pos.push(c[0] + (x || 0), c[1] + (y || 0), c[2] + (z || 0));
            nor.push(face.n[0], face.n[1], face.n[2]);
            uv.push(t[0] * us, t[1] * vs);
          }
        }
      },
      count: function () { return pos.length / 9; },
      build: function () {
        var g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        return g;
      }
    };
    return api;
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
