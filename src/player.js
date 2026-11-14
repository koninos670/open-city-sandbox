/* Player: on-foot movement, weapons, third/first person camera, arcade car physics. */
(function (G) {
  'use strict';
  var U = G.util, M = G.models, fx = G.fx, E = G.entities;
  var P = G.player = G.player || {};

  var WEAPONS = P.WEAPONS = {
    pistol: { name: 'PISTOL', dmg: 32, interval: 0.28, auto: false, mag: 12, reserve: 96, spread: 0.012, pellets: 1, range: 90, kick: 1.1, sound: 'pistol' },
    smg: { name: 'MICRO SMG', dmg: 17, interval: 0.075, auto: true, mag: 30, reserve: 180, spread: 0.032, pellets: 1, range: 70, kick: 0.7, sound: 'smg' },
    rifle: { name: 'ASSAULT RIFLE', dmg: 27, interval: 0.105, auto: true, mag: 30, reserve: 210, spread: 0.021, pellets: 1, range: 150, kick: 0.9, sound: 'rifle' },
    shotgun: { name: 'PUMP SHOTGUN', dmg: 13, interval: 0.85, auto: false, mag: 6, reserve: 48, spread: 0.085, pellets: 9, range: 34, kick: 3.2, sound: 'shotgun' }
  };

  var GRAVITY = 22, WALK = 3.3, SPRINT = 6.4, JUMP_V = 7.4;

  // pick the heading with the most open space so a spawn never stares at a wall
  function faceOpen() {
    var y0 = P.y + 0.9, bestYaw = P.camYaw || 0, best = -1;
    for (var i = 0; i < 12; i++) {
      var yaw = i * Math.PI / 6, d = 0;
      for (var t = 2; t <= 16; t += 2) {
        var nx = P.x + Math.sin(yaw) * t, nz = P.z + Math.cos(yaw) * t;
        if (G.city.segmentBlocked(P.x, y0, P.z, nx, y0, nz)) break;
        d = t;
      }
      if (d > best) { best = d; bestYaw = yaw; }
    }
    P.yaw = bestYaw; P.camYaw = bestYaw;
  }

  P.init = function (scene, camera) {
    var sp = G.city.randomSidewalkPoint(null, 0);
    P.x = sp.x; P.z = sp.z; P.y = G.city.groundY(P.x, P.z); P.yaw = 0; P.vy = 0; P.lastStep = 0;
    P.hp = 100; P.armor = 0; P.cash = 500;
    P.onFoot = true; P.car = null; P.dead = false; P.deadTimer = 0; P.busted = false;
    P.camYaw = 0; P.camPitch = 0.16; P.camMode = 0; P.camDist = 5.4;
    faceOpen();
    P.aim = false; P.cool = 0; P.reloading = 0; P.phase = 0;
    P.speedKmh = 0; P.shake = 0;
    P.weapon = 'pistol';
    P.owned = { pistol: true, smg: true, rifle: false, shotgun: false };
    P.ammo = {};
    for (var k in WEAPONS) P.ammo[k] = { mag: WEAPONS[k].mag, reserve: WEAPONS[k].reserve };
    P.ammo.smg = { mag: 30, reserve: 90 };

    P.obj = M.human({ shirt: 0x2f3a4d, pants: 0x22262c, skin: 0xd8a878, gunProp: false });
    P.obj.position.set(P.x, 0, P.z);
    scene.add(P.obj);
    P.camera = camera;

    P.gunProp = new THREE.Group();
    var gm = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.7, roughness: 0.35 });
    var gm2 = new THREE.MeshStandardMaterial({ color: 0x33383d, metalness: 0.6, roughness: 0.4 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.4), gm); body.position.z = 0.12;
    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 6), gm2);
    barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.42;
    var grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), gm); grip.position.set(0, -0.14, 0.02);
    P.gunProp.add(body, barrel, grip);
    P.gunProp.visible = false;
    P.obj.userData.parts.armR.add(P.gunProp);
  };

  // --------------------------------------------------------------- helpers
  P.forward = function (yaw) { return { x: Math.sin(yaw), z: Math.cos(yaw) }; };

  P.giveAmmo = function (n) {
    for (var k in WEAPONS) P.ammo[k].reserve = Math.min(999, P.ammo[k].reserve + n);
  };

  P.takeDamage = function (dmg, fromX, fromZ) {
    if (P.dead || dmg <= 0) return;
    if (P.armor > 0) {
      var absorbed = Math.min(P.armor, dmg * 0.7);
      P.armor -= absorbed; dmg -= absorbed;
    }
    P.hp -= dmg;
    P.shake = Math.min(1.4, P.shake + dmg * 0.02);
    G.hud.hurt();
    if (P.hp <= 0) { P.hp = 0; P.die(); }
  };

  P.die = function (cause) {
    if (P.dead) return;
    P.dead = true; P.deadTimer = 0;
    if (P.car) P.exitCar(true);
    var busted = cause === 'BUSTED';
    G.hud.bigMessage(busted ? 'BUSTED' : 'WASTED', busted ? '#e8d24a' : '#ff4a4a');
    G.wanted && G.wanted.clear(false);
    G.audio.shot('pistol');
  };

  P.respawn = function () {
    var sp = G.city.randomSidewalkPoint(null, 0);
    P.x = sp.x; P.z = sp.z; P.y = G.city.groundY(P.x, P.z); P.vy = 0;
    P.hp = 100; P.armor = 0; P.dead = false; P.busted = false;
    faceOpen();
    P.cash = Math.max(0, P.cash - Math.floor(P.cash * 0.15));
    P.owned = { pistol: true, smg: false, rifle: false, shotgun: false };
    P.weapon = 'pistol';
    for (var k in WEAPONS) P.ammo[k] = { mag: WEAPONS[k].mag, reserve: WEAPONS[k].reserve };
    P.obj.visible = true; P.obj.rotation.z = 0; P.gunProp.visible = false;
    G.hud.bigMessage('', null);
    G.hud.toast(P.busted ? 'Released from custody &mdash; weapons confiscated' : 'Hospital bill paid &mdash; weapons confiscated');
  };

  // --------------------------------------------------------------- weapons
  P.selectWeapon = function (slot) {
    var map = { 1: 'pistol', 2: 'smg', 3: 'rifle', 4: 'shotgun' };
    var w = map[slot];
    if (!w) return;
    if (!P.owned[w]) { G.hud.toast('You do not own the ' + WEAPONS[w].name); return; }
    if (P.weapon === w) return;
    P.weapon = w; P.reloading = 0; P.cool = Math.max(P.cool, 0.16);
    G.audio.ui();
  };

  P.startReload = function () {
    var W = WEAPONS[P.weapon], a = P.ammo[P.weapon] || (P.ammo[P.weapon] = { mag: 0, reserve: 0 });
    if (P.reloading > 0 || a.mag >= W.mag || a.reserve <= 0) return;
    P.reloading = 1.5;
  };

  var _camDir = new THREE.Vector3(), _hitP = new THREE.Vector3();

  function aimRay() {
    // a ray from the camera through the centre of the screen, with spread
    var W = WEAPONS[P.weapon];
    P.camera.getWorldDirection(_camDir);
    var sp = W.spread * (P.aim ? 0.35 : 1) * (P.moving ? 1.6 : 1);
    var d = _camDir.clone();
    d.x += U.rand(-1, 1) * sp; d.y += U.rand(-1, 1) * sp; d.z += U.rand(-1, 1) * sp;
    d.normalize();
    return d;
  }

  function muzzlePos(dir) {
    var yaw = P.camYaw;
    return {
      x: P.x + Math.sin(yaw) * 0.45 - Math.cos(yaw) * 0.26,
      y: (P.onFoot ? P.y + 1.35 : 0.95) + (P.camPitch < -0.4 ? -0.2 : 0),
      z: P.z + Math.cos(yaw) * 0.45 + Math.sin(yaw) * 0.26
    };
  }

  // cast one ray against the world and everything alive in it
  function raycastWorld(ox, oy, oz, dx, dy, dz, maxT) {
    var best = { t: maxT, kind: null, obj: null };
    var boxes = G.city.boxes;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (b.kind === 'park') continue;
      var t = U.rayAABB(ox, oy, oz, dx, dy, dz, b);
      if (t < best.t) { best.t = t; best.kind = 'world'; best.obj = b; }
    }
    function testHuman(list, kind) {
      for (var j = 0; j < list.length; j++) {
        var h = list[j];
        if (!h.alive) continue;
        var t = U.rayCylinder(ox, oy, oz, dx, dy, dz, h.x, h.z, h.radius + 0.06, 0.05, h.height);
        if (t < best.t) { best.t = t; best.kind = kind; best.obj = h; }
      }
    }
    testHuman(E.peds, 'ped');
    testHuman(E.cops, 'cop');
    for (var c = 0; c < E.cars.length; c++) {
      var car = E.cars[c];
      if (!car.alive || car === P.car) continue;
      var t2 = U.rayOBB(ox, oy, oz, dx, dy, dz, car.x, 0.75, car.z, car.yaw, car.halfWid, 0.75, car.halfLen);
      if (t2 < best.t) { best.t = t2; best.kind = 'car'; best.obj = car; }
    }
    // ground plane
    if (dy < -0.0001) {
      var tg = -oy / dy;
      if (tg > 0 && tg < best.t) { best.t = tg; best.kind = 'ground'; best.obj = null; }
    }
    return best;
  }

  P.fire = function () {
    var W = WEAPONS[P.weapon], a = P.ammo[P.weapon] || (P.ammo[P.weapon] = { mag: 0, reserve: 0 });
    if (P.dead || P.reloading > 0 || P.cool > 0) return;
    if (a.mag <= 0) { G.audio.ui(); P.startReload(); return; }
    a.mag--;
    P.cool = W.interval;
    P.recoil = W.kick;
    P.shake = Math.min(1.2, P.shake + W.kick * 0.12);
    G.audio.shot(W.sound);

    var dir = aimRay();
    var mx = muzzlePos(dir);
    fx.muzzle(mx.x, mx.y, mx.z, dir);
    E.panicNear(mx.x, mx.z, 34);
    G.wanted && G.wanted.crime('gunshot', P.x, P.z);

    // bullets follow the crosshair: cast from the camera eye, not the gun muzzle,
    // so the point of impact lines up with what the player is aiming at
    var eye = P.camera.position;
    for (var p = 0; p < W.pellets; p++) {
      var d = p === 0 ? dir.clone() : aimRay();
      var hit = raycastWorld(eye.x, eye.y, eye.z, d.x, d.y, d.z, W.range);
      var hx = eye.x + d.x * hit.t, hy = eye.y + d.y * hit.t, hz = eye.z + d.z * hit.t;
      fx.tracer({ x: mx.x, y: mx.y, z: mx.z }, { x: hx, y: hy, z: hz }, 0xffe6a0);
      if (hit.kind === 'ped' || hit.kind === 'cop') {
        E.hurtPed(hit.obj, W.dmg, d.x, d.z, true);
        if (hit.obj.kind === 'cop') G.wanted && G.wanted.crime('cop-hit', hit.obj.x, hit.obj.z);
      } else if (hit.kind === 'car') {
        E.damageCar(hit.obj, W.dmg * 0.6, true);
        fx.impact(hx, hy, hz, 'rgba(255,220,160,1)', 5);
        G.audio.impact(false);
      } else if (hit.kind === 'ground') {
        fx.emit({ x: hx, y: 0.06, z: hz, color: 'rgba(180,175,160,1)', additive: false, size: 0.28, life: 0.5, count: 3, spread: 2, gravity: 8, jitter: 0.08 });
      } else if (hit.kind === 'world') {
        fx.impact(hx, hy, hz, 'rgba(220,225,235,1)', 4);
        G.audio.impact(false);
      }
    }
    G.hud.flashAmmo();
  };

  // --------------------------------------------------------------- vehicles
  P.enterCar = function (car) {
    if (!car || !car.alive) return;
    P.car = car;
    car.driven = true;
    if (car.driver === 'ai') {           // carjacking is a crime
      car.driver = 'player';
      if (Math.random() < 0.8 && E.peds.length < 90) {
        E.peds.push(E.makePed({ x: car.x + U.rand(-1.5, 1.5), z: car.z + U.rand(-1.5, 1.5) }, true));
      }
      G.wanted && G.wanted.crime('carjack', car.x, car.z);
    } else {
      car.driver = 'player';
    }
    P.onFoot = false;
    P.obj.visible = false;
    P.vf = 0; P.vr = 0;
    P.yaw = car.yaw;
    G.hud.toast(car.model.type + ' acquired');
  };

  P.exitCar = function (forced) {
    var car = P.car;
    if (!car) return;
    car.driven = false;
    if (!forced) car.driver = 'abandoned';
    car.speed = 0;
    var side = Math.cos(car.yaw) * 1.9;
    var sideZ = Math.sin(car.yaw) * 1.9;
    P.x = car.x - side; P.z = car.z - sideZ;
    var boxes = G.city.queryBoxes(P.x - 2, P.z - 2, P.x + 2, P.z + 2);
    var r = U.resolveCircleAABB(P.x, P.z, 0.5, boxes, {});
    P.x = r.x; P.z = r.z;
    P.y = G.city.groundY(P.x, P.z); P.vy = 0;
    P.onFoot = true;
    P.obj.visible = true;
    P.car = null;
    P.speedKmh = 0;
  };

  P.carCrash = function (rel) {
    var dmg = U.clamp(rel * 0.6, 0, 45);
    // one charge per bump: the traffic pass calls this every frame the two cars
    // overlap, and without the gate a car nudging you would drain all your health
    if (dmg < 3 || P.crashHpCool > 0) return;
    P.crashHpCool = 0.8;
    fx.impact(P.x, 0.9, P.z, 'rgba(255,230,180,1)', 8);
    G.audio.impact(true);
    P.takeDamage(dmg * 0.35, P.x, P.z);
    // the traffic pass already charges this bump; only add damage when it did not
    if (P.car && P.car.crashCooldown <= 0) { P.car.crashCooldown = 0.8; E.damageCar(P.car, dmg, false); }
  };

  // --------------------------------------------------------------- update
  var _res = { x: 0, z: 0, hit: false };

  P.update = function (dt, input) {
    if (P.dead) {
      P.deadTimer += dt;
      if (P.deadTimer > 3.2) P.respawn();
      updateCamera(dt);
      return;
    }
    P.cool = Math.max(0, P.cool - dt);
    P.crashHpCool = Math.max(0, (P.crashHpCool || 0) - dt);
    P.recoil = U.damp(P.recoil || 0, 0, 9, dt);
    P.shake = U.damp(P.shake, 0, 4.5, dt);

    if (P.reloading > 0) {
      P.reloading -= dt;
      if (P.reloading <= 0) {
        var W = WEAPONS[P.weapon], a = P.ammo[P.weapon] || (P.ammo[P.weapon] = { mag: 0, reserve: 0 });
        var need = W.mag - a.mag, take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
      }
    }

    // camera look
    P.camYaw -= input.mx * 0.0028;
    P.camPitch = U.clamp(P.camPitch - input.my * 0.0024, -0.85, 1.05);
    input.mx = 0; input.my = 0;
    P.aim = !!input.aim && P.onFoot;

    if (P.onFoot) updateOnFoot(dt, input); else updateInCar(dt, input);
    updateCamera(dt);
  };

  function moveInput(input) {
    var f = (input.keys['KeyW'] ? 1 : 0) - (input.keys['KeyS'] ? 1 : 0);
    var s = (input.keys['KeyD'] ? 1 : 0) - (input.keys['KeyA'] ? 1 : 0);
    return { f: f, s: s };
  }

  function updateOnFoot(dt, input) {
    G.audio.engine(0, 0, 0);
    var mi = moveInput(input);
    var sprint = input.keys['ShiftLeft'] || input.keys['ShiftRight'];
    var speed = sprint ? SPRINT : WALK;
    var fx2 = Math.sin(P.camYaw), fz2 = Math.cos(P.camYaw);
    var rx = -fz2, rz = fx2;
    var wx = fx2 * mi.f + rx * mi.s, wz = fz2 * mi.f + rz * mi.s;
    var len = Math.hypot(wx, wz);
    P.moving = len > 0.01;
    if (P.moving) { wx /= len; wz /= len; }

    var nx = P.x + wx * speed * dt, nz = P.z + wz * speed * dt;
    var boxes = G.city.queryBoxes(nx - 2, nz - 2, nx + 2, nz + 2);
    U.resolveCircleAABB(nx, nz, 0.45, boxes, _res);
    P.x = U.clamp(_res.x, -G.city.HALF - 10, G.city.HALF + 10);
    P.z = U.clamp(_res.z, -G.city.HALF - 10, G.city.HALF + 10);

    // jump / gravity
    var ground = G.city.groundY(P.x, P.z);
    if (P.vy > 0 || P.y > ground + 0.001) {
      P.vy -= GRAVITY * dt; P.y += P.vy * dt;
      if (P.y <= ground) { P.y = ground; P.vy = 0; }
    } else if (input.keys['Space']) {
      P.vy = JUMP_V; G.audio.step();
    } else { P.y = ground; }

    // facing: toward movement, or straight ahead of the camera while aiming/shooting
    var want = P.aim ? P.camYaw : (P.moving ? Math.atan2(wx, wz) : P.yaw);
    P.yaw = U.turnToward(P.yaw, want, dt * (P.aim ? 12 : 9));

    // footsteps
    if (P.moving && P.y <= ground + 0.01) {
      P.phase += dt * speed * 2.1;
      if (P.phase > P.lastStep + 3.4) { P.lastStep = P.phase; G.audio.step(); }
    } else if (!P.moving) {
      P.phase = U.damp(P.phase, Math.round(P.phase / Math.PI) * Math.PI, 6, dt);
    }
    M.animateHuman(P.obj, P.phase, P.moving ? (sprint ? 1.25 : 0.85) : 0.12, P.aim);
    P.obj.position.set(P.x, P.y, P.z);
    P.obj.rotation.y = P.yaw;

    var armed = P.weapon && P.owned[P.weapon];
    P.gunProp.visible = !!armed;
    if (P.aim) {
      P.obj.userData.parts.armR.rotation.x = -1.55 + P.camPitch * 0.6;
      P.obj.userData.parts.armR.rotation.z = -0.12;
      P.obj.userData.parts.armL.rotation.x = -1.35;
    }
    if (input.fire && armed) {
      if (WEAPONS[P.weapon].auto || !P.firedThisPress) { P.fire(); P.firedThisPress = true; }
    } else { P.firedThisPress = false; }
    if (input.keys['KeyR']) P.startReload();
    if (input.keys['KeyF']) { if (P.carTimer === undefined || P.carTimer <= 0) { G.audio.horn(); P.carTimer = 0.5; } }
    if (P.carTimer > 0) P.carTimer -= dt;
  }

  function updateInCar(dt, input) {
    var car = P.car;
    var T = car.model.T;
    var mi = moveInput(input);
    var hand = !!input.keys['Space'];
    var boost = input.keys['ShiftLeft'] || input.keys['ShiftRight'];

    var maxFwd = (car.model.type === 'suv' || car.model.type === 'van' ? 27 : car.model.type === 'police' ? 34 : 31) * (boost ? 1.28 : 1);
    var accel = 17 / T.mass * (boost ? 1.25 : 1);
    var vf = P.vf || 0, vr = P.vr || 0;

    if (mi.f > 0) vf += accel * dt;
    else if (mi.f < 0) {
      if (vf > 0.4) vf -= accel * 1.7 * dt;           // braking
      else vf -= accel * 0.7 * dt;                    // reverse
    }
    vf -= vf * 0.32 * dt;                              // rolling resistance
    if (hand) vf -= vf * 1.4 * dt;
    vf = U.clamp(vf, -9, maxFwd);

    var steer = mi.s;
    var grip = hand ? 1.4 : 8.5;
    var yawRate = steer * 2.3 * U.clamp(Math.abs(vf) / 9, 0, 1) * U.sign(vf || 1);
    P.yaw += yawRate * dt;
    vr += -yawRate * vf * 0.35 * dt;                   // mild sideways slide when steering hard
    vr *= Math.exp(-grip * dt);

    var fx2 = Math.sin(P.yaw), fz2 = Math.cos(P.yaw);
    var rx = -fz2, rz = fx2;
    var vx = fx2 * vf + rx * vr, vz = fz2 * vf + rz * vr;
    var nx = car.x + vx * dt, nz = car.z + vz * dt;

    // collide with buildings: front, middle and rear circles, checked in sub-steps so
    // a fast car cannot tunnel through a wall in a single frame
    var hitHard = 0, _cRad = car.halfWid * 0.62;
    var vfBeforeHit = Math.abs(vf);
    var stepLen = Math.hypot(nx - car.x, nz - car.z);
    var subs = Math.min(6, Math.max(1, Math.ceil(stepLen / 0.4)));
    for (var s = 1; s <= subs; s++) {
      var mx = car.x + (nx - car.x) * (s / subs), mz = car.z + (nz - car.z) * (s / subs);
      for (var i = -1; i <= 1; i++) {
        var pxp = mx + fx2 * i * car.halfLen * 0.55, pzp = mz + fz2 * i * car.halfLen * 0.55;
        var boxes = G.city.queryBoxes(pxp - 2.5, pzp - 2.5, pxp + 2.5, pzp + 2.5);
        var r = U.resolveCircleAABB(pxp, pzp, _cRad, boxes, _res);
        if (r.hit) {
          var dx = r.x - pxp, dz = r.z - pzp;
          mx += dx; mz += dz; nx += dx; nz += dz;   // push the whole car out
          vf *= 0.25; vr *= 0.3;
        }
      }
    }
    // only the speed the wall actually took off you counts, so brushing along a
    // building while driving does not drain the car a chunk every cooldown
    hitHard = vfBeforeHit - Math.abs(vf);
    if (hitHard > 4 && car.crashCooldown <= 0) {
      car.crashCooldown = 0.8;
      E.damageCar(car, (hitHard - 4) * 2.2 + 5, false);
      fx.impact(car.x, 0.9, car.z, 'rgba(255,225,170,1)', 7);
      G.audio.impact(true);
      P.takeDamage((hitHard - 4) * 0.8 + 3, car.x, car.z);
    }

    // run over pedestrians
    for (var p = 0; p < E.peds.length; p++) {
      var ped = E.peds[p];
      if (!ped.alive) continue;
      var _ddx = ped.x - car.x, _ddz = ped.z - car.z;
      var _lx = _ddx * fx2 + _ddz * fz2, _ly = -_ddx * fz2 + _ddz * fx2;
      if (Math.abs(_lx) < car.halfLen + 0.5 && Math.abs(_ly) < car.halfWid + 0.5 && Math.abs(vf) > 3.5) {
        E.hurtPed(ped, Math.abs(vf) * 9, fx2, fz2, true);
        P.takeDamage(2, ped.x, ped.z);
        vf *= 0.94;
      }
    }
    for (var q = 0; q < E.cops.length; q++) {
      var cop = E.cops[q];
      var _cdx = cop.x - car.x, _cdz = cop.z - car.z;
      var _clx = _cdx * fx2 + _cdz * fz2, _cly = -_cdx * fz2 + _cdz * fx2;
      if (cop.alive && Math.abs(_clx) < car.halfLen + 0.5 && Math.abs(_cly) < car.halfWid + 0.5 && Math.abs(vf) > 3.5) {
        E.hurtPed(cop, Math.abs(vf) * 9, fx2, fz2, true);
        vf *= 0.94;
      }
    }

    car.x = U.clamp(nx, -G.city.HALF - 12, G.city.HALF + 12);
    car.z = U.clamp(nz, -G.city.HALF - 12, G.city.HALF + 12);
    car.yaw = P.yaw;
    car.speed = vf;
    P.vf = vf; P.vr = vr;
    P.x = car.x; P.z = car.z; P.y = 0;
    P.speedKmh = Math.abs(vf) * 3.6;

    car.obj.position.set(car.x, 0, car.z);
    car.obj.rotation.y = car.yaw;
    // body roll + pitch for a bit of weight transfer
    car.obj.rotation.z = U.damp(car.obj.rotation.z, -steer * U.clamp(vf / maxFwd, 0, 1) * 0.06, 6, dt);
    for (var w = 0; w < car.model.wheels.length; w++) {
      car.model.wheels[w].rotation.x += vf * dt * 2.2;
      if (w < 2) car.model.wheels[w].rotation.y = U.damp(car.model.wheels[w].rotation.y, steer * 0.4, 8, dt);
    }
    var night = G.city.night;
    for (var hm = 0; hm < car.model.headMats.length; hm++) car.model.headMats[hm].emissiveIntensity = 0.2 + night * 1.6;
    for (var hg = 0; hg < car.model.headGlows.length; hg++) car.model.headGlows[hg].material.opacity = night * 0.85;
    for (var tm = 0; tm < car.model.tailMats.length; tm++) {
      car.model.tailMats[tm].emissiveIntensity = (mi.f < 0 || hand ? 1.8 : 0.35);
    }
    G.audio.engine(U.clamp(Math.abs(vf) / maxFwd, 0, 1), 0.5 + U.clamp(Math.abs(vf) / 8, 0, 1) * 0.6,
      P.camMode === 1 ? 0.045 : 0.07);
  }

  var _camQ = new THREE.Quaternion(), _pivot = new THREE.Vector3();
  function updateCamera(dt) {
    var cam = P.camera;
    var headY = P.onFoot ? P.y + 1.62 : 1.05;
    var dist = P.camMode === 0 ? (P.aim ? 2.6 : 5.4) : P.camMode === 2 ? 9.5 : 0;
    var height = P.camMode === 0 ? 0.55 : P.camMode === 2 ? 3.2 : 0;

    if (P.dead) {
      // slow orbit while the wasted card is up
      P.deadOrbit = (P.deadOrbit || 0) + dt * 0.4;
      cam.position.set(P.x + Math.sin(P.deadOrbit) * 6, 3.4, P.z + Math.cos(P.deadOrbit) * 6);
      cam.lookAt(P.x, 0.8, P.z);
      return;
    }

    _pivot.set(P.x, headY + height, P.z);
    var cp = Math.cos(P.camPitch);
    var dx = Math.sin(P.camYaw) * cp, dy = Math.sin(P.camPitch), dz = Math.cos(P.camYaw) * cp;

    if (P.camMode === 1) {                            // first person: eyes of the character
      cam.position.set(P.x + dx * 0.12, headY - 0.02, P.z + dz * 0.12);
      cam.rotation.set(-P.camPitch, P.camYaw + Math.PI, 0, 'YXZ');
      P.obj.visible = false;
    } else {
      if (!P.onFoot) P.obj.visible = false;
      var back = dist;
      // pull the camera in when a building is in the way
      for (var s = 0.4; s <= 1.0; s += 0.2) {
        var qx = P.x - dx * back * s, qz = P.z - dz * back * s, qy = headY + height - dy * back * s;
        if (G.city.segmentBlocked(P.x, headY + 0.2, P.z, qx, qy, qz)) { back *= Math.max(0.35, s - 0.2); break; }
      }
      var px = P.x - dx * back, py = headY + height - dy * back + 0.35, pz = P.z - dz * back;
      if (P.onFoot) { px -= Math.cos(P.camYaw) * 0.5; pz += Math.sin(P.camYaw) * 0.5; }
      cam.position.x = U.damp(cam.position.x, px, 18, dt);
      cam.position.y = U.damp(cam.position.y, py, 18, dt);
      cam.position.z = U.damp(cam.position.z, pz, 18, dt);
      cam.lookAt(P.x + (P.aim ? dx * 6 : 0), headY + (P.aim ? dy * 6 : 0) - 0.15, P.z + (P.aim ? dz * 6 : 0));
      cam.rotation.z += (P.shake ? U.rand(-1, 1) * P.shake * 0.01 : 0);
    }
    if (P.shake > 0.001) {
      cam.position.x += U.rand(-1, 1) * P.shake * 0.06;
      cam.position.y += U.rand(-1, 1) * P.shake * 0.06;
      cam.position.z += U.rand(-1, 1) * P.shake * 0.06;
    }
    if (P.camMode !== 1 && P.onFoot) P.obj.visible = true;
  }

})(window.G);
