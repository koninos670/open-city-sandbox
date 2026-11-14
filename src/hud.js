/* HUD: vitals, weapon, wanted stars, minimap, clock, toasts. */
(function (G) {
  'use strict';
  var U = G.util;
  var H = G.hud = {};
  var el = {}, mm, mmCtx, stars = [], starOn = -1, hurtT = 0, flashT = 0, vignette, blink = 0;

  var STAR_PATH = 'M12 1.6l3.1 6.6 7.2 1-5.2 5 1.3 7.15L12 17.9l-6.4 3.45L6.9 14.2l-5.2-5 7.2-1z';

  H.init = function () {
    ['hpFill', 'armorFill', 'mag', 'reserve', 'wName', 'kmh', 'gear', 'speedo', 'clock',
      'cash', 'district', 'toast', 'objective', 'stars', 'crosshair', 'err'].forEach(function (id) {
        el[id] = document.getElementById(id);
      });
    mm = document.getElementById('minimap');
    mmCtx = mm.getContext('2d');

    el.stars.innerHTML = '';
    for (var i = 0; i < 5; i++) {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'star');
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', STAR_PATH);
      p.setAttribute('fill', '#ffd24d');
      p.setAttribute('stroke', '#7a4a00');
      p.setAttribute('stroke-width', '1.2');
      svg.appendChild(p);
      el.stars.appendChild(svg);
      stars.push(svg);
    }

    vignette = document.createElement('div');
    vignette.style.cssText = 'position:fixed;inset:0;z-index:12;pointer-events:none;opacity:0;' +
      'background:radial-gradient(circle,rgba(255,0,0,0) 40%,rgba(160,0,0,.75) 100%);transition:opacity .25s';
    document.body.appendChild(vignette);

    var big = document.createElement('div');
    big.id = 'bigmsg';
    big.style.cssText = 'position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;' +
      'pointer-events:none;font-size:9vw;font-weight:900;letter-spacing:.06em;opacity:0;transition:opacity .4s;' +
      'font-family:Impact,"Arial Black",sans-serif;-webkit-text-stroke:3px rgba(0,0,0,.7)';
    document.body.appendChild(big);
    el.bigmsg = big;
  };

  H.setStars = function (n) {
    if (n === starOn) return;
    starOn = n;
    for (var i = 0; i < stars.length; i++) stars[i].classList.toggle('on', i < n);
    if (n >= 4) G.hud.toast(n >= 5 ? 'MOST WANTED' : 'POLICE RESPONSE ESCALATING');
    else if (n === 1) G.hud.toast('WANTED');
  };

  H.update = function (p, dt) {
    el.hpFill.style.width = U.clamp(p.hp, 0, 100) + '%';
    el.armorFill.style.width = U.clamp(p.armor, 0, 100) + '%';
    el.cash.textContent = '$' + p.cash.toLocaleString();
    el.district.textContent = p.district || '';

    var W = p.weapon && G.player.WEAPONS[p.weapon];
    if (W && p.owned && p.owned[p.weapon]) {
      var a = p.ammo[p.weapon] || { mag: 0, reserve: 0 };
      el.wName.textContent = p.reloading > 0 ? 'RELOADING' : W.name;
      el.mag.textContent = a.mag;
      el.reserve.textContent = a.reserve;
    } else {
      el.wName.textContent = 'UNARMED';
      el.mag.textContent = '0'; el.reserve.textContent = '0';
    }

    el.speedo.hidden = p.onFoot;
    if (!p.onFoot) {
      el.kmh.textContent = Math.round(p.speedKmh || 0);
      el.gear.textContent = (p.vf || 0) < -0.5 ? 'R' : Math.abs(p.vf || 0) < 0.4 ? 'P' : 'D';
    }
    el.crosshair.style.opacity = p.aim ? 1 : (p.onFoot ? 0.8 : 0.25);

    if (hurtT > 0) { hurtT -= dt; if (hurtT <= 0) vignette.style.opacity = 0; }
    if (flashT > 0) {
      flashT -= dt;
      if (flashT <= 0) el.mag.parentElement.style.color = '';
    }
    if (blink > 0) {
      blink -= dt;
      el.objective.style.opacity = blink > 0 && Math.floor(blink * 6) % 2 ? 0.35 : 0.9;
    }
  };

  H.prompt = function (text) {
    if (text) { el.objective.innerHTML = text; blink = 0.4; }   // prompts carry &middot; separators
    else el.objective.textContent = '';
  };

  H.hurt = function () { hurtT = 0.5; vignette.style.opacity = 0.85; };
  H.flashAmmo = function () { flashT = 0.12; el.mag.parentElement.style.color = '#ffe36e'; };

  var toastT = 0;
  H.toast = function (text) {
    el.toast.innerHTML = '<b class="flash">' + text + '</b>';
    toastT = 2.6;
  };

  var bigT = 0;
  H.bigMessage = function (text, color) {
    if (!text) { el.bigmsg.style.opacity = 0; bigT = 0; return; }
    el.bigmsg.textContent = text;
    el.bigmsg.style.color = color || '#fff';
    el.bigmsg.style.opacity = 1;
    bigT = 2.6;
  };

  H.tick = function (dt) {
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.innerHTML = ''; }
    if (bigT > 0) { bigT -= dt; if (bigT <= 0) el.bigmsg.style.opacity = 0; }
  };

  H.setClock = function (t) {
    var h = Math.floor(t) % 24, m = Math.floor((t % 1) * 60);
    el.clock.textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  };

  // ------------------------------------------------------------------ minimap
  var VIEW = 118;                                     // metres visible from the centre
  H.drawMinimap = function (player, ents, wanted) {
    if (!mmCtx) return;
    var W = mm.width, R = W / 2;
    var scale = R / VIEW;
    var px = player.x, pz = player.z;
    var c = mmCtx;
    c.save();
    c.clearRect(0, 0, W, W);
    c.beginPath(); c.arc(R, R, R, 0, 6.2832); c.clip();
    c.fillStyle = '#1b2129'; c.fillRect(0, 0, W, W);

    function sx(x) { return R + (x - px) * scale; }
    function sy(z) { return R + (z - pz) * scale; }

    // blocks: everything is asphalt, so paint the sidewalk squares on top
    c.fillStyle = '#242c36';
    var B = G.city.BLOCK, H2 = G.city.HALF;
    function rw(k) { return G.city.roadW ? G.city.roadW(k) : G.city.ROAD; }
    var i0 = Math.max(-1, Math.floor((px - VIEW + H2) / B) - 1), i1 = Math.min(G.city.GRID, Math.ceil((px + VIEW + H2) / B) + 1);
    var j0 = Math.max(-1, Math.floor((pz - VIEW + H2) / B) - 1), j1 = Math.min(G.city.GRID, Math.ceil((pz + VIEW + H2) / B) + 1);
    for (var i = i0; i <= i1; i++) {
      for (var j = j0; j <= j1; j++) {
        var x0 = -H2 + i * B + rw(i) / 2, z0 = -H2 + j * B + rw(j) / 2;
        var x1 = -H2 + (i + 1) * B - rw(i + 1) / 2, z1 = -H2 + (j + 1) * B - rw(j + 1) / 2;
        c.fillRect(sx(x0), sy(z0), (x1 - x0) * scale, (z1 - z0) * scale);
      }
    }
    // road markings
    c.strokeStyle = 'rgba(255,235,150,.30)'; c.lineWidth = 2; c.setLineDash([7, 9]);
    for (var r = 0; r <= G.city.GRID; r++) {
      var v = -H2 + r * B;
      c.beginPath(); c.moveTo(sx(v), sy(-H2)); c.lineTo(sx(v), sy(H2)); c.stroke();
      c.beginPath(); c.moveTo(sx(-H2), sy(v)); c.lineTo(sx(H2), sy(v)); c.stroke();
    }
    c.setLineDash([]);

    // robbery targets: gold, fading once cleaned out
    if (G.heists && G.heists.targets) {
      for (var hi = 0; hi < G.heists.targets.length; hi++) {
        var tg = G.heists.targets[hi];
        var tgx = sx(tg.x), tgz = sy(tg.z);
        if (tgx < -20 || tgz < -20 || tgx > W + 20 || tgz > W + 20) continue;
        c.fillStyle = tg.robbed ? 'rgba(140,120,60,.45)' : '#ffd447';
        c.beginPath(); c.arc(tgx, tgz, 4.5, 0, 6.2832); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.75)'; c.lineWidth = 1.2; c.stroke();
      }
    }
    // your house and the active waypoint: drawn even when they are off the map,
    // slid to the rim and turned into a pointer
    function pin(x, z, colour, kind) {
      var dx = (x - px) * scale, dz = (z - pz) * scale;
      var d = Math.hypot(dx, dz), lim = R - 13, edge = d > lim;
      if (edge && d > 0) { dx *= lim / d; dz *= lim / d; }
      c.save();
      c.translate(R + dx, R + dz);
      if (edge) c.rotate(Math.atan2(dz, dx) + Math.PI / 2);
      c.fillStyle = colour; c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 1.4;
      if (kind === 'wp') {
        c.beginPath(); c.moveTo(0, -9); c.lineTo(9, 0); c.lineTo(0, 9); c.lineTo(-9, 0); c.closePath();
        c.fill(); c.stroke();
      } else {
        c.fillRect(-5, -5, 10, 10); c.strokeRect(-5, -5, 10, 10);
      }
      c.restore();
    }
    if (G.city.home) pin(G.city.home.x, G.city.home.z, '#63e08a', 'home');
    if (G.waypoint) pin(G.waypoint.x, G.waypoint.z, '#ffd447', 'wp');

    // pickups
    c.fillStyle = '#6cf07a';
    for (var pk = 0; pk < ents.pickups.length; pk++) {
      var P2 = ents.pickups[pk];
      if (P2.taken) continue;
      c.fillRect(sx(P2.x) - 3, sy(P2.z) - 3, 6, 6);
    }
    // traffic
    c.fillStyle = '#9aa7b4';
    for (var ci = 0; ci < ents.cars.length; ci++) {
      var car = ents.cars[ci];
      if (!car.alive) continue;
      if (car.driver === 'police') continue;
      c.fillRect(sx(car.x) - 2.5, sy(car.z) - 4, 5, 8);
    }
    // pedestrians
    c.fillStyle = 'rgba(235,225,205,.55)';
    for (var pi = 0; pi < ents.peds.length; pi++) {
      var pd = ents.peds[pi];
      if (!pd.alive) continue;
      c.fillRect(sx(pd.x) - 1.5, sy(pd.z) - 1.5, 3, 3);
    }
    // police
    for (var oi = 0; oi < ents.cops.length; oi++) {
      var cop = ents.cops[oi];
      if (!cop.alive) continue;
      c.fillStyle = '#4d8dff';
      c.beginPath(); c.arc(sx(cop.x), sy(cop.z), 4, 0, 6.2832); c.fill();
    }
    for (var q = 0; q < ents.cars.length; q++) {
      var pc = ents.cars[q];
      if (pc.driver !== 'police' || !pc.alive) continue;
      c.fillStyle = '#6fa8ff';
      c.fillRect(sx(pc.x) - 3, sy(pc.z) - 5, 6, 10);
      c.strokeStyle = '#fff'; c.lineWidth = 1;
      c.strokeRect(sx(pc.x) - 3, sy(pc.z) - 5, 6, 10);
    }

    // the player
    c.save();
    c.translate(R, R);
    c.rotate(Math.PI - player.yaw);
    c.beginPath();
    c.moveTo(0, -9); c.lineTo(6, 8); c.lineTo(0, 4); c.lineTo(-6, 8); c.closePath();
    c.fillStyle = player.onFoot ? '#ffffff' : '#ffe36e';
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 1.5; c.stroke();
    c.restore();
    c.restore();

    // ring + wanted tint
    c.beginPath(); c.arc(R, R, R - 2, 0, 6.2832);
    c.strokeStyle = wanted > 0 ? 'rgba(255,90,90,.9)' : 'rgba(255,255,255,.35)';
    c.lineWidth = 3; c.stroke();
  };

})(window.G);
