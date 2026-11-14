/* Traffic AI, pedestrians, carjacking and world pickups. */
(function (G) {
  'use strict';
  var U = G.util, M = G.models, fx = G.fx;
  var E = G.entities = {
    cars: [], peds: [], cops: [], pickups: [], humans: []
  };
  var scene, player;
  var MAX_CARS = 26, MAX_PEDS = 46;
  var TYPES = ['sedan', 'sedan', 'coupe', 'suv', 'van', 'taxi', 'sedan', 'suv'];

  E.init = function (sc, pl) {
    scene = sc; player = pl;
    for (var i = 0; i < MAX_CARS; i++) E.cars.push(makeTrafficCar(null));
    for (var j = 0; j < MAX_PEDS; j++) E.peds.push(makePed(null));
    spawnPickups();
  };

  // ------------------------------------------------------------------ vehicles
  var _c = { x: 0, z: 0, hit: false };

  function makeTrafficCar(near) {
    var type = U.pick(TYPES);
    var model = M.car(type);
    var car = {
      model: model, obj: model.group, kind: 'car', driven: false, driver: 'ai',
      halfLen: model.halfLen, halfWid: model.halfWid,
      x: 0, z: 0, yaw: 0, speed: 0, maxSpeed: 0, health: 100, occupied: true,
      ai: null, alive: true, crashCooldown: 0
    };
    scene.add(model.group);
    placeCarOnRoad(car, near);
    return car;
  }

  function placeCarOnRoad(car, near) {
    var p = G.city.randomRoadPoint(near || player, near ? 60 : 0);
    car.x = p.x; car.z = p.z; car.yaw = p.yaw;
    var onX = Math.abs(Math.sin(p.yaw)) > 0.5;
    car.ai = {
      axis: onX ? 'x' : 'z',
      dir: onX ? (Math.sin(p.yaw) >= 0 ? 1 : -1) : (Math.cos(p.yaw) >= 0 ? 1 : -1),
      roadIdx: Math.round(((onX ? p.z : p.x) + G.city.HALF) / G.city.BLOCK)
    };
    // recover the exact lane centre so the car starts neatly in its lane
    if (onX) {
      car.z = -G.city.HALF + car.ai.roadIdx * G.city.BLOCK + car.ai.dir * (G.city.ROAD / 4);
      car.yaw = car.ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.x = -G.city.HALF + car.ai.roadIdx * G.city.BLOCK - car.ai.dir * (G.city.ROAD / 4);
      car.yaw = car.ai.dir > 0 ? 0 : Math.PI;
    }
    car.maxSpeed = U.rand(9, 17);
    car.speed = car.maxSpeed * U.rand(0.4, 1);
    car.health = 100; car.alive = true;
    car.model.mBody.color.setHex(U.pick(M.CAR_COLORS));
    car.obj.rotation.z = 0;
    syncCar(car);
  }
  E.placeCarOnRoad = placeCarOnRoad;

  function syncCar(car) {
    car.obj.position.set(car.x, 0, car.z);
    car.obj.rotation.y = car.yaw;
  }

  // returns the car the player is closest to (for the "press E" prompt)
  E.carNear = function (x, z, maxD) {
    var best = null, bestD = maxD * maxD;
    for (var i = 0; i < E.cars.length; i++) {
      var c = E.cars[i];
      if (!c.alive || c.driven) continue;
      var d = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  };

  E.damageCar = function (car, dmg, byPlayer) {
    if (!car.alive) return;
    car.health -= dmg;
    if (car.health <= 30) {
      fx.smoke(car.x, 0.9, car.z, 1.2, 1.2);
      if (car.health <= 0) E.destroyCar(car, byPlayer);
    }
  };

  E.destroyCar = function (car, byPlayer) {
    if (!car.alive) return;
    car.alive = false;
    fx.explosion(car.x, 0.8, car.z);
    G.audio.explosion();
    car.obj.visible = false;
    if (car.occupied && car.driver === 'ai' && Math.random() < 0.6) {
      var p = makePed({ x: car.x + U.rand(-2, 2), z: car.z + U.rand(-2, 2) }, true);
      E.peds.push(p);
    }
    if (byPlayer) G.wanted && G.wanted.crime(car.driver === 'police' ? 'cop' : 'car', car.x, car.z);
    if (player && player.car === car) player.exitCar(true);
    setTimeout(function () { placeCarOnRoad(car, null); }, 12000 + Math.random() * 8000);
  };

  // ------------------------------------------------------------------ people
  function makePed(pos, panicked) {
    var obj = M.human({ gunProp: false, detail: true });
    var ped = {
      obj: obj, kind: 'ped', alive: true, hp: 100, maxHp: 100,
      x: pos ? pos.x : 0, z: pos ? pos.z : 0, yaw: 0, phase: U.rand(0, 6),
      speed: U.rand(1.1, 1.8), radius: 0.42, height: 1.85, headY: 1.71,
      state: panicked ? 'flee' : 'walk', timer: panicked ? U.rand(4, 8) : 0,
      target: null, deadTimer: 0, panicFrom: null, walkAmp: 0.55
    };
    scene.add(obj);
    if (!pos) {
      var sp = G.city.randomSidewalkPoint(player, 40);
      ped.x = sp.x; ped.z = sp.z;
    }
    ped.target = G.city.randomSidewalkPoint(ped, 12);
    return ped;
  }
  E.makePed = makePed;

  E.panicNear = function (x, z, radius) {
    var r2 = radius * radius;
    for (var i = 0; i < E.peds.length; i++) {
      var p = E.peds[i];
      if (!p.alive) continue;
      if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < r2) {
        p.state = 'flee'; p.timer = U.rand(4, 9); p.panicFrom = { x: x, z: z };
      }
    }
    // nearby drivers bail out of their cars and run
    for (var j = 0; j < E.cars.length; j++) {
      var c = E.cars[j];
      if (!c.alive || c.driver !== 'ai') continue;
      if ((c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) < r2 * 2.2) {
        c.occupied = false; c.driver = 'abandoned';
        if (E.peds.length < MAX_PEDS * 2) {
          E.peds.push(makePed({ x: c.x + U.rand(-2, 2), z: c.z + U.rand(-2, 2) }, true));
        }
      }
    }
  };

  E.hurtPed = function (ped, dmg, dirX, dirZ, byPlayer) {
    if (!ped.alive) return;
    ped.hp -= dmg;
    fx.blood(ped.x, 1.15, ped.z, dirX || 0, dirZ || 0);
    G.audio.hitFlesh();
    if (ped.hp <= 0) {
      ped.alive = false; ped.state = 'dead'; ped.deadTimer = 0;
      ped.obj.rotation.z = Math.PI / 2;
      ped.obj.position.y = 0.35;
      if (byPlayer) G.wanted && G.wanted.crime(ped.kind === 'cop' ? 'cop' : 'ped', ped.x, ped.z);
    } else {
      ped.state = 'flee'; ped.timer = U.rand(4, 9);
      ped.panicFrom = { x: ped.x - dirX * 4, z: ped.z - dirZ * 4 };
      if (byPlayer) G.wanted && G.wanted.crime('assault', ped.x, ped.z);
    }
  };

  function updatePed(p, dt, t) {
    if (!p.alive) {
      p.deadTimer += dt;
      if (p.deadTimer > 9) {
        // recycle far-away corpses into fresh pedestrians
        p.alive = true; p.hp = p.maxHp; p.obj.rotation.z = 0; p.obj.position.y = 0;
        var sp = G.city.randomSidewalkPoint(player, 90);
        p.x = sp.x; p.z = sp.z; p.state = 'walk'; p.target = G.city.randomSidewalkPoint(p, 12);
      }
      return;
    }
    var fleeing = p.state === 'flee';
    if (fleeing) {
      p.timer -= dt;
      if (p.timer <= 0) { p.state = 'walk'; p.target = G.city.randomSidewalkPoint(p, 14); }
    }
    var tx, tz;
    if (fleeing && p.panicFrom) {
      var ax = p.x - p.panicFrom.x, az = p.z - p.panicFrom.z;
      var d = Math.sqrt(ax * ax + az * az) || 1;
      tx = p.x + (ax / d) * 10; tz = p.z + (az / d) * 10;
    } else {
      tx = p.target.x; tz = p.target.z;
      if (U.dist2(p.x, p.z, tx, tz) < 1.6) p.target = G.city.randomSidewalkPoint(p, 14);
    }
    var dx = tx - p.x, dz = tz - p.z, len = Math.sqrt(dx * dx + dz * dz) || 1;
    var spd = fleeing ? p.speed * 2.9 : p.speed;
    var nx = p.x + (dx / len) * spd * dt, nz = p.z + (dz / len) * spd * dt;
    var boxes = G.city.queryBoxes(nx - 2, nz - 2, nx + 2, nz + 2);
    U.resolveCircleAABB(nx, nz, p.radius, boxes, _c);
    p.x = U.clamp(_c.x, -G.city.HALF - 8, G.city.HALF + 8);
    p.z = U.clamp(_c.z, -G.city.HALF - 8, G.city.HALF + 8);

    var want = Math.atan2(dx, dz);
    p.yaw = U.turnToward(p.yaw, want, dt * (fleeing ? 7 : 3));
    p.phase += dt * spd * (fleeing ? 6 : 4.2);
    p.obj.position.x = p.x; p.obj.position.z = p.z;
    p.obj.rotation.y = p.yaw;
    p.obj.position.y = G.city.groundY(p.x, p.z);
    if (fleeing) M.panic(p.obj, p.phase);
    else M.animateHuman(p.obj, p.phase, p.walkAmp);

    // pedestrians dodge oncoming cars
    var car = E.carNear(p.x, p.z, 3.4);
    if (car && car.alive) {
      p.state = 'flee'; p.timer = U.rand(1.5, 3); p.panicFrom = { x: car.x, z: car.z };
    }
    if (G.city.night > 0.5 && Math.random() < dt * 0.2) { /* idle chatter placeholder */ }
  }

  function updateCar(car, dt) {
    if (!car.alive) return;
    if (car.driven) {
      // physics handled by player.js; only the visuals live here
      var kmh = Math.abs(car.speed) * 3.6;
      for (var w = 0; w < car.model.wheels.length; w++) car.model.wheels[w].rotation.x += car.speed * dt * 2.2;
      car.kmh = kmh;
      return;
    }
    if (car.crashCooldown > 0) car.crashCooldown -= dt;
    var a = car.ai;
    if (!a) return;                       // police cars are driven by police.js
    var want = car.maxSpeed;
    // look ahead in the lane for cars / the player
    var ahead = 9 + Math.abs(car.speed) * 0.35;
    var px, pz;
    if (a.axis === 'x') { px = car.x + a.dir * ahead; pz = car.z; } else { px = car.x; pz = car.z + a.dir * ahead; }
    for (var i = 0; i < E.cars.length; i++) {
      var o = E.cars[i];
      if (o === car || !o.alive) continue;
      var d = U.dist2(px, pz, o.x, o.z);
      if (d < 7) { want = Math.min(want, Math.max(0, (d - 2.2) * 2.4)); }
    }
    var pl = player.car ? player : null;
    var pdist = U.dist2(px, pz, player.x, player.z);
    if (pdist < 6.5) { want = Math.min(want, Math.max(0, (pdist - 2.4) * 2.5)); if (Math.random() < dt * 1.5) G.audio.horn(); }

    car.speed = U.damp(car.speed, want, 2.2, dt);
    var along = (a.axis === 'x') ? car.x : car.z;
    along += a.dir * car.speed * dt;
    var lim = G.city.HALF + 5;
    if (along > lim) along = -lim + 1; else if (along < -lim) along = lim - 1;
    if (a.axis === 'x') car.x = along; else car.z = along;

    // steer around obstacles that are not in this lane (simple nudge)
    var nudge = 0;
    for (var k = 0; k < E.cars.length; k++) {
      var q = E.cars[k];
      if (q === car || !q.alive || q === (player.car || null)) continue;
      var side = (a.axis === 'x') ? (q.z - car.z) : (q.x - car.x);
      var fwd = (a.axis === 'x') ? (q.x - car.x) * a.dir : (q.z - car.z) * a.dir;
      if (fwd > 0 && fwd < 4.2 && Math.abs(side) < 2.6) nudge -= U.sign(side || 1) * 0.9;
    }
    if (nudge) {
      if (a.axis === 'x') car.z += nudge * dt * 3; else car.x += nudge * dt * 3;
      var centre = -G.city.HALF + a.roadIdx * G.city.BLOCK;
      var off = (a.axis === 'x') ? car.z - centre : car.x - centre;
      off = U.clamp(off, -G.city.ROAD / 2 + 1.1, G.city.ROAD / 2 - 1.1);
      if (a.axis === 'x') car.z = centre + off; else car.x = centre + off;
    }

    for (var w2 = 0; w2 < car.model.wheels.length; w2++) car.model.wheels[w2].rotation.x += car.speed * dt * 2.2;
    syncCar(car);
  }

  // ------------------------------------------------------------------ pickups
  var PICKUP_KINDS = ['health', 'armor', 'ammo', 'cash', 'health', 'ammo'];
  function spawnPickups() {
    for (var i = 0; i < 24; i++) {
      var kind = PICKUP_KINDS[i % PICKUP_KINDS.length];
      var p = G.city.randomSidewalkPoint(null, 0);
      addPickup(kind, p.x, p.z);
    }
    // a couple guaranteed near the spawn
    addPickup('health', 18, 6); addPickup('armor', -12, 14); addPickup('ammo', 8, -16);
  }

  function addPickup(kind, x, z) {
    var mesh = M.pickup(kind);
    mesh.position.set(x, G.city.groundY(x, z), z);
    scene.add(mesh);
    E.pickups.push({ kind: kind, x: x, z: z, mesh: mesh, taken: 0, respawn: 25 + Math.random() * 25 });
  }

  E.collectPickup = function (pk) {
    pk.taken = 1; pk.mesh.visible = false;
    if (pk.kind === 'health') { player.hp = Math.min(100, player.hp + 40); G.hud.toast('+40 HEALTH'); }
    else if (pk.kind === 'armor') { player.armor = Math.min(100, player.armor + 50); G.hud.toast('+50 ARMOR'); }
    else if (pk.kind === 'ammo') { player.giveAmmo(90); G.hud.toast('AMMO'); }
    else { player.cash += 250; G.hud.toast('+$250'); }
    G.audio.pickup();
  };

  // ------------------------------------------------------------------ tick
  E.update = function (dt, t) {
    for (var i = 0; i < E.cars.length; i++) updateCar(E.cars[i], dt);
    for (var j = 0; j < E.peds.length; j++) updatePed(E.peds[j], dt, t);

    // cars vs cars: circle separation so the player can shunt traffic around
    for (var a = 0; a < E.cars.length; a++) {
      var A = E.cars[a];
      if (!A.alive) continue;
      for (var b = a + 1; b < E.cars.length; b++) {
        var B = E.cars[b];
        if (!B.alive) continue;
        var dx = B.x - A.x, dz = B.z - A.z;
        var d2 = dx * dx + dz * dz, rad = 2.5;
        if (d2 < rad * rad && d2 > 1e-6) {
          var d = Math.sqrt(d2), push = (rad - d) / 2;
          var ux = dx / d, uz = dz / d;
          A.x -= ux * push; A.z -= uz * push; B.x += ux * push; B.z += uz * push;
          // closing speed along the contact normal, so cars merely driving
          // side by side at different speeds do not damage each other
          var rel = Math.abs(ux * (Math.sin(B.yaw) * B.speed - Math.sin(A.yaw) * A.speed) +
                             uz * (Math.cos(B.yaw) * B.speed - Math.cos(A.yaw) * A.speed));
          if (rel > 5 && A.crashCooldown <= 0 && B.crashCooldown <= 0) {
            A.crashCooldown = B.crashCooldown = 1.5;
            E.damageCar(A, rel * 1.6, false); E.damageCar(B, rel * 1.6, false);
            fx.impact((A.x + B.x) / 2, 0.8, (A.z + B.z) / 2, 'rgba(255,225,170,1)', 8);
            G.audio.impact(true);
          }
          if (!A.driven) syncCar(A);
          if (!B.driven) syncCar(B);
          if (player.car === A || player.car === B) player.carCrash(rel);
        }
      }
    }

    // keep the alive-ness near the player: recycle distant cars/peds
    for (var c2 = 0; c2 < E.cars.length; c2++) {
      var c = E.cars[c2];
      if (!c.alive || c.driven || c.driver === 'police') continue;
      if (U.dist2(c.x, c.z, player.x, player.z) > 260) placeCarOnRoad(c, null);
      var night = G.city.night;
      for (var hm = 0; hm < c.model.headMats.length; hm++) c.model.headMats[hm].emissiveIntensity = 0.2 + night * 1.5;
      for (var hg = 0; hg < c.model.headGlows.length; hg++) c.model.headGlows[hg].material.opacity = night * 0.8;
      var braking = c.speed < c.maxSpeed * 0.35;
      for (var tm = 0; tm < c.model.tailMats.length; tm++) c.model.tailMats[tm].emissiveIntensity = braking ? 1.6 : 0.3;
    }
    for (var p2 = 0; p2 < E.peds.length; p2++) {
      var pp = E.peds[p2];
      if (pp.alive && U.dist2(pp.x, pp.z, player.x, player.z) > 240) {
        var sp = G.city.randomSidewalkPoint(player, 60);
        pp.x = sp.x; pp.z = sp.z; pp.target = G.city.randomSidewalkPoint(pp, 14);
        pp.obj.position.set(pp.x, 0, pp.z);
      }
    }

    for (var k2 = 0; k2 < E.pickups.length; k2++) {
      var pk = E.pickups[k2];
      if (pk.taken) {
        pk.respawn -= dt;
        if (pk.respawn <= 0) { pk.taken = 0; pk.mesh.visible = true; pk.respawn = 25 + Math.random() * 25; }
        continue;
      }
      pk.mesh.userData.core.rotation.y += dt * 1.6;
      pk.mesh.position.y = G.city.groundY(pk.x, pk.z) + Math.sin(t * 2 + pk.x) * 0.09;
      if (player.onFoot && U.dist2(player.x, player.z, pk.x, pk.z) < 1.9) E.collectPickup(pk);
    }
  };

})(window.G);
