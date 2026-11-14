/* Pooled visual effects: particles, bullet tracers, muzzle flashes, explosions, smoke. */
(function (G) {
  'use strict';
  var U = G.util;
  var fx = G.fx = { particles: [], tracers: [], lights: [], enabled: true };

  var scene, texCache = {};

  function tex(color) {
    if (!texCache[color]) texCache[color] = U.glowTexture(color);
    return texCache[color];
  }

  // ---- particles: sprites with velocity, gravity, fade and optional growth ----
  var MAX = 420;
  for (var i = 0; i < MAX; i++) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.visible = false; fx.particles.push(s);
  }
  var pHead = 0;

  fx.init = function (sc) {
    scene = sc;
    for (var i = 0; i < fx.particles.length; i++) if (!fx.particles[i].parent) scene.add(fx.particles[i]);
  };

  function pTex(name) { return tex(name); }

  fx.emit = function (o) {
    var n = o.count === undefined ? 1 : o.count;
    for (var i = 0; i < n; i++) {
      var p = fx.particles[pHead = (pHead + 1) % MAX];
      p.userData = {
        vx: U.rand(-1, 1) * (o.spread || 0) + (o.vx || 0),
        vy: (o.vy || 0) + U.rand(0, 1) * (o.spread || 0) * 0.6,
        vz: U.rand(-1, 1) * (o.spread || 0) + (o.vz || 0),
        life: o.life || 0.6, max: o.life || 0.6,
        g: o.gravity === undefined ? 9 : o.gravity,
        drag: o.drag === undefined ? 1.6 : o.drag,
        grow: o.grow || 0, size: o.size || 0.5, opacity: o.opacity === undefined ? 1 : o.opacity
      };
      p.position.set(o.x + U.rand(-1, 1) * (o.jitter || 0), o.y + U.rand(-1, 1) * (o.jitter || 0), o.z + U.rand(-1, 1) * (o.jitter || 0));
      p.material.map = pTex(o.color || 'rgba(255,180,80,1)');
      p.material.blending = o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
      p.material.color.set(o.tint === undefined ? 0xffffff : o.tint);
      p.scale.setScalar(o.size || 0.5);
      p.material.opacity = p.userData.opacity;
      p.visible = true;
    }
  };

  // ---- tracers: thin additive lines that vanish in ~70ms ----
  var tracerPool = [];
  for (var t = 0; t < 40; t++) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    var line = new THREE.Line(g, new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.visible = false; line.frustumCulled = false;
    fx.tracers.push(line);
  }
  fx.tracer = function (a, b, color, width) {
    var line = null;
    for (var i = 0; i < fx.tracers.length; i++) if (!fx.tracers[i].visible) { line = fx.tracers[i]; break; }
    if (!line) return;
    var pos = line.geometry.attributes.position;
    pos.array[0] = a.x; pos.array[1] = a.y; pos.array[2] = a.z;
    pos.array[3] = b.x; pos.array[4] = b.y; pos.array[5] = b.z;
    pos.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    line.material.color.set(color || 0xfff0b0);
    line.material.opacity = 0.9;
    line.visible = true;
    line.userData.life = 0.07;
  };

  // ---- transient point lights (muzzle flashes, explosions, cop siren wash) ----
  function getLight() {
    var l = null;
    for (var i = 0; i < fx.lights.length; i++) if (fx.lights[i].userData.life <= 0) { l = fx.lights[i]; break; }
    if (!l && fx.lights.length < 14) {
      l = new THREE.PointLight(0xffffff, 0, 30, 2);
      fx.lights.push(l); scene.add(l);
    }
    return l;
  }
  fx.flash = function (x, y, z, color, intensity, dist, life) {
    var l = getLight(); if (!l) return;
    l.position.set(x, y, z);
    l.color.set(color || 0xffdd88);
    l.intensity = intensity || 6;
    l.distance = dist || 22;
    l.userData.life = life || 0.07;
    l.userData.max = l.userData.life;
    l.userData.peak = l.intensity;
  };

  fx.muzzle = function (x, y, z, dir) {
    fx.flash(x, y, z, 0xffd070, 9, 26, 0.06);
    fx.emit({ x: x + dir.x * 0.5, y: y, z: z + dir.z * 0.5, color: 'rgba(255,220,140,1)', size: 0.9, life: 0.07, count: 3, spread: 1.6, gravity: 0 });
  };

  fx.impact = function (x, y, z, color, count) {
    fx.emit({ x: x, y: y, z: z, color: color || 'rgba(255,235,190,1)', size: 0.22, life: 0.28, count: count || 6, spread: 5, gravity: 12, jitter: 0.05 });
    fx.flash(x, y, z, 0xffe0a0, 2.2, 8, 0.05);
  };

  fx.blood = function (x, y, z, dirX, dirZ) {
    fx.emit({
      x: x, y: y, z: z, color: 'rgba(190,20,25,1)', tint: 0xdd2222, additive: false,
      size: 0.3, life: 0.5, count: 9, spread: 4, vx: dirX * 5, vz: dirZ * 5, gravity: 14, jitter: 0.12
    });
  };

  fx.smoke = function (x, y, z, size, life) {
    fx.emit({ x: x, y: y, z: z, color: 'rgba(120,120,125,1)', tint: 0x555555, additive: false,
      size: size || 1.4, life: life || 1.6, count: 2, spread: 0.6, vy: 1.6, gravity: -0.6, grow: 2.2, opacity: 0.55, jitter: 0.3 });
  };

  fx.explosion = function (x, y, z) {
    fx.flash(x, y, z, 0xffa030, 60, 60, 0.35);
    fx.emit({ x: x, y: y, z: z, color: 'rgba(255,180,60,1)', size: 2.6, life: 0.45, count: 16, spread: 14, gravity: 4, grow: 2 });
    fx.emit({ x: x, y: y, z: z, color: 'rgba(60,60,65,1)', tint: 0x333333, additive: false, size: 3, life: 2.4, count: 10, spread: 5, vy: 3, gravity: -0.5, grow: 3, opacity: 0.6 });
    for (var i = 0; i < 12; i++) {
      fx.emit({ x: x, y: y + 0.4, z: z, color: 'rgba(255,120,40,1)', size: 0.4, life: 0.9, count: 1, spread: 22, vy: 6, gravity: 16, jitter: 0.4 });
    }
  };

  fx.update = function (dt) {
    for (var i = 0; i < fx.particles.length; i++) {
      var p = fx.particles[i];
      if (!p.visible) continue;
      var d = p.userData;
      d.life -= dt;
      if (d.life <= 0) { p.visible = false; continue; }
      var k = Math.exp(-d.drag * dt);
      d.vx *= k; d.vz *= k; d.vy -= d.g * dt;
      p.position.x += d.vx * dt; p.position.y += d.vy * dt; p.position.z += d.vz * dt;
      if (p.position.y < 0.05) { p.position.y = 0.05; d.vy = Math.abs(d.vy) * 0.25; }
      var f = d.life / d.max;
      p.material.opacity = d.opacity * f;
      p.scale.setScalar(d.size * (1 + d.grow * (1 - f)));
    }
    for (var j = 0; j < fx.tracers.length; j++) {
      var l = fx.tracers[j];
      if (!l.visible) continue;
      l.userData.life -= dt;
      l.material.opacity = Math.max(0, l.userData.life / 0.07) * 0.9;
      if (l.userData.life <= 0) l.visible = false;
    }
    for (var m = 0; m < fx.lights.length; m++) {
      var li = fx.lights[m];
      if (li.userData.life > 0) {
        li.userData.life -= dt;
        li.intensity = li.userData.peak * Math.max(0, li.userData.life / li.userData.max);
      } else if (li.intensity !== 0) li.intensity = 0;
    }
  };

})(window.G);
