/* Procedural city: road grid with street classes, districts, a coast, robbery
   landmarks, street props and the sky + day/night cycle. Everything static is
   merged into a handful of meshes so a 2 km city still runs at speed. */
(function (G) {
  'use strict';
  var U = G.util;

  var BLOCK = 64;          // road centreline spacing (metres)
  var GRID = 30;           // blocks per axis  -> 1920 m city
  var WORLD = BLOCK * GRID;
  var HALF = WORLD / 2;
  var ROAD = 14;           // ordinary street
  var AVE = 20;            // avenue: two lanes each way
  var HWY = 26;            // ring highway: three lanes each way + median
  var CURB = 0.16;         // sidewalk slab height
  var KERB = 0.42;         // kerb stone width
  var COAST_X = HALF + 7.4;// everything east of this is the sea
  var CELL = 16;           // spatial-hash cell for collision queries

  var city = G.city = {
    BLOCK: BLOCK, ROAD: ROAD, AVE: AVE, HWY: HWY, GRID: GRID, WORLD: WORLD,
    HALF: HALF, CURB: CURB, COAST_X: COAST_X,
    colliders: [], boxes: [], parks: [], windowMats: [], treeMats: [], targets: []
  };

  // ---------------------------------------------------------------- layout math
  function roadW(i) {                       // width of road line i (0..GRID)
    if (i < 0 || i > GRID) return ROAD;
    if (i === 2 || i === GRID - 2) return HWY;
    if (i % 4 === 2) return AVE;
    return ROAD;
  }
  function isMajor(i) { return roadW(i) > ROAD / 2 + 8; }   // avenue or wider
  city.roadW = roadW;
  city.isMajor = isMajor;

  function roadCoord(v) { // nearest road index + distance from its centreline
    var i = Math.round((v + HALF) / BLOCK);
    return { i: i, d: Math.abs(v - (-HALF + i * BLOCK)) };
  }
  city.roadAxis = function (v) {
    var r = roadCoord(v);
    return r.i >= 0 && r.i <= GRID && r.d <= roadW(r.i) / 2;
  };
  city.isRoad = function (x, z) { return city.roadAxis(x) || city.roadAxis(z); };
  city.groundY = function (x, z) { return city.isRoad(x, z) ? 0 : CURB; };
  city.roadHalfAt = function (v) { return roadW(roadCoord(v).i) / 2; };
  city.isWater = function (x, z) { return x > COAST_X; };
  city.intersectionOf = function (x, z) {
    var a = roadCoord(x), b = roadCoord(z);
    if (a.i < 0 || a.i > GRID || b.i < 0 || b.i > GRID) return null;
    if (a.d <= roadW(a.i) / 2 && b.d <= roadW(b.i) / 2) return { i: a.i, j: b.i };
    return null;
  };

  // Flat rectangle a block can use: the block pitch minus the roads around it.
  function slabRect(bx, bz) {
    var x0 = -HALF + bx * BLOCK + roadW(bx) / 2 + KERB;
    var x1 = -HALF + (bx + 1) * BLOCK - roadW(bx + 1) / 2 - KERB;
    var z0 = -HALF + bz * BLOCK + roadW(bz) / 2 + KERB;
    var z1 = -HALF + (bz + 1) * BLOCK - roadW(bz + 1) / 2 - KERB;
    return {
      x0: x0, z0: z0, x1: x1, z1: z1,
      cx: (x0 + x1) / 2, cz: (z0 + z1) / 2,
      hx: (x1 - x0) / 2, hz: (z1 - z0) / 2
    };
  }
  city.slabRect = slabRect;

  function districtAt(cx, cz) {
    if (cx > HALF - BLOCK * 2) return 'beach';
    var d = Math.sqrt(cx * cx + cz * cz) / HALF;
    if (cz > HALF * 0.28 && cx < HALF * 0.05) return 'industrial';
    if (cz < -HALF * 0.34) return 'hills';
    if (d < 0.34) return 'downtown';
    if (d < 0.62) return 'midtown';
    return 'suburb';
  }
  city.districtAt = districtAt;

  // A point in the middle of a driving lane (right-hand traffic), plus a heading.
  city.randomRoadPoint = function (avoid, minDist) {
    for (var tries = 0; tries < 40; tries++) {
      var along = U.rand(-HALF + 6, HALF - 6), i = U.randInt(0, GRID);
      var dir = U.rng() < 0.5 ? 1 : -1;
      var lane = dir * (roadW(i) / 4);
      var c = -HALF + i * BLOCK;
      var onX = U.rng() < 0.5;
      var p = onX
        ? { x: along, z: c + (dir > 0 ? lane : -lane), yaw: dir > 0 ? Math.PI / 2 : -Math.PI / 2 }
        : { x: c + (dir > 0 ? -lane : lane), z: along, yaw: dir > 0 ? 0 : Math.PI };
      if (p.x > COAST_X - 10) continue;
      if (!avoid || U.dist2(p.x, p.z, avoid.x, avoid.z) > minDist) return p;
    }
    return { x: 0, z: 0, yaw: 0 };
  };

  // true when a body standing at x,z would start inside a solid box
  function spotBlocked(x, z) {
    var list = city.queryBoxes(x - 0.8, z - 0.8, x + 0.8, z + 0.8);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (x > b.minX - 0.8 && x < b.maxX + 0.8 && z > b.minZ - 0.8 && z < b.maxZ + 0.8 && b.minY < CURB + 1.9) return true;
    }
    return false;
  }
  city.spotBlocked = spotBlocked;

  // A walkable point on a block's sidewalk: outside the building footprint,
  // inside the kerb. Used to place and retarget pedestrians.
  city.randomSidewalkPoint = function (avoid, minDist) {
    var last = null;
    for (var t = 0; t < 60; t++) {
      var bx = U.randInt(0, GRID - 1), bz = U.randInt(0, GRID - 1);
      var s = slabRect(bx, bz);
      if (city.isWater(s.cx + s.hx, s.cz)) continue;
      var inner = Math.max(4, Math.min(s.hx, s.hz) - 4.6);
      var mx = Math.max(1.5, s.hx - 1), mz = Math.max(1.5, s.hz - 1);
      var edge = U.randInt(0, 3), x, z;
      var rx = U.lerp(inner + 0.8, mx, U.rng()), rz = U.lerp(inner + 0.8, mz, U.rng());
      if (edge === 0) { x = s.cx + U.rand(-mx, mx); z = s.cz - rz; }
      else if (edge === 1) { x = s.cx + rx; z = s.cz + U.rand(-mz, mz); }
      else if (edge === 2) { x = s.cx + U.rand(-mx, mx); z = s.cz + rz; }
      else { x = s.cx - rx; z = s.cz + U.rand(-mz, mz); }
      if (spotBlocked(x, z)) continue;
      last = { x: x, z: z };
      if (!avoid || U.dist2(x, z, avoid.x, avoid.z) > minDist) return last;
    }
    if (last) return last;
    return city.randomRoadPoint(avoid, minDist);
  };

  // ---------------------------------------------------------------- spatial hash
  var buckets = {};
  function key(ix, iz) { return ix * 1000 + iz; }
  function boxIndex(b) {
    for (var ix = Math.floor(b.minX / CELL); ix <= Math.floor(b.maxX / CELL); ix++)
      for (var iz = Math.floor(b.minZ / CELL); iz <= Math.floor(b.maxZ / CELL); iz++) {
        var k = key(ix, iz);
        (buckets[k] || (buckets[k] = [])).push(b);
      }
  }
  var _near = [];
  city.queryBoxes = function (minX, minZ, maxX, maxZ) {
    _near.length = 0;
    var seen = {};
    for (var ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++)
      for (var iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        var list = buckets[key(ix, iz)];
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          var b = list[i];
          if (seen[b.id] || b.kind === 'park') continue;   // park slabs are walkable
          seen[b.id] = 1; _near.push(b);
        }
      }
    return _near;
  };

  // Sample-march line of sight against building boxes + a height ceiling.
  city.segmentBlocked = function (ax, ay, az, bx, by, bz) {
    var dx = bx - ax, dz = bz - az, dy = by - ay;
    var len = Math.sqrt(dx * dx + dz * dz);
    var steps = Math.min(48, Math.max(3, Math.ceil(len / 4)));
    for (var s = 1; s < steps; s++) {
      var t = s / steps;
      var x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      var list = city.queryBoxes(x - 1, z - 1, x + 1, z + 1);
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < b.maxY && y > b.minY) return true;
      }
    }
    return false;
  };

  city.addBox = function (minX, minY, minZ, maxX, maxY, maxZ, kind) {
    var b = { id: city.boxes.length, minX: minX, minY: minY, minZ: minZ, maxX: maxX, maxY: maxY, maxZ: maxZ, kind: kind || 'building' };
    city.boxes.push(b);
    if (b.kind === 'building') { boxIndex(b); city.colliders.push(b); }
    return b;
  };

  // ---------------------------------------------------------------- build
  var unitPlane = new THREE.PlaneGeometry(1, 1);
  var bMerges = null, roofMerge = null, roofMat = null, mastMerge = null, metalMat = null;

  city.build = function (scene) {
    var groups = new THREE.Group();
    groups.name = 'city';
    scene.add(groups);
    city.groups = groups;
    initBuildingMats();
    var rng = U.rng;

    var roadTex = U.roadTexture();
    var walkMat = new THREE.MeshStandardMaterial({ map: U.paveTexture(), roughness: 0.92, metalness: 0.02 });
    var curbMat = new THREE.MeshStandardMaterial({ color: 0xb6b3aa, roughness: 0.9 });
    var paintMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 });
    var paintMatY = new THREE.MeshStandardMaterial({ color: 0xe3c249, roughness: 0.7 });

    // ---- ground: land west of the shore, open sea to the east ----
    var landW = COAST_X + WORLD * 2;
    var gTex = U.grassTexture(); gTex.repeat.set(landW / 140, WORLD * 4 / 140);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(landW, WORLD * 4),
      new THREE.MeshStandardMaterial({ map: gTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(COAST_X - landW / 2, -0.02, 0);
    ground.receiveShadow = true;
    groups.add(ground);

    var sea = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 3, WORLD * 4.4),
      new THREE.MeshStandardMaterial({ color: 0x1c4f72, roughness: 0.13, metalness: 0.55 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(COAST_X + WORLD * 1.5, 0.05, 0);
    groups.add(sea);

    // sea wall: the promenade's eastern kerb, and the city's edge for vehicles
    var wallH = 1.05, wallW = 1.2, wallL = WORLD + 90;
    var wall = new THREE.Mesh(new THREE.BoxGeometry(wallW, wallH, wallL), curbMat);
    wall.position.set(COAST_X + wallW / 2, wallH / 2, 0);
    wall.castShadow = true; wall.receiveShadow = true;
    groups.add(wall);
    city.addBox(COAST_X, 0, -wallL / 2, COAST_X + wallW, wallH, wallL / 2, 'building');
    city.wallX = COAST_X;

    // ---- asphalt: every road line, merged by material ----
    var asphalt = U.merge();
    var TILE = 0.22;
    var roadX0 = -HALF - 40, roadX1 = COAST_X;
    for (var li = 0; li <= GRID; li++) {
      var lc = -HALF + li * BLOCK, lw = roadW(li);
      asphalt.plate(roadX1 - roadX0, lw, (roadX0 + roadX1) / 2, 0.01, lc, 0, TILE);
      asphalt.plate(lw, WORLD + 80, lc, 0.014, 0, 0, TILE);
    }
    var roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.93, metalness: 0.03 });
    var roadMesh = new THREE.Mesh(asphalt.build(), roadMat);
    roadMesh.receiveShadow = true;
    groups.add(roadMesh);

    // ---- painted markings, merged by colour ----
    var white = U.merge(), yellow = U.merge();
    for (var mi = 0; mi <= GRID; mi++) {
      var mc = -HALF + mi * BLOCK, mw = roadW(mi), mh = mw / 2;
      var lanes = mw <= 16 ? 1 : (mw <= 22 ? 2 : 3);
      var hwy = mw >= HWY;
      var gap = mh + 4.0;
      for (var span = 0; span < GRID; span++) {
        var a = -HALF + span * BLOCK + gap, b = -HALF + (span + 1) * BLOCK - gap;
        if (b - a < 5) continue;
        var mid = (a + b) / 2, len = b - a;
        white.plate(len, 0.15, mid, 0.035, mc - mh + 0.5, 0, 0);
        white.plate(len, 0.15, mid, 0.035, mc + mh - 0.5, 0, 0);
        white.plate(0.15, len, mc - mh + 0.5, 0.035, mid, 0, 0);
        white.plate(0.15, len, mc + mh - 0.5, 0.035, mid, 0, 0);
        if (!hwy) {
          yellow.plate(len, 0.12, mid, 0.035, mc - 0.2, 0, 0);
          yellow.plate(len, 0.12, mid, 0.035, mc + 0.2, 0, 0);
          yellow.plate(0.12, len, mc - 0.2, 0.035, mid, 0, 0);
          yellow.plate(0.12, len, mc + 0.2, 0.035, mid, 0, 0);
        }
        for (var lk = 1; lk < lanes; lk++) {
          var off = (lk * mw) / (2 * lanes);
          for (var d = a + 2; d < b - 5; d += 9) {
            var c2 = d + 1.7;
            white.plate(3.4, 0.14, c2, 0.035, mc + off, 0, 0);
            white.plate(3.4, 0.14, c2, 0.035, mc - off, 0, 0);
            white.plate(0.14, 3.4, mc + off, 0.035, c2, 0, 0);
            white.plate(0.14, 3.4, mc - off, 0.035, c2, 0, 0);
          }
        }
      }
    }
    // zebra crossings on the four approaches to every major intersection
    for (var gi = 0; gi <= GRID; gi++) {
      for (var gj = 0; gj <= GRID; gj++) {
        if (!isMajor(gi) || !isMajor(gj)) continue;
        var ix = -HALF + gi * BLOCK, iz = -HALF + gj * BLOCK;
        var mhx = roadW(gi) / 2, mhz = roadW(gj) / 2;
        var crossX = mhx + 1.5, crossZ = mhz + 1.5;
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          for (var zk = -6; zk <= 6; zk++) {
            var kk2 = zk * 1.05;
            if (Math.abs(kk2) < mhz - 0.7) white.plate(0.55, 2.6, ix + sgn * crossX, 0.035, iz + kk2, 0, 0);
            if (Math.abs(kk2) < mhx - 0.7) white.plate(2.6, 0.55, ix + kk2, 0.035, iz + sgn * crossZ, 0, 0);
          }
        }
      }
    }
    groups.add(new THREE.Mesh(white.build(), paintMat));
    groups.add(new THREE.Mesh(yellow.build(), paintMatY));

    // ---- decide parks and robbery landmarks before the block loop ----
    var parkAt = {}, targetAt = {};
    for (var pbx = 0; pbx < GRID; pbx++) {
      for (var pbz = 0; pbz < GRID; pbz++) {
        var ps = slabRect(pbx, pbz);
        var pdist = districtAt(ps.cx, ps.cz);
        if (pdist !== 'beach' && rng() < 0.05) parkAt[pbx + '_' + pbz] = 1;
      }
    }
    function placeTargets(kind, n, ok) {
      var placed = 0, guard = 0;
      while (placed < n && guard++ < 6000) {
        var bx = U.randInt(1, GRID - 2), bz = U.randInt(1, GRID - 2);
        var s = slabRect(bx, bz), d = districtAt(s.cx, s.cz);
        if (!ok(d)) continue;
        var k = bx + '_' + bz;
        if (parkAt[k] || targetAt[k]) continue;
        var crowded = false;
        for (var t in targetAt) {
          var pp = t.split('_');
          if (Math.abs(Number(pp[0]) - bx) + Math.abs(Number(pp[1]) - bz) < 3) { crowded = true; break; }
        }
        if (crowded) continue;
        targetAt[k] = kind;
        placed++;
      }
    }
    placeTargets('bank', 4, function (d) { return d === 'downtown' || d === 'midtown'; });
    placeTargets('jeweller', 6, function (d) { return d === 'midtown' || d === 'suburb'; });
    placeTargets('store', 10, function (d) { return d !== 'beach'; });
    placeTargets('atm', 6, function (d) { return d === 'downtown' || d === 'midtown' || d === 'suburb'; });

    // ---- slabs, kerbs, parks, beach, buildings ----
    var walk = U.merge(), parkSlabs = U.merge(), sand = U.merge(), curbs = U.merge();
    var sandMat = new THREE.MeshStandardMaterial({ map: U.sandTexture(), roughness: 1 });
    var parkMat = new THREE.MeshStandardMaterial({ map: U.grassTexture(), roughness: 1 });
    var kerbH = CURB + 0.03;
    for (var bx = 0; bx < GRID; bx++) {
      for (var bz = 0; bz < GRID; bz++) {
        var s = slabRect(bx, bz);
        var d = districtAt(s.cx, s.cz);
        var key2 = bx + '_' + bz;
        var beachBlock = d === 'beach';
        if (beachBlock) sand.plate(s.hx * 2, s.hz * 2, s.cx, CURB, s.cz, 0, 0.25);
        else if (parkAt[key2]) parkSlabs.plate(s.hx * 2, s.hz * 2, s.cx, CURB, s.cz, 0, 0.14);
        else walk.plate(s.hx * 2, s.hz * 2, s.cx, CURB, s.cz, 0, 0.42);

        curbs.box(s.hx * 2 + KERB * 2, kerbH, KERB, s.cx, kerbH / 2, s.z0 - KERB / 2);
        curbs.box(s.hx * 2 + KERB * 2, kerbH, KERB, s.cx, kerbH / 2, s.z1 + KERB / 2);
        curbs.box(KERB, kerbH, s.hz * 2, s.x0 - KERB / 2, kerbH / 2, s.cz);
        curbs.box(KERB, kerbH, s.hz * 2, s.x1 + KERB / 2, kerbH / 2, s.cz);

        if (beachBlock) { addBeach(s); continue; }
        if (parkAt[key2]) { addPark(s.cx, s.cz, Math.min(s.hx, s.hz) - 1.6); continue; }
        if (targetAt[key2]) { addLandmark(targetAt[key2], s); continue; }
        layoutBlock(s, d);
      }
    }
    groups.add(new THREE.Mesh(walk.build(), walkMat));
    if (parkSlabs.count()) groups.add(new THREE.Mesh(parkSlabs.build(), parkMat));
    if (sand.count()) groups.add(new THREE.Mesh(sand.build(), sandMat));
    groups.add(new THREE.Mesh(curbs.build(), curbMat));
    if (trunkMerge && trunkMerge.count()) {
      var tmesh = new THREE.Mesh(trunkMerge.build(), treeWoodMat);
      tmesh.castShadow = true; tmesh.receiveShadow = true;
      groups.add(tmesh);
    }
    if (crownMerge && crownMerge.count()) {
      var cmesh = new THREE.Mesh(crownMerge.build(), treeLeafMat);
      cmesh.castShadow = true; cmesh.receiveShadow = true;
      groups.add(cmesh);
    }

    // ---- building merge meshes ----
    var bi;
    for (bi = 0; bi < bMerges.length; bi++) {
      if (!bMerges[bi].count()) continue;
      var bmesh = new THREE.Mesh(bMerges[bi].build(), buildingMats[bi]);
      bmesh.castShadow = true; bmesh.receiveShadow = true;
      groups.add(bmesh);
    }
    if (roofMerge.count()) {
      var rmesh = new THREE.Mesh(roofMerge.build(), roofMat);
      rmesh.castShadow = true; rmesh.receiveShadow = true;
      groups.add(rmesh);
    }
    if (mastMerge.count()) groups.add(new THREE.Mesh(mastMerge.build(), metalMat));
    flushLandmarks(groups);

    // ---- street lights + traffic signals on the major roads ----
    buildLamps(groups);
    buildTraffic(groups);

    // ---- robbery markers ----
    buildMarker(groups);
    buildSky(scene);
    return city;
  };

  // ---------------------------------------------------------------- buildings
  var buildingMats = null;
  var unitCyl = null, unitMast = null, unitIco = null, unitFrond = null;
  function initBuildingMats() {
    if (buildingMats) return;
    buildingMats = [];
    bMerges = [];
    var tints = [0xbfc6cc, 0xa9b3bb, 0xcfc3b4, 0x9aa7b4, 0xc9b9ae, 0xb4c2c0];
    for (var i = 0; i < 6; i++) {
      var tex = U.buildingTextures(4, 6);
      var m = new THREE.MeshStandardMaterial({
        map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff,
        emissiveIntensity: 0, roughness: 0.72, metalness: 0.12, color: tints[i]
      });
      buildingMats.push(m);
      city.windowMats.push(m);
      bMerges.push(U.merge());
    }
    roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.95 });
    metalMat = new THREE.MeshStandardMaterial({ color: 0x5d646c, metalness: 0.6, roughness: 0.5 });
    roofMerge = U.merge();
    mastMerge = U.merge();
    trunkMerge = U.merge();
    crownMerge = U.merge();
    unitMast = new THREE.CylinderGeometry(0.12, 0.2, 10, 5, 1, true);
    unitIco = new THREE.IcosahedronGeometry(1.5, 0);
  }

  function composeMat(x, y, z, yaw, sx, sy, sz) {
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw || 0, 0)),
      new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz));
  }

  function makeBuilding(x, z, w, d, h, district) {
    initBuildingMats();
    var mi = U.randInt(0, 5);
    if (district === 'industrial') mi = U.randInt(2, 4);
    if (district === 'hills') mi = U.randInt(3, 5);
    var yc = CURB + h / 2;
    bMerges[mi].uvBox(w, h, d, x, yc, z, 4, 4, [1, 1, 0, 0, 1, 1]);
    roofMerge.uvBox(w, h, d, x, yc, z, 1, 1, [0, 0, 1, 0, 0, 0]);
    city.addBox(x - w / 2, CURB, z - d / 2, x + w / 2, CURB + h, z + d / 2, 'building');

    if (h > 26 && w > 8 && d > 8) {          // rooftop clutter
      var n = U.randInt(1, 3);
      for (var i = 0; i < n; i++) {
        var bw = U.rand(1.6, w * 0.3), bd = U.rand(1.6, d * 0.3), bh = U.rand(1.2, 3);
        roofMerge.uvBox(bw, bh, bd, x + U.rand(-w / 2 + bw, w / 2 - bw), CURB + h + bh / 2,
          z + U.rand(-d / 2 + bd, d / 2 - bd), 1, 1);
      }
    }
    if (h > 70) mastMerge.raw(unitMast, composeMat(x, CURB + h + 5, z, 0, 1, 1, 1));
  }

  function layoutBlock(s, district) {
    var r = U.rng;
    var reach = Math.min(s.hx, s.hz) - 1.5;
    var pattern;
    if (district === 'downtown') pattern = r() < 0.6 ? 0 : 3;
    else if (district === 'industrial') pattern = r() < 0.55 ? 0 : 2;
    else if (district === 'hills') pattern = 3;
    else pattern = r() < 0.28 ? 1 : (r() < 0.6 ? 2 : 3);
    var cells = pattern === 0 ? [[0, 0, 1, 1]]
      : pattern === 1 ? [[-0.5, 0, 0.5, 1], [0.5, 0, 0.5, 1]]
      : pattern === 2 ? [[0, -0.5, 1, 0.5], [0, 0.5, 1, 0.5]]
      : [[-0.5, -0.5, 0.5, 0.5], [0.5, -0.5, 0.5, 0.5], [-0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
    var band = district === 'downtown' ? [30, 105]
      : district === 'midtown' ? [14, 46]
      : district === 'suburb' ? [9, 26]
      : district === 'hills' ? [6, 13]
      : [7, 18];
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var gapAB = cells.length > 1 ? (district === 'downtown' ? 0.8 : 2.6) : 0;
      var inset = U.rand(0, 1.2) + gapAB;
      var w = c[2] * reach * 2 - inset, d = c[3] * reach * 2 - inset;
      if (w < 3 || d < 3) continue;
      var px = s.cx + c[0] * reach, pz = s.cz + c[1] * reach;
      var h = U.rand(band[0], band[1]);
      if (district === 'downtown' && r() < 0.22) h = Math.max(h, U.rand(100, 152));
      makeBuilding(px, pz, w, d, h, district);
      if (r() < (district === 'downtown' ? 0.25 : 0.1)) {
        makeBuilding(px + U.rand(-2, 2), pz + U.rand(-2, 2), w * 0.3, d * 0.3, h + U.rand(3, 10), district);
      }
    }
  }

  // ---------------------------------------------------------------- landmarks
  var TARGETS = {
    bank: { name: 'BANK', hint: 'HOLD UP THE BANK', loot: 6500, secs: 11, heat: 4.2,
      sign: ['BANK', '#12233d', '#f4d873'], body: 0xffffff, su: 3.2, w: 0.92, d: 0.72, h: [10, 14], stone: true },
    jeweller: { name: 'JEWELLER', hint: 'ROB THE JEWELLER', loot: 2800, secs: 7.5, heat: 3.0,
      sign: ['JEWELLER', '#3a1020', '#ffe9a8'], body: 0x7a3348, su: 2.2, w: 0.78, d: 0.68, h: [8, 11] },
    store: { name: '24/7', hint: 'ROB THE STORE', loot: 950, secs: 5, heat: 2.0,
      sign: ['24/7', '#123c2a', '#d8ffe8'], body: 0x2f7d5f, su: 2.2, w: 0.72, d: 0.62, h: [6, 9] },
    atm: { name: 'ATM', hint: 'CRACK THE ATM', loot: 320, secs: 2.5, heat: 1.2,
      sign: ['ATM', '#20303f', '#a8d8ff'], body: 0x35506b, su: 1.6, w: 0.3, d: 0.3, h: [3, 3.4] }
  };
  var lmMerges = {}, lmMats = {}, signMerges = {}, signMats = {};
  function lm(kind) { return lmMerges[kind] || (lmMerges[kind] = U.merge()); }
  function lmMaterial(kind, T) {
    if (!lmMats[kind]) {
      var opts = { color: T.body, roughness: 0.82, metalness: 0.06 };
      if (T.stone) { opts.map = U.stoneTexture(); opts.roughness = 0.88; opts.metalness = 0.02; }
      lmMats[kind] = new THREE.MeshStandardMaterial(opts);
    }
    return lmMats[kind];
  }
  function signMerge(kind, T) {
    if (!signMerges[kind]) {
      signMerges[kind] = U.merge();
      signMats[kind] = new THREE.MeshStandardMaterial({
        map: U.signTexture(T.sign[0], T.sign[1], T.sign[2]), roughness: 0.55, metalness: 0.04
      });
    }
    return signMerges[kind];
  }

  function addLandmark(kind, s) {
    initBuildingMats();
    var T = TARGETS[kind], r = U.rng;
    var yaw, w, d, h, cx, cz;
    if (kind === 'atm') {
      yaw = Math.PI;
      w = 3.4; d = 2.6; h = U.rand(T.h[0], T.h[1]);
      cx = s.cx + U.rand(-(s.hx - 4), s.hx - 4);
      cz = s.z0 + 3.4;
    } else {
      yaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][U.randInt(0, 3)];
      w = Math.min(2 * s.hx * T.w, 2 * s.hx - 7);
      d = Math.min(2 * s.hz * T.d, 2 * s.hz - 7);
      h = U.rand(T.h[0], T.h[1]);
      cx = s.cx; cz = s.cz;
      if (r() < 0.4) h += U.rand(2, 6);                      // a few storeys taller
    }
    var nx = Math.sin(yaw), nz = Math.cos(yaw);
    var front = Math.abs(nz) * d / 2 + Math.abs(nx) * w / 2;
    var mx = cx + nx * (front + 1.9), mz = cz + nz * (front + 1.9);
    lmMaterial(kind, T);
    lm(kind).uvBox(w, h, d, cx, CURB + h / 2, cz, T.su, T.su, [1, 1, 0, 0, 1, 1]);
    roofMerge.uvBox(w, h, d, cx, CURB + h / 2, cz, 1, 1, [0, 0, 1, 0, 0, 0]);
    city.addBox(cx - w / 2, CURB, cz - d / 2, cx + w / 2, CURB + h, cz + d / 2, 'building');

    var doorW = Math.min(3.6, w * 0.34), doorH = Math.min(3.0, h * 0.62);
    lm('dark').box(doorW, doorH, 0.4, cx + nx * (front - 0.06), CURB + doorH / 2, cz + nz * (front - 0.06), 0, yaw, 0);
    signMerge(kind, T).raw(unitPlane, composeMat(cx + nx * (front + 0.07), CURB + doorH + 1.25,
      cz + nz * (front + 0.07), yaw, Math.min(w * 0.6, 10), 1.7, 1));

    city.targets.push({
      kind: kind, name: T.name, hint: T.hint, loot: T.loot, secs: T.secs, heat: T.heat,
      x: mx, z: mz, yaw: yaw, robbed: 0, cool: 0
    });
  }

  function flushLandmarks(groups) {
    if (lmMats.dark === undefined) lmMats.dark = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.5, metalness: 0.3 });
    for (var kind in lmMerges) {
      if (!lmMerges[kind].count()) continue;
      var mat = kind === 'dark' ? lmMats.dark : lmMats[kind];
      var mesh = new THREE.Mesh(lmMerges[kind].build(), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      groups.add(mesh);
    }
    for (var sk in signMerges) {
      if (!signMerges[sk].count()) continue;
      groups.add(new THREE.Mesh(signMerges[sk].build(), signMats[sk]));
    }
  }

  // ---------------------------------------------------------------- greenery
  var trunkMerge = null, crownMerge = null, treeLeafMat = null, treeWoodMat = null;
  function ensureGreen() {
    initBuildingMats();
    if (!treeLeafMat) {
      treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x35592e, roughness: 1, flatShading: true });
      treeWoodMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
      city.treeMats.push(treeLeafMat);
      unitCyl = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6, 1, true);
      unitFrond = new THREE.BoxGeometry(2.4, 0.18, 0.5);
    }
  }
  function addTree(x, z, sc) {
    ensureGreen();
    trunkMerge.raw(unitCyl, composeMat(x, CURB + 1.2 * sc, z, 0, sc, sc, sc));
    crownMerge.raw(unitIco, composeMat(x, CURB + 3.4 * sc, z, U.rand(0, 3), sc, sc * 1.25, sc));
  }
  function addPalm(x, z, sc) {
    ensureGreen();
    trunkMerge.raw(unitCyl, composeMat(x, CURB + 2.4 * sc, z, 0, sc * 0.9, sc * 2.0, sc * 0.9));
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2 + U.rand(-0.2, 0.2);
      crownMerge.raw(unitFrond, composeMat(x + Math.cos(a) * 1.1 * sc, CURB + 5.0 * sc, z + Math.sin(a) * 1.1 * sc, -a, sc, sc, sc));
    }
  }
  function addPark(cx, cz, rad) {
    city.parks.push({ x: cx, z: cz, r: rad });
    var n = 7;
    for (var i = 0; i < n; i++) {
      var a = U.rand(0, Math.PI * 2), d = U.rand(3, Math.max(4, rad - 2.5));
      addTree(cx + Math.cos(a) * d, cz + Math.sin(a) * d, U.rand(0.85, 1.4));
    }
    city.addBox(cx - rad, CURB, cz - rad, cx + rad, 6, cz + rad, 'park');
  }
  function addBeach(s) {
    var n = U.randInt(3, 6);
    for (var i = 0; i < n; i++) {
      var x = s.cx + U.rand(-s.hx + 2, s.hx - 2), z = s.cz + U.rand(-s.hz + 2, s.hz - 2);
      if (i % 3 === 0) addPalm(x, z, U.rand(1.0, 1.5));
      else addTree(x, z, U.rand(0.7, 1.0));
    }
  }

  // ---------------------------------------------------------------- street lights
  function buildLamps(groups) {
    initBuildingMats();
    var poles = U.merge(), heads = U.merge();
    var poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 6, 6, 1, true);
    for (var i = 0; i <= GRID; i++) {
      if (!isMajor(i)) continue;
      var c = -HALF + i * BLOCK, w = roadW(i), off = w / 2 + 0.9;
      for (var k = 0; k < GRID; k++) {
        var t = -HALF + (k + 0.5) * BLOCK;
        if (t < COAST_X - 6) {
          lampAt(poles, heads, poleGeo, t, c - off, 0, 1);
          lampAt(poles, heads, poleGeo, t, c + off, 0, -1);
        }
        if (c < COAST_X - 8) {
          lampAt(poles, heads, poleGeo, c - off, t, 1, 0);
          lampAt(poles, heads, poleGeo, c + off, t, -1, 0);
        }
      }
    }
    groups.add(new THREE.Mesh(poles.build(), metalMat));
    city.lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffe9b0, emissiveIntensity: 0.15 });
    var hm = new THREE.Mesh(heads.build(), city.lampHeadMat);
    groups.add(hm);
  }
  function lampAt(poles, heads, geo, x, z, ox, oz) {
    poles.raw(geo, composeMat(x, 3, z, 0, 1, 1, 1));
    var hx = ox !== 0 ? 2.4 : 0.6, hz = oz !== 0 ? 2.4 : 0.6;
    heads.box(hx, 0.22, hz, x + ox * 1.0, 5.95, z + oz * 1.0);
  }

  // ---------------------------------------------------------------- traffic signals
  var _bulbCol = null, _bulbOff = 0x151515;
  function buildTraffic(groups) {
    initBuildingMats();
    var poles = U.merge();
    var poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 4.4, 6, 1, true);
    var positions = [];
    for (var i = 0; i <= GRID; i++) {
      if (!isMajor(i)) continue;
      for (var j = 0; j <= GRID; j++) {
        if (!isMajor(j)) continue;
        var x = -HALF + i * BLOCK, z = -HALF + j * BLOCK;
        var ox = roadW(i) / 2 + 0.7, oz = roadW(j) / 2 + 0.7;
        poles.raw(poleGeo, composeMat(x + ox, 2.2, z + oz, 0, 1, 1, 1));
        for (var k = 0; k < 3; k++) positions.push(x + ox, 4.0 - k * 0.42, z + oz + 0.05);
      }
    }
    if (poles.count()) groups.add(new THREE.Mesh(poles.build(), metalMat));

    var bulbGeo = new THREE.SphereGeometry(0.16, 8, 6);
    var bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, positions.length / 3));
    var m = new THREE.Matrix4();
    for (var b = 0; b < positions.length / 3; b++) {
      m.makeTranslation(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]);
      bulbs.setMatrixAt(b, m);
      bulbs.setColorAt(b, new THREE.Color(_bulbOff));
    }
    bulbs.instanceMatrix.needsUpdate = true;
    if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
    bulbs.count = positions.length / 3;
    groups.add(bulbs);
    city.bulbs = bulbs;
    _bulbCol = new THREE.Color();
    setTrafficPhase(0);
  }
  // kind order along each pole is red (0), yellow (1), green (2)
  function setTrafficPhase(on) {
    if (!city.bulbs) return;
    var n = city.bulbs.count;
    for (var i = 0; i < n; i++) {
      var kind = i % 3;
      var lit = (kind === on);
      _bulbCol.setHex(lit ? (kind === 0 ? 0xff2d2d : kind === 1 ? 0xffc32d : 0x39e05a) : _bulbOff);
      city.bulbs.setColorAt(i, _bulbCol);
    }
    if (city.bulbs.instanceColor) city.bulbs.instanceColor.needsUpdate = true;
  }
  city.setTrafficPhase = setTrafficPhase;

  // ---------------------------------------------------------------- robbery marker
  function buildMarker(groups) {
    var g = new THREE.Group();
    g.visible = false;
    var ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.15, 22),
      new THREE.MeshBasicMaterial({ color: 0xffd447, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = CURB + 0.06;
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 7, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd447, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = CURB + 3.5;
    g.add(ring); g.add(beam);
    groups.add(g);
    city.marker = {
      group: g,
      set: function (x, z) {
        if (g.position.x !== x || g.position.z !== z) { ring.scale.set(1, 1, 1); }
        g.position.set(x, 0, z);
        g.visible = true;
      },
      hide: function () { g.visible = false; },
      pulse: function (t) { var k = 1 + Math.sin(t * 3.2) * 0.07; ring.scale.set(k, k, 1); }
    };
  }




  // ---------------------------------------------------------------- sky, sun, time
  var skyMesh = null, skyU = null, stars = null, sunSpr = null, moonSpr = null, sunLight = null, hemi = null;
  var shadowAt = { x: 0, z: 0 };
  var trafficPhase = -1;
  city.night = 0;
  city.shadowAt = function (x, z) { shadowAt.x = x; shadowAt.z = z; };

  function buildSky(scene) {
    skyU = {
      top: { value: new THREE.Color(0x2b6fd6) },
      bottom: { value: new THREE.Color(0xbfd9f2) },
      offset: { value: 120 }, exponent: { value: 0.85 }
    };
    skyMesh = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 20),
      new THREE.ShaderMaterial({
        uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform float offset; uniform float exponent;' +
          'varying vec3 vP; void main(){ float h = normalize(vP + vec3(0.0,offset,0.0)).y;' +
          'gl_FragColor = vec4(mix(bottom, top, pow(max(h,0.0), exponent)), 1.0); }'
      }));
    scene.add(skyMesh);

    var sp = [], sc = [];
    for (var i = 0; i < 1400; i++) {
      var v = new THREE.Vector3().setFromSphericalCoords(2000, Math.acos(U.rand(-0.1, 1)), U.rand(0, Math.PI * 2));
      sp.push(v.x, v.y, v.z);
      var b = U.rand(0.5, 1);
      sc.push(b, b, b * 1.05);
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 10, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    scene.add(stars);

    sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: U.glowTexture('rgba(255,248,215,1)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sunSpr.scale.set(430, 430, 1);
    scene.add(sunSpr);
    moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: U.glowTexture('rgba(215,232,255,1)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    moonSpr.scale.set(210, 210, 1);
    scene.add(moonSpr);

    sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    var cam = sunLight.shadow.camera;
    cam.left = -80; cam.right = 80; cam.top = 80; cam.bottom = -80; cam.near = 1; cam.far = 620;
    sunLight.shadow.bias = -0.0007;
    scene.add(sunLight);
    scene.add(sunLight.target);

    hemi = new THREE.HemisphereLight(0x88bbff, 0x2a2f22, 0.6);
    scene.add(hemi);
    city.sunLight = sunLight;
    city.hemi = hemi;
  }

  // t: 0..24 hours
  city.setTime = function (t, scene) {
    var a = (t / 24) * Math.PI * 2 - Math.PI / 2;
    var el = Math.sin(a);
    var day = U.clamp(el * 2.2 + 0.22, 0, 1);
    city.night = 1 - day;

    sunLight.position.set(shadowAt.x + Math.cos(a) * 300, el * 320 + 60, shadowAt.z + 130);
    sunLight.target.position.set(shadowAt.x, 0, shadowAt.z);
    sunLight.intensity = U.lerp(0.04, 1.5, day);
    sunLight.color.setHSL(U.lerp(0.08, 0.14, day), U.lerp(0.75, 0.25, day), U.lerp(0.55, 0.95, day));
    hemi.intensity = U.lerp(0.18, 0.75, day);
    hemi.color.setHSL(0.6, 0.5, U.lerp(0.06, 0.55, day));
    hemi.groundColor.setHSL(0.08, 0.3, U.lerp(0.03, 0.25, day));

    var dusk = U.clamp(1 - Math.abs(el) * 3.2, 0, 1);
    skyU.top.value.setHSL(0.62, 0.55, U.lerp(0.045, 0.36, day));
    skyU.top.value.lerp(_cA.setHSL(0.03, 0.7, 0.35), dusk * 0.5);
    skyU.bottom.value.setHSL(0.58, 0.45, U.lerp(0.07, 0.78, day));
    skyU.bottom.value.lerp(_cA.setHSL(0.06, 0.85, 0.5), dusk * 0.75);

    stars.material.opacity = U.clamp(city.night * 1.4 - 0.35, 0, 0.95);
    stars.rotation.y += 0.0006;
    sunSpr.position.set(Math.cos(a) * 1600, el * 1150, 760);
    sunSpr.material.opacity = U.clamp(el * 3 + 0.3, 0, 1);
    moonSpr.position.set(-Math.cos(a) * 1600, -el * 1150, -760);
    moonSpr.material.opacity = U.clamp(-el * 3 + 0.2, 0, 0.9);

    var winOn = U.clamp(city.night * 1.6 - 0.25, 0, 1);
    for (var i = 0; i < city.windowMats.length; i++) city.windowMats[i].emissiveIntensity = winOn * 0.9;
    if (city.lampHeadMat) city.lampHeadMat.emissiveIntensity = 0.15 + winOn * 1.9;

    var phase = Math.floor((t * 3600) / 20 + 3) % 3;      // red / amber / green, 20 s each
    if (phase !== trafficPhase) { trafficPhase = phase; setTrafficPhase(phase); }
  };

  var _cA = new THREE.Color();

  city.districtName = function (x, z) {
    var d = districtAt(x, z);
    return d === 'downtown' ? 'DOWNTOWN'
      : d === 'midtown' ? 'MIDTOWN'
      : d === 'hills' ? 'MIRABEL HILLS'
      : d === 'industrial' ? 'DOCKSIDE'
      : d === 'beach' ? 'PALMA BEACH'
      : 'MISSION ROW';
  };

})(window.G);
