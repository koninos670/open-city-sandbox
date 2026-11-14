/* Wanted level 1-5, police response: patrol units, squad cars, arrest, helicopter. */
(function (G) {
  'use strict';
  var U = G.util, M = G.models, E = G.entities, fx = G.fx;
  var W = G.wanted = { level: 0, heat: 0, stars: 0, time: 0, agitated: 0, lastCrime: -99 };
  var scene, player;

  var HEAT = { gunshot: 0.35, assault: 1.0, ped: 1.7, car: 0.7, carjack: 1.0, cop: 3.0, 'cop-hit': 1.4 };
  var COPS_PER_LEVEL = [0, 3, 4, 6, 8, 10];
  var CARS_PER_LEVEL = [0, 0, 1, 1, 2, 3];
  // heat -> stars: a little dead zone so one crime is already worth a star
  function levelOf(heat) {
    var f = Math.floor(heat);
    return U.clamp(f + (heat - f > 0.25 ? 1 : 0), 0, 5);
  }

  W.init = function (sc, pl) { scene = sc; player = pl; };

  W.crime = function (type, x, z, heatAdd) {
    if (player.dead || !player) return;
    var h = heatAdd === undefined ? HEAT[type] : heatAdd;
    if (h === undefined) h = 0.5;
    W.heat = Math.min(5.999, W.heat + h);
    W.lastCrime = W.time;
    if (type === 'cop' || type === 'cop-hit' || type === 'gunshot' || type === 'heist') W.agitated = Math.max(W.agitated, 9);
    W.level = W.stars = levelOf(W.heat);
    G.hud.setStars(W.level);
  };

  W.clear = function (announce) {
    W.heat = 0; W.agitated = 0; W.level = 0; W.stars = 0; W.time = 0; W.lastCrime = -99;
    G.hud.setStars(0);
    G.audio.siren(0);
    for (var i = E.cops.length - 1; i >= 0; i--) { E.cops[i].state = 'leave'; E.cops[i].leaveTimer = 0; }
    for (var j = E.cars.length - 1; j >= 0; j--) {
      var c = E.cars[j];
      if (c.driver === 'police') { scene.remove(c.obj); E.cars.splice(j, 1); }
    }
    if (helis.length) { for (var k = 0; k < helis.length; k++) scene.remove(helis[k].obj); helis.length = 0; }
    if (announce) G.hud.toast('YOU LOST THE COPS');
  };

  // ------------------------------------------------------------------ foot officers
  function spawnCop(x, z) {
    var obj = M.human({ shirt: 0x1b2c4a, pants: 0x14181f, skin: U.pick([0xd8a878, 0xc98f5e, 0x8a5a3a]), vest: true, hat: true, gunProp: true, detail: true });
    scene.add(obj);
    var cop = {
      obj: obj, kind: 'cop', alive: true, hp: 130, maxHp: 130,
      x: x, z: z, yaw: 0, phase: 0, radius: 0.44, height: 1.85, headY: 1.74,
      state: 'chase', fireCool: U.rand(0.4, 1.4), leaveTimer: 0, strafe: U.rng() < 0.5 ? 1 : -1, strafeT: 0
    };
    E.cops.push(cop);
    return cop;
  }

  function copShoot(cop) {
    var d = Math.sqrt(U.dist2(cop.x, cop.z, player.x, player.z));
    var lvl = W.level;
    cop.fireCool = Math.max(0.45, 1.25 - lvl * 0.08) * U.rand(0.85, 1.2);
    var mx = cop.x + Math.sin(cop.yaw) * 0.3, mz = cop.z + Math.cos(cop.yaw) * 0.3;
    G.audio.shot('pistol');
    fx.muzzle(mx, 1.35, mz, { x: Math.sin(cop.yaw), y: 0, z: Math.cos(cop.yaw) });
    var hitChance = U.clamp(0.62 - d / 60, 0.1, 0.6) * (player.car ? 0.55 : 1) + lvl * 0.03;
    var hit = Math.random() < hitChance;
    var tx = player.x + (hit ? 0 : U.rand(-1.4, 1.4));
    var ty = (player.onFoot ? player.y + 1.1 : 0.9) + (hit ? 0 : U.rand(-0.7, 0.7));
    var tz = player.z + (hit ? 0 : U.rand(-1.4, 1.4));
    fx.tracer({ x: mx, y: 1.35, z: mz }, { x: tx, y: ty, z: tz }, 0xffd070);
    G.audio.impact(false);
    if (hit) {
      G.player.takeDamage(7 + lvl * 0.7, cop.x, cop.z);
      G.hud.hurt();
      if (player.car) E.damageCar(player.car, 4, false);
    }
    E.panicNear(cop.x, cop.z, 22);
  }

  function updateCop(cop, dt) {
    if (!cop.alive) {
      cop.deadTimer = (cop.deadTimer || 0) + dt;
      if (cop.deadTimer > 20) removeCop(cop);
      return;
    }
    if (cop.state === 'leave') {
      cop.leaveTimer += dt;
      var ax = cop.x - player.x, az = cop.z - player.z, al = Math.hypot(ax, az) || 1;
      step(cop, (ax / al) * 2.4, (az / al) * 2.4, dt, 3.6);
      if (cop.leaveTimer > 10) removeCop(cop);
      return;
    }

    var dx = player.x - cop.x, dz = player.z - cop.z;
    var d = Math.hypot(dx, dz) || 1;
    var los = !G.city.segmentBlocked(cop.x, 1.5, cop.z, player.x, player.y + 1.2, player.z);
    var lvl = W.level;
    var shoot = (lvl >= 3 || W.agitated > 0) && los && d < 32 && !player.dead;

    cop.yaw = U.turnToward(cop.yaw, Math.atan2(dx, dz), dt * 5);
    if (shoot) {
      cop.strafeT -= dt;
      if (cop.strafeT <= 0) { cop.strafeT = U.rand(0.6, 1.6); cop.strafe = -cop.strafe; }
      step(cop, 0, 0, dt, 0);                          // hold ground, sidestep only
      var sx = Math.cos(cop.yaw) * cop.strafe, sz = -Math.sin(cop.yaw) * cop.strafe;
      step(cop, sx * 1.1, sz * 1.1, dt, 3.0);
      if (cop.fireCool > 0) cop.fireCool -= dt; else copShoot(cop);
    } else {
      var speed = lvl >= 3 ? 5.4 : 4.6;
      step(cop, (dx / d) * speed, (dz / d) * speed, dt, speed);
      cop.fireCool = Math.max(cop.fireCool, 0.35);
    }

    // arrest: low stars, close range, on foot
    if (player.onFoot && !player.dead && d < 2.0 && lvl <= 2 && los) W.busted();
    M.animateHuman(cop.obj, cop.phase, cop.running ? 1.5 : 0.6, shoot && cop.fireCool < 0.35);
    cop.obj.position.set(cop.x, G.city.groundY(cop.x, cop.z), cop.z);
    cop.obj.rotation.y = cop.yaw;
  }

  var _res = { x: 0, z: 0, hit: false };
  function step(cop, vx, vz, dt, speed) {
    var nx = cop.x + vx * dt, nz = cop.z + vz * dt;
    var boxes = G.city.queryBoxes(nx - 2, nz - 2, nx + 2, nz + 2);
    U.resolveCircleAABB(nx, nz, cop.radius, boxes, _res);
    cop.x = _res.x; cop.z = _res.z;
    cop.phase += dt * (speed * 2.2 + 1);
    cop.running = speed > 4;
  }

  function removeCop(cop) {
    var i = E.cops.indexOf(cop);
    if (i >= 0) E.cops.splice(i, 1);
    scene.remove(cop.obj);
  }

  // ------------------------------------------------------------------ squad cars
  function spawnSquadCar() {
    var model = M.car('police');
    scene.add(model.group);
    var bar = new THREE.Group();
    var mL = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 0 });
    var mR = new THREE.MeshStandardMaterial({ color: 0x000022, emissive: 0x2050ff, emissiveIntensity: 0 });
    var a = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.2), mL); a.position.x = -0.24;
    var b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.2), mR); b.position.x = 0.24;
    bar.add(a, b); bar.position.set(0, model.roofY + 0.07, -0.2);
    model.group.add(bar);

    var p = G.city.randomRoadPoint(player, 130);
    var car = {
      model: model, obj: model.group, kind: 'car', driven: false, driver: 'police',
      halfLen: model.halfLen, halfWid: model.halfWid,
      x: p.x, z: p.z, yaw: p.yaw, speed: 0, maxSpeed: 30, health: 220, occupied: true,
      ai: null, alive: true, crashCooldown: 0, officers: 2, bailed: false,
      barMats: [mL, mR], sirenOn: 1, flashT: 0
    };
    model.group.position.set(car.x, 0, car.z);
    model.group.rotation.y = car.yaw;
    E.cars.push(car);
    return car;
  }

  function updateSquadCar(car, dt) {
    if (!car.alive) return;
    car.flashT += dt;
    var phase = Math.floor(car.flashT * 6) % 2;
    car.barMats[0].emissiveIntensity = phase === 0 ? 2.2 : 0.05;
    car.barMats[1].emissiveIntensity = phase === 1 ? 2.2 : 0.05;

    var dx = player.x - car.x, dz = player.z - car.z;
    var d = Math.hypot(dx, dz) || 1;
    if (d < 15 && !car.bailed) {
      car.bailed = true;
      car.driver = 'abandoned';
      for (var o = 0; o < car.officers; o++) {
        var ox = car.x + Math.cos(car.yaw) * (o ? 1.6 : -1.6);
        var oz = car.z - Math.sin(car.yaw) * (o ? 1.6 : -1.6);
        if (E.cops.length < 20) spawnCop(ox, oz);
      }
      return;
    }
    if (car.bailed) return;

    // seek the player, dodge buildings with a front probe
    var wantYaw = Math.atan2(dx, dz);
    car.yaw = U.turnToward(car.yaw, wantYaw, dt * 1.9);
    var align = Math.cos(U.angleDiff(car.yaw, wantYaw));
    var target = U.clamp(align, 0, 1) * (d > 18 ? car.maxSpeed : 12);
    car.speed = U.damp(car.speed, target, 1.6, dt);
    var fx2 = Math.sin(car.yaw), fz2 = Math.cos(car.yaw);
    var probeX = car.x + fx2 * 5, probeZ = car.z + fz2 * 5;
    if (G.city.segmentBlocked(car.x, 0.6, car.z, probeX, 0.6, probeZ)) {
      car.speed = U.damp(car.speed, 2.5, 4, dt);
    }
    var nx = car.x + fx2 * car.speed * dt, nz = car.z + fz2 * car.speed * dt;
    var boxes = G.city.queryBoxes(nx - 3, nz - 3, nx + 3, nz + 3);
    var r = U.resolveCircleAABB(nx, nz, 1.1, boxes, _res);
    if (r.hit) { car.speed *= 0.3; }
    car.x = r.x; car.z = r.z;
    car.obj.position.set(car.x, 0, car.z);
    car.obj.rotation.y = car.yaw;
    car.model.wheels.forEach(function (w) { w.rotation.x += car.speed * dt * 2.4; });
    var night = G.city.night;
    for (var hm = 0; hm < car.model.headMats.length; hm++) car.model.headMats[hm].emissiveIntensity = 0.2 + night * 1.5;
    for (var hg = 0; hg < car.model.headGlows.length; hg++) car.model.headGlows[hg].material.opacity = night * 0.85;
  }

  // ------------------------------------------------------------------ helicopter
  var helis = [];
  W.helis = helis;
  function spawnHeli() {
    var g = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.6, metalness: 0.3 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 5.4), mat); body.castShadow = true; g.add(body);
    var tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 3.4), mat); tail.position.set(0, 0.4, -4); g.add(tail);
    var glass = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x101a24, roughness: 0.2, metalness: 0.5 }));
    glass.position.set(0, 0.35, 2.4); g.add(glass);
    var rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.4), mat);
    rotor.position.y = 1.1; g.add(rotor);
    var trotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.2), mat);
    trotor.position.set(0, 0.7, -5.6); g.add(trotor);
    var spot = new THREE.SpotLight(0xffffff, 3.2, 150, 0.32, 0.5, 1.2);
    spot.position.set(0, -0.6, 1.5);
    g.add(spot);
    scene.add(g); scene.add(spot.target);
    var h = { obj: g, rotor: rotor, trotor: trotor, spot: spot, y: 46, ang: Math.random() * 6.28, r: 52 };
    helis.push(h);
    return h;
  }

  function updateHeli(h, dt) {
    h.ang += dt * 0.28;
    var tx = player.x + Math.cos(h.ang) * h.r, tz = player.z + Math.sin(h.ang) * h.r;
    h.obj.position.x = U.damp(h.obj.position.x, tx, 1.2, dt);
    h.obj.position.z = U.damp(h.obj.position.z, tz, 1.2, dt);
    h.obj.position.y = U.damp(h.obj.position.y, h.y + Math.sin(W.time * 1.4) * 1.5, 1.5, dt);
    var hy = Math.atan2(player.x - h.obj.position.x, player.z - h.obj.position.z);
    h.obj.rotation.y = U.turnToward(h.obj.rotation.y, hy, dt * 1.5);
    h.rotor.rotation.y += dt * 26;
    h.trotor.rotation.z += dt * 30;
    h.spot.target.position.set(player.x, 0, player.z);
    h.obj.updateMatrixWorld();
    h.spot.target.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ tick
  W.update = function (dt, time) {
    W.time += dt;
    if (helis.length) { for (var z = 0; z < helis.length; z++) updateHeli(helis[z], dt); }
    if (player.dead) {
      for (var q = 0; q < E.cops.length; q++) updateCop(E.cops[q], dt);
      return;
    }

    if (W.agitated > 0) W.agitated -= dt;
    W.level = levelOf(W.heat);
    if (W.level !== W.stars) { W.stars = W.level; G.hud.setStars(W.level); }

    // losing the cops: away from their sight for a while
    if (W.heat > 0 && W.time - W.lastCrime > 6) {
      var seen = false;
      for (var s = 0; s < E.cops.length; s++) {
        var c = E.cops[s];
        if (!c.alive || c.state === 'leave') continue;
        if (U.dist2(c.x, c.z, player.x, player.z) < 1600 &&
          !G.city.segmentBlocked(c.x, 1.5, c.z, player.x, 1.2, player.z)) { seen = true; break; }
      }
      for (var sc = 0; sc < E.cars.length && !seen; sc++) {
        var cc = E.cars[sc];
        if (cc.driver !== 'police' || !cc.alive) continue;
        if (U.dist2(cc.x, cc.z, player.x, player.z) < 9000) { seen = true; }
      }
      W.heat -= dt * (seen ? 0.05 : 0.22);
      if (W.heat < 0.08) W.clear(true);
    }

    var footUnits = 0, carUnits = 0;
    for (var i = 0; i < E.cops.length; i++) if (E.cops[i].alive && E.cops[i].state !== 'leave') footUnits++;
    for (var j = 0; j < E.cars.length; j++) if (E.cars[j].driver === 'police' && E.cars[j].alive && !E.cars[j].bailed) carUnits++;

    var wantFoot = COPS_PER_LEVEL[W.level] + (W.agitated > 0 ? 2 : 0);
    var wantCars = CARS_PER_LEVEL[W.level];
    if (W.level > 0 && footUnits < wantFoot) {
      var n = Math.min(2, wantFoot - footUnits);
      for (var k = 0; k < n; k++) {
        if (E.cops.length > 22) break;
        var p = G.city.randomSidewalkPoint(player, 70);
        spawnCop(p.x, p.z);
      }
    }
    if (W.level >= 2 && carUnits < wantCars) spawnSquadCar();
    if (W.level >= 5 && helis.length === 0) { spawnHeli(); G.hud.toast('POLICE AIR SUPPORT INBOUND'); }

    for (var m = 0; m < E.cops.length; m++) updateCop(E.cops[m], dt);
    for (var n2 = 0; n2 < E.cars.length; n2++) {
      if (E.cars[n2].driver === 'police' && E.cars[n2].alive) updateSquadCar(E.cars[n2], dt);
    }

    // siren volume = nearest active unit
    var near = 1e9;
    for (var a = 0; a < E.cops.length; a++) {
      if (E.cops[a].state === 'leave') continue;
      near = Math.min(near, U.dist2(E.cops[a].x, E.cops[a].z, player.x, player.z));
    }
    for (var b = 0; b < E.cars.length; b++) {
      if (E.cars[b].driver !== 'police') continue;
      near = Math.min(near, U.dist2(E.cars[b].x, E.cars[b].z, player.x, player.z));
    }
    var vol = W.level > 0 ? U.clamp(1 - Math.sqrt(near) / 220, 0, 1) : 0;
    G.audio.siren(vol);
  };

  W.busted = function () {
    if (player.dead) return;
    player.busted = true;
    player.die('BUSTED');
    W.clear(false);
  };

})(window.G);
