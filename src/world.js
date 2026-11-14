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
  var SHELF_W = 34;        // dry sand between the promenade kerb and the waterline
  var SAND_Y = 0.09;       // beach sand sits a little below the promenade
  var PIER_Z = 64, PIER_W = 9, PIER_Y = 0.56;   // the boardwalk pier

  var city = G.city = {
    BLOCK: BLOCK, ROAD: ROAD, AVE: AVE, HWY: HWY, GRID: GRID, WORLD: WORLD,
    HALF: HALF, CURB: CURB, COAST_X: COAST_X, SHELF_W: SHELF_W, SAND_Y: SAND_Y,
    PIER_Z: PIER_Z, PIER_W: PIER_W, PIER_Y: PIER_Y,
    colliders: [], boxes: [], parks: [], windowMats: [], treeMats: [], targets: [],
    rooms: [], props: [], platforms: [], inside: null   // build 8: enterable interiors
  };

  // handles for the animated sea, filled in by build()
  var seaObjs = {};

  // merged furniture for interiors + beach props (flushed with the landmarks)
  var inM = {}, textMerges = {}, textMats = {};

  // walkable decks (the pier) float above the sand and the water
  city.platformAt = function (x, z) {
    for (var i = 0; i < city.platforms.length; i++) {
      var q = city.platforms[i];
      if (x > q.x0 - 0.3 && x < q.x1 + 0.3 && z > q.z0 - 0.3 && z < q.z1 + 0.3) return q;
    }
    return null;
  };
  city.walkX = function (x, z) {
    var q = city.platformAt(x, z);
    if (q) return q.x1 - 0.6;
    return COAST_X + SHELF_W - 3;            // ankle deep in the surf, no further
  };

  // interiors the player can walk into: a rect, a floor height and a light
  function addRoom(kind, x0, z0, x1, z1, label) {
    var r = {
      kind: kind, label: label || kind,
      x0: Math.min(x0, x1), x1: Math.max(x0, x1),
      z0: Math.min(z0, z1), z1: Math.max(z0, z1),
      cx: (x0 + x1) / 2, cz: (z0 + z1) / 2
    };
    city.rooms.push(r);
    return r;
  }
  city.addRoom = addRoom;
  city.roomAt = function (x, z) {
    for (var i = 0; i < city.rooms.length; i++) {
      var r = city.rooms[i];
      if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r;
    }
    return null;
  };
  // an interactive fixture: press F when on foot and close enough
  function addProp(kind, x, z, opts) {
    var p = { kind: kind, x: x, z: z, r: (opts && opts.r) || 2.0 };
    if (opts) for (var k in opts) if (k !== 'r') p[k] = opts[k];
    city.props.push(p);
    return p;
  }
  city.addProp = addProp;
  city.propNear = function (x, z, range) {
    var best = null, bestD = range * range;
    for (var i = 0; i < city.props.length; i++) {
      var p = city.props[i];
      var d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
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
  city.groundY = function (x, z) {
    var q = city.platformAt(x, z);
    if (q) return q.y;                       // decking: the pier boardwalk
    if (x > COAST_X) return SAND_Y;          // beach sand below the promenade
    return city.isRoad(x, z) ? 0 : CURB;
  };
  city.roadHalfAt = function (v) { return roadW(roadCoord(v).i) / 2; };
  city.isWater = function (x, z) { return x > COAST_X + SHELF_W; };
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
  var unitBoxG = new THREE.BoxGeometry(1, 1, 1);
  var unitConeG = new THREE.ConeGeometry(1, 1, 14, 1, true);   // awnings, umbrellas
  var unitBarrelG = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  var bMerges = null, roofMerge = null, roofMat = null, mastMerge = null, metalMat = null;

  city.build = function (scene) {
    var groups = new THREE.Group();
    groups.name = 'city';
    scene.add(groups);
    city.groups = groups;
    initBuildingMats();
    initInteriorMats();
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

    // ---- the sea: a walk-up sand shelf, surf line, shallow shelf then open water ----
    var SHORE = COAST_X;                     // promenade kerb; east of here is beach
    var seaTex = U.waterTexture(); seaTex.repeat.set(200, 300);
    var sea = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 3, WORLD * 4.4),
      new THREE.MeshStandardMaterial({ map: seaTex, color: 0x9dc2d8, roughness: 0.14, metalness: 0.45 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(SHORE + SHELF_W + WORLD * 1.5, 0.04, 0);
    groups.add(sea);

    var shallowTex = U.waterTexture(); shallowTex.repeat.set(10, 110);
    var shallow = new THREE.Mesh(new THREE.PlaneGeometry(72, WORLD * 4.2),
      new THREE.MeshStandardMaterial({ map: shallowTex, color: 0x88dccb, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.9 }));
    shallow.rotation.x = -Math.PI / 2;
    shallow.position.set(SHORE + SHELF_W + 35, 0.055, 0);
    groups.add(shallow);

    var sheenTex = U.waterTexture(); sheenTex.repeat.set(34, 150);
    var sheen = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 2.6, WORLD * 4.2),
      new THREE.MeshBasicMaterial({ map: sheenTex, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.14, depthWrite: false }));
    sheen.rotation.x = -Math.PI / 2;
    sheen.position.set(SHORE + SHELF_W + WORLD * 1.2, 0.1, 0);
    groups.add(sheen);

    // wet sand shelf dropping to the waterline, then the surf line itself
    var shelfTex = U.sandTexture(); shelfTex.repeat.set(SHELF_W / 4, WORLD * 4 / 4);
    var shelf = new THREE.Mesh(new THREE.PlaneGeometry(SHELF_W, WORLD * 4),
      new THREE.MeshStandardMaterial({ map: shelfTex, color: 0xe4d3a8, roughness: 1 }));
    shelf.rotation.x = -Math.PI / 2;
    shelf.position.set(SHORE + SHELF_W / 2, 0.07, 0);
    shelf.receiveShadow = true;
    groups.add(shelf);

    var foamTex = U.foamTexture(); foamTex.repeat.set(3, 130);
    var foam = new THREE.Mesh(new THREE.PlaneGeometry(6, WORLD * 4),
      new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.55, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(SHORE + SHELF_W - 1.5, 0.085, 0);
    groups.add(foam);

    seaObjs.sea = sea; seaObjs.shallow = shallow; seaObjs.sheen = sheen; seaObjs.foam = foam;
    city.shore = SHORE;

    // sea wall: the promenade parapet, broken up by the pier and by the steps down
    // to the sand, so the beach is more than a view from behind a wall.
    var wallH = 1.05, wallW = 1.2, wallL = WORLD + 90;
    var pierGap = PIER_W / 2 + 2, SEG_L = 56, GAP_L = 14;
    var segs = [], stairs = [];
    var zc = PIER_Z + pierGap;
    while (zc < wallL / 2) { segs.push([zc, Math.min(zc + SEG_L, wallL / 2)]); stairs.push(zc + SEG_L + GAP_L / 2); zc += SEG_L + GAP_L; }
    var zc0 = PIER_Z - pierGap;
    while (zc0 > -wallL / 2) { segs.push([Math.max(zc0 - SEG_L, -wallL / 2), zc0]); stairs.push(zc0 - SEG_L - GAP_L / 2); zc0 -= SEG_L + GAP_L; }
    segs.push([-wallL / 2, PIER_Z - pierGap]);
    for (var wi = 0; wi < segs.length; wi++) {
      var wz = (segs[wi][0] + segs[wi][1]) / 2, wl = segs[wi][1] - segs[wi][0];
      if (wl <= 0.5) continue;
      var wall = new THREE.Mesh(new THREE.BoxGeometry(wallW, wallH, wl), curbMat);
      wall.position.set(COAST_X + wallW / 2, wallH / 2, wz);
      wall.castShadow = true; wall.receiveShadow = true;
      groups.add(wall);
      city.addBox(COAST_X, 0, segs[wi][0], COAST_X + wallW, wallH, segs[wi][1], 'building');
      // lamp posts along the promenade every 40 m
      for (var lp = segs[wi][0] + 20; lp < segs[wi][1]; lp += 40) {
        inMerge('metal').box(0.2, 4.6, 0.2, COAST_X + 0.9, CURB + 2.3, lp);
        inMerge('lamp').box(0.7, 0.24, 1.0, COAST_X + 0.6, CURB + 4.6, lp);
      }
    }
    // stone steps through each opening, with a handrail, down to the sand
    for (var si = 0; si < stairs.length; si++) {
      var sz = stairs[si];
      if (Math.abs(sz) > wallL / 2 - 4 || Math.abs(sz - PIER_Z) < pierGap + 6) continue;
      inMerge('stone').plate(4.2, GAP_L - 2.2, COAST_X + 1.6, CURB - 0.055, sz, 0, 0.4);
      inMerge('stone').plate(4.2, GAP_L - 2.2, COAST_X + 5.2, SAND_Y + 0.03, sz, 0, 0.4);
      inMerge('metal').box(0.1, 0.95, 0.1, COAST_X - 1.5, CURB + 0.48, sz - (GAP_L - 3) / 2);
      inMerge('metal').box(0.1, 0.95, 0.1, COAST_X - 1.5, CURB + 0.48, sz + (GAP_L - 3) / 2);
      inMerge('metal').box(0.08, 0.08, GAP_L - 3, COAST_X - 1.5, CURB + 0.95, sz);
    }
    city.wallX = COAST_X;
    addPier(groups);

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

    // ---- your house: a suburban plot on the palm side of the map ----
    var homeKey = null, homeScore = 1e9;
    for (var hbx = 1; hbx < GRID - 1; hbx++) {
      for (var hbz = 1; hbz < GRID - 1; hbz++) {
        var hs = slabRect(hbx, hbz), hd = districtAt(hs.cx, hs.cz);
        if (hd !== 'suburb' && hd !== 'midtown') continue;
        if (parkAt[hbx + '_' + hbz] || targetAt[hbx + '_' + hbz]) continue;
        var west = districtAt(slabRect(hbx + 1, hbz).cx, hs.cz) === 'beach';
        if (!west) continue;
        var hscore = Math.abs(hs.cz) + Math.abs(hs.cx - (COAST_X - 120)) * 0.4;
        if (hscore < homeScore) { homeScore = hscore; homeKey = hbx + '_' + hbz; }
      }
    }

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
        if (key2 === homeKey) { walk.plate(s.hx * 2, s.hz * 2, s.cx, CURB, s.cz, 0, 0.42); addHome(s); continue; }
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

  // ---------------------------------------------------------------- interior fittings
  // Every fixture in every shop interior is merged per material, so 26 enterable
  // shops still cost only a handful of draw calls. The registries themselves live
  // at the top of the module: the sea wall and the pier are built first.
  function inMerge(name, mat, shadow) {
    if (!inM[name]) inM[name] = { merge: U.merge(), mat: mat, shadow: shadow !== false };
    else if (mat && !inM[name].mat) inM[name].mat = mat;
    else if (shadow === false) inM[name].shadow = false;
    return inM[name].merge;
  }
  function textMerge(text, bg, fg) {
    var key = text + '|' + bg + '|' + fg;
    if (!textMerges[key]) {
      textMerges[key] = U.merge();
      textMats[key] = new THREE.MeshStandardMaterial({ map: U.signTexture(text, bg, fg), roughness: 0.62, metalness: 0.03 });
    }
    return textMerges[key];
  }
  city.textMerge = textMerge;
  function initInteriorMats() {
    if (inM.__ready) return;
    inM.__ready = true;
    function std(o) { return new THREE.MeshStandardMaterial(o); }
    inMerge('wall', std({ color: 0xe6e2d8, roughness: 0.94 }));
    inMerge('wallWarm', std({ color: 0xd8c8b0, roughness: 0.95 }));
    inMerge('plinth', std({ color: 0x2b2f34, roughness: 0.5, metalness: 0.25 }));
    inMerge('glass', std({ color: 0xbfe6ee, roughness: 0.06, metalness: 0.08, transparent: true, opacity: 0.26 }), false);
    inMerge('screen', std({ map: U.screenTexture('#0a2a1e', 'rgba(110,255,190,1)', 6), emissive: 0x2fff9f, emissiveMap: U.screenTexture('#0a2a1e', 'rgba(110,255,190,1)', 6), emissiveIntensity: 0.85, roughness: 0.3 }), false);
    inMerge('screenBlue', std({ map: U.screenTexture('#0b1c33', 'rgba(150,205,255,1)', 5), emissive: 0x63a6ff, emissiveMap: U.screenTexture('#0b1c33', 'rgba(150,205,255,1)', 5), emissiveIntensity: 0.8, roughness: 0.3 }), false);
    inMerge('lamp', std({ color: 0xfdf6e0, emissive: 0xfff0c8, emissiveIntensity: 0.9, roughness: 0.4 }), false);
    inMerge('wood', std({ map: U.woodTexture(false), roughness: 0.85 }));
    inMerge('woodDark', std({ map: U.woodTexture(true), roughness: 0.9 }));
    inMerge('metal', std({ color: 0x9aa3ab, roughness: 0.45, metalness: 0.6 }));
    inMerge('steel', std({ color: 0x6f777e, roughness: 0.5, metalness: 0.7 }));
    inMerge('velvet', std({ color: 0x5a1226, roughness: 1 }));
    inMerge('goodsA', std({ color: 0xd0472f, roughness: 0.75 }));
    inMerge('goodsB', std({ color: 0x2f6fd0, roughness: 0.75 }));
    inMerge('goodsC', std({ color: 0xd8a72f, roughness: 0.75 }));
    inMerge('goodsD', std({ color: 0x3fae5a, roughness: 0.75 }));
    inMerge('stone', std({ map: U.stoneTexture(), roughness: 0.85, metalness: 0.04 }));
    inMerge('floorStore', std({ map: U.tileTexture('#cfd3d6', 'rgba(90,95,100,.75)', 4), roughness: 0.5, metalness: 0.05 }));
    inMerge('floorBank', std({ map: U.tileTexture('#cbc3b2', 'rgba(120,112,98,.6)', 3), roughness: 0.35, metalness: 0.12 }));
    inMerge('floorJewel', std({ map: U.tileTexture('#2b2320', 'rgba(150,130,110,.35)', 2), roughness: 0.5 }));
    inMerge('floorHome', std({ map: U.tileTexture('#8a6540', 'rgba(70,48,28,.8)', 6), roughness: 0.75 }));
    inMerge('brick', std({ map: U.noiseTexture(128, '#b49c86', 24, 2), roughness: 0.95, metalness: 0.02 }));
    inMerge('brickRed', std({ map: U.noiseTexture(128, '#a3785f', 22, 2), roughness: 0.95 }));
    function stripes(a, b) {
      return std({ map: U.awningTexture(a, b), roughness: 0.74, side: THREE.DoubleSide });
    }
    inMerge('awningA', stripes('#c9432c', '#f6f1e2'), false);   // shop awnings + umbrellas
    inMerge('awningB', stripes('#1d6f78', '#f6f1e2'), false);
    inMerge('awningC', stripes('#c9a02c', '#3a2a1c'), false);
    inMerge('fabric', std({ color: 0xf4efe4, roughness: 0.95, side: THREE.DoubleSide }), false);
  }

  // which plot edge faces the nearest kerb: shops look out at the street
  function kerbDist(v) {
    var rc = roadCoord(v);
    return rc.d - roadW(rc.i) / 2;
  }
  function facadeYaw(s) {
    var dW = kerbDist(s.x0), dE = kerbDist(s.x1), dN = kerbDist(s.z0), dS = kerbDist(s.z1);
    var m = Math.min(dW, dE, dN, dS);
    if (m === dW) return -Math.PI / 2;
    if (m === dE) return Math.PI / 2;
    if (m === dN) return Math.PI;
    return 0;
  }

  function addAtm(s) {
    var T = TARGETS.atm;
    var yaw = facadeYaw(s);
    var nx = Math.sin(yaw), nz = Math.cos(yaw), tx = -nz, tz = nx;
    var alongX = Math.abs(nx) > 0.5;
    var edgeX = alongX ? (nx > 0 ? s.x1 : s.x0) : s.cx;
    var edgeZ = alongX ? s.cz : (nz > 0 ? s.z1 : s.z0);
    // a cash machine bolted to the wall, somewhere along the frontage
    var slide = U.rand(-1, 1) * Math.max(1, (alongX ? s.hz : s.hx) - 7);
    var cx = edgeX + tx * slide - nx * 1.1;
    var cz = edgeZ + tz * slide - nz * 1.1;

    var W = 1.5, D = 1.0, H = 2.3;
    lm('dark').box(W, H, D, cx, CURB + H / 2, cz, 0, yaw, 0);
    inMerge('metal').box(W + 0.16, 0.22, D + 0.16, cx, CURB + H + 0.11, cz, 0, yaw, 0);
    inMerge('screenBlue').box(W * 0.72, 0.5, 0.06, cx - nx * (D / 2), CURB + 1.55, cz - nz * (D / 2), 0, yaw, 0);
    inMerge('metal').box(0.62, 0.34, 0.05, cx - nx * (D / 2), CURB + 1.05, cz - nz * (D / 2), 0, yaw, 0);
    // a glowing sign over the machine so you can spot one at night
    textMerge('ATM', '#20303f', '#a8d8ff').raw(unitPlane,
      composeMat(cx - nx * (D / 2 + 0.05), CURB + 2.05, cz - nz * (D / 2 + 0.05), yaw, W * 0.9, 0.42, 1));
    city.addBox(cx - W / 2 - 0.2, CURB, cz - D / 2 - 0.2, cx + W / 2 + 0.2, CURB + H, cz + D / 2 + 0.2, 'building');

    city.targets.push({
      kind: 'atm', name: T.name, hint: T.hint, loot: T.loot, secs: T.secs, heat: T.heat,
      x: cx - nx * 1.6, z: cz - nz * 1.6, yaw: yaw, robbed: 0, cool: 0
    });
  }


  // ---------------------------------------------------------------- shop dressing
  // Awnings, potted plants, benches, bins, A-boards and window posters along the
  // frontage, so a shop reads as a shop and not just as a lit box.
  function decorateShop(kind, rcx, rcz, nx, nz, tx, tz, span, doorW, doorH, hN, yaw, WH) {
    var y = CURB;
    function at(offT, offN) { return { x: rcx + tx * offT + nx * offN, z: rcz + tz * offT + nz * offN }; }
    var awnMat = kind === 'bank' ? 'awningB' : kind === 'jeweller' ? 'awningA' : 'awningC';
    var bars = inMerge('metal'), plant = inMerge('goodsD'), pot = inMerge('plinth');
    var neon = inMerge('lamp'), wood = inMerge('woodDark');

    // awning across the frontage, sloping down away from the glass
    if (kind !== 'bank') {
      var aw = span * 0.88, adm = 2.2, ay = y + doorH + 1.05;
      var ac = at(0, -(hN + adm / 2 - 0.1));
      inMerge(awnMat).raw(unitBoxG, tiltMat(ac.x, ay, ac.z, yaw, 0, 0.34, aw, 0.1, adm), aw / 2.4, adm / 2.4);
      var ve = at(0, -(hN + adm - 0.25));
      inMerge(awnMat).raw(unitBoxG, tiltMat(ve.x, ay - 0.62, ve.z, yaw, 0, 0, aw, 0.42, 0.06), aw / 2.4, 1);
      neon.box(aw * 0.92, 0.06, 0.1, ve.x, ay - 0.86, ve.z, 0, yaw, 0);
      // awning tie rods back to the fascia
      for (var ar = -1; ar <= 1; ar += 2) {
        var p1 = at(ar * aw / 2, -(hN - 0.05)), p2 = at(ar * aw / 2, -(hN + adm - 0.2));
        bars.raw(unitBoxG, tiltMat((p1.x + p2.x) / 2, ay + 0.14, (p1.z + p2.z) / 2, yaw, 0.62, 0, 0.05, 0.05, adm + 0.1));
      }
    } else {
      // the bank gets a stone portico on pillars instead
      var pc = at(0, -(hN + 1.25));
      var colW = span * 0.92;
      inMerge('stone').uvBox(colW, 0.5, 2.7, pc.x, y + doorH + 1.35, pc.z, 1.2, 1.2, [1, 1, 1, 0, 1, 1]);
      inMerge('stone').uvBox(colW, 0.34, 2.5, pc.x, y + doorH + 1.72, pc.z, 1.2, 1.2, [1, 1, 1, 0, 1, 1]);
      for (var cp = -1; cp <= 1; cp += 1) {
        if (cp === 0) continue;
        var cc = at(cp * (doorW / 2 + 1.6), -(hN + 2.1));
        inMerge('stone').uvBox(0.62, doorH + 1.1, 0.62, cc.x, y + (doorH + 1.1) / 2, cc.z, 0.8, 0.8, [1, 1, 1, 0, 1, 1]);
        inMerge('stone').uvBox(0.86, 0.22, 0.86, cc.x, y + doorH + 1.15, cc.z, 0.8, 0.8, [1, 1, 1, 0, 1, 1]);
        bars.box(0.4, doorH * 0.9, 0.4, cc.x, y + doorH * 0.45, cc.z, 0, 0, 0);
      }
      neon.box(colW * 0.7, 0.08, 0.14, pc.x, y + doorH + 1.98, pc.z, 0, yaw, 0);
    }

    // flanking potted plants
    for (var ps = -1; ps <= 1; ps += 2) {
      var pp = at(ps * (doorW / 2 + 1.05), -(hN + 0.62));
      pot.raw(unitBoxG, tiltMat(pp.x, y + 0.26, pp.z, yaw, 0, 0, 0.7, 0.52, 0.7), 1, 1);
      plant.raw(unitBoxG, tiltMat(pp.x, y + 0.86, pp.z, yaw, 0, 0, 0.78, 0.72, 0.78), 1, 1);
      plant.raw(unitBoxG, tiltMat(pp.x, y + 1.34, pp.z, yaw, 0, 0, 0.56, 0.42, 0.56), 1, 1);
      city.addBox(pp.x - 0.35, y, pp.z - 0.35, pp.x + 0.35, y + 1.5, pp.z + 0.35, 'prop');
    }

    // a bench either side, further along the frontage
    for (var bs = -1; bs <= 1; bs += 2) {
      var bp = at(bs * Math.min(span / 2 - 1.6, doorW / 2 + 4.2), -(hN + 0.85));
      wood.raw(unitBoxG, tiltMat(bp.x, y + 0.44, bp.z, yaw, 0, 0, 2.1, 0.12, 0.52), 2, 1);
      wood.raw(unitBoxG, tiltMat(bp.x, y + 0.78, bp.z - 0, yaw, 0, 0, 2.1, 0.5, 0.1), 2, 1);
      var bpx = Math.abs(tx) * 2.1 / 2 + Math.abs(nx) * 0.5 / 2, bpz = Math.abs(tz) * 2.1 / 2 + Math.abs(nz) * 0.5 / 2;
      bars.box(0.1, 0.44, 0.1, bp.x - tx * 0.85, y + 0.22, bp.z - tz * 0.85, 0, 0, 0);
      bars.box(0.1, 0.44, 0.1, bp.x + tx * 0.85, y + 0.22, bp.z + tz * 0.85, 0, 0, 0);
      city.addBox(bp.x - bpx, y, bp.z - bpz, bp.x + bpx, y + 0.9, bp.z + bpz, 'prop');
    }

    // bin and A-board by the door, posters on the fascia
    var bn = at(-(doorW / 2 + 2.4), -(hN + 0.55));
    bars.raw(new THREE.CylinderGeometry(0.34, 0.3, 0.95, 10), tiltMat(bn.x, y + 0.48, bn.z, 0, 0, 0, 1, 1, 1), 2, 1);
    inMerge('plinth').box(0.76, 0.1, 0.76, bn.x, y + 0.99, bn.z, 0, 0, 0);
    var ab = at(doorW / 2 + 2.3, -(hN + 0.95));
    wood.raw(unitBoxG, tiltMat(ab.x, y + 0.42, ab.z, yaw, 0.18, 0, 0.9, 0.84, 0.06));
    var ab2 = at(doorW / 2 + 2.3, -(hN + 1.25));
    wood.raw(unitBoxG, tiltMat(ab2.x, y + 0.42, ab2.z, yaw, -0.18, 0, 0.9, 0.84, 0.06));
    var postTxt = kind === 'bank' ? ['BANK', 'ATM'] : kind === 'jeweller' ? ['GOLD', 'SALE'] : ['OPEN 24H', 'SALE'];
    for (var pi = 0; pi < 2; pi++) {
      textMerge(postTxt[pi], kind === 'jeweller' ? '#2a0f16' : '#101a14', '#f6f1e2').raw(unitPlane,
        composeMat(ab.x, y + 0.42, ab.z, yaw + Math.PI, 0.6, 0.5, 1));
    }
    textMerge(kind === 'bank' ? 'ATM' : 'OPEN', '#12161c', '#ffe9b0').raw(unitPlane,
      composeMat(rcx + nx * (-hN - 0.09) + tx * (span / 2 - 1.5), y + doorH + 0.55, rcz + nz * (-hN - 0.09) + tz * (span / 2 - 1.5),
        yaw, 1.5, 0.5, 1));
    // a hanging sign in a window bay, plus a lit ATM marker for the bank
    if (kind === 'bank') {
      for (var ai = -1; ai <= 1; ai += 2) {
        var am = at(ai * (span / 2 - 2.2), -(hN + 0.5));
        inMerge('steel').box(0.62, 0.9, 0.42, am.x, y + 1.05, am.z, 0, 0, 0);
        inMerge('screenBlue').box(0.5, 0.3, 0.05, am.x, y + 1.24, am.z, 0, 0, 0);
        city.addProp('atm', am.x, am.z, { r: 1.6, name: 'ATM' });
      }
    }
  }

  function addLandmark(kind, s) {
    initBuildingMats();
    initInteriorMats();
    if (kind === 'atm') return addAtm(s);

    var T = TARGETS[kind], r = U.rng;
    var yaw = facadeYaw(s);
    var nx = Math.sin(yaw), nz = Math.cos(yaw);
    var tx = -nz, tz = nx;
    var alongX = Math.abs(nx) > 0.5;

    var spanN = alongX ? 2 * s.hx : 2 * s.hz;      // plot depth, facade -> back
    var spanT = alongX ? 2 * s.hz : 2 * s.hx;      // plot frontage along the street
    var edgeX = alongX ? (nx > 0 ? s.x1 : s.x0) : s.cx;
    var edgeZ = alongX ? s.cz : (nz > 0 ? s.z1 : s.z0);

    var SET = 1.7;                                  // pavement setback
    var WT = 0.36;
    var WH = kind === 'bank' ? 5.6 : 4.5;           // interior height
    var roomD = kind === 'bank' ? 13 : 10;
    var span = Math.max(9.5, Math.min(spanT - 3.5, kind === 'bank' ? 21 : kind === 'jeweller' ? 14 : 16));
    var doorW = 2.5, doorH = Math.min(3.0, WH - 1.1);
    var h = Math.max(U.rand(T.h[0], T.h[1]), WH + 7);
    if (r() < 0.4) h += U.rand(2, 8);

    // room centre and the four wall lines
    var rcx = edgeX + nx * (SET + roomD / 2), rcz = edgeZ + nz * (SET + roomD / 2);
    var hT = span / 2, hN = roomD / 2;

    // boxes aligned with the facade: offT/offN are offsets from the room centre
    function solidBox(offT, offN, lenT, lenN, y0, y1) {
      var cxp = rcx + tx * offT + nx * offN, czp = rcz + tz * offT + nz * offN;
      var wx = Math.abs(tx) * lenT + Math.abs(nx) * lenN;
      var wz = Math.abs(tz) * lenT + Math.abs(nz) * lenN;
      city.addBox(cxp - wx / 2, y0, czp - wz / 2, cxp + wx / 2, y1, czp + wz / 2, 'building');
    }
    function fit(mat, offT, offN, lenT, lenN, y0, y1, solid) {
      var cxp = rcx + tx * offT + nx * offN, czp = rcz + tz * offT + nz * offN;
      var wx = Math.abs(tx) * lenT + Math.abs(nx) * lenN;
      var wz = Math.abs(tz) * lenT + Math.abs(nz) * lenN;
      mat.box(wx, y1 - y0, wz, cxp, (y0 + y1) / 2, czp, 0, 0, 0);
      if (solid !== false) solidBox(offT, offN, lenT, lenN, y0, y1);
    }

    // ---- shell: side + back walls, a glazed shopfront with a doorway, ceiling ----
    fit(inMerge('wall'), -(hT - WT / 2), 0, WT, roomD, CURB, CURB + WH);
    fit(inMerge('wall'), (hT - WT / 2), 0, WT, roomD, CURB, CURB + WH);
    fit(inMerge('wall'), 0, hN - WT / 2, span, WT, CURB, CURB + WH);
    var panelW = (span - doorW) / 2 - 0.1;
    for (var sgn = -1; sgn <= 1; sgn += 2) {
      var offT = sgn * (doorW / 2 + panelW / 2 + 0.05);
      fit(inMerge('plinth'), offT, -(hN - WT / 2), panelW, WT, CURB, CURB + 0.55);
      fit(inMerge('glass'), offT, -(hN - WT / 2), panelW - 0.24, 0.14, CURB + 0.55, CURB + doorH, false);
      solidBox(offT, -(hN - WT / 2), panelW, WT, CURB + 0.5, CURB + doorH);   // glass still blocks you
      for (var mu = 0; mu < 3; mu++) {                                        // window mullions
        var mo = offT + (mu - 1) * (panelW / 3);
        fit(inMerge('plinth'), mo, -(hN - WT / 2), 0.12, WT + 0.06, CURB + 0.5, CURB + doorH, false);
      }
      // goods visible in the window, lit from inside
      var wo = offT;
      inMerge('lamp').box(panelW * 0.7, 0.12, 0.4, rcx + tx * wo + nx * -(hN - 1.1), CURB + doorH - 0.4, rcz + tz * wo + nz * -(hN - 1.1), 0, yaw, 0);
    }
    fit(inMerge('plinth'), 0, -(hN - WT / 2), doorW + 0.3, WT, CURB + doorH, CURB + doorH + 0.28, false);
    var fascia = inMerge('wallWarm');
    fit(fascia, 0, -(hN - WT / 2), span, WT, CURB + doorH, CURB + WH);   // sign band across the front
    // doorway frame + threshold
    fit(inMerge('plinth'), -(doorW / 2 + 0.09), -(hN - WT / 2), 0.18, WT + 0.1, CURB, CURB + doorH, false);
    fit(inMerge('plinth'), (doorW / 2 + 0.09), -(hN - WT / 2), 0.18, WT + 0.1, CURB, CURB + doorH, false);
    inMerge('plinth').plate(doorW + 0.4, 0.7, rcx + nx * -(hN - 0.2), CURB + 0.03, rcz + nz * -(hN - 0.2), yaw, 0.5);
    // ceiling slab, then the upper storeys of the building above the shop
    fit(inMerge('wall'), 0, 0, span + 2 * WT, roomD + WT, CURB + WH, CURB + WH + 0.4, false);
    stairsAndInterior(kind, rcx, rcz, nx, nz, tx, tz, span, roomD, WT, WH, doorW);

    // ceiling light strip inside and the shop sign on the fascia outside
    inMerge('lamp').box(span * 0.62, 0.1, 0.5, rcx, CURB + WH - 0.1, rcz, 0, yaw, 0);
    signMerge(kind, T).raw(unitPlane, composeMat(
      rcx + nx * (-hN - 0.07), CURB + doorH + 1.0, rcz + nz * (-hN - 0.07),
      yaw, Math.min(span * 0.62, 11), 1.15, 1));


    decorateShop(kind, rcx, rcz, nx, nz, tx, tz, span, doorW, doorH, hN, yaw, WH);
    // ---- the building mass above the shop, and solid fill behind it ----
    var massH = h - WH - 0.4;
    var fx = edgeX + nx * SET, fz = edgeZ + nz * SET;
    var massDepth = spanN - SET;
    var mcx = fx + nx * (massDepth / 2), mcz = fz + nz * (massDepth / 2);
    var mwx = Math.abs(tx) * spanT + Math.abs(nx) * massDepth;
    var mwz = Math.abs(tz) * spanT + Math.abs(nz) * massDepth;
    lmMaterial(kind, T);
    lm(kind).uvBox(mwx, massH, mwz, mcx, CURB + WH + 0.4 + massH / 2, mcz, T.su, T.su, [1, 1, 0, 0, 1, 1]);
    roofMerge.uvBox(mwx, massH, mwz, mcx, CURB + WH + 0.4 + massH / 2, mcz, 1, 1, [0, 0, 1, 0, 0, 0]);
    city.addBox(mcx - mwx / 2, CURB + WH + 0.4, mcz - mwz / 2, mcx + mwx / 2, CURB + h, mcz + mwz / 2, 'building');
    var backD = spanN - SET - roomD;
    if (backD > 0.6) {
      var bcx = fx + nx * (roomD + backD / 2), bcz = fz + nz * (roomD + backD / 2);
      var bw = Math.abs(tx) * spanT + Math.abs(nx) * backD;
      var bd = Math.abs(tz) * spanT + Math.abs(nz) * backD;
      lm(kind).uvBox(bw, WH + 0.4, bd, bcx, CURB + (WH + 0.4) / 2, bcz, T.su, T.su, [1, 1, 1, 0, 1, 1]);
      roofMerge.uvBox(bw, WH + 0.4, bd, bcx, CURB + (WH + 0.4) / 2, bcz, 1, 1, [0, 1, 0, 0, 0, 0]);
      city.addBox(bcx - bw / 2, CURB, bcz - bd / 2, bcx + bw / 2, CURB + WH + 0.4, bcz + bd / 2, 'building');
    }

    // ---- the doorway is where the hold-up marker sits, just inside the glass ----
    var markD = -(hN) + 2.6;
    city.targets.push({
      kind: kind, name: T.name, hint: T.hint, loot: T.loot, secs: T.secs, heat: T.heat,
      x: rcx + nx * markD, z: rcz + nz * markD, yaw: yaw, robbed: 0, cool: 0
    });
    addRoom(kind, rcx - (alongX ? hN : hT) + WT, rcz - (alongX ? hT : hN) + WT,
      rcx + (alongX ? hN : hT) - WT, rcz + (alongX ? hT : hN) - WT, T.name);
  }

  // shop fittings: a counter you can hold up, shelves, a vault, a display case
  function stairsAndInterior(kind, rcx, rcz, nx, nz, tx, tz, span, roomD, WT, WH, doorW) {
    var hT = span / 2 - WT, hN = roomD / 2 - WT;
    function at(offT2, offN2) { return { x: rcx + tx * offT2 + nx * offN2, z: rcz + tz * offT2 + nz * offN2 }; }
    // floor finish, sized to the room
    var fx = Math.abs(tx) * span + Math.abs(nx) * roomD;
    var fz = Math.abs(tz) * span + Math.abs(nz) * roomD;
    var kw = Math.abs(tx) * (span - 2 * WT) + Math.abs(nx) * (roomD - 2 * WT);
    var kd = Math.abs(tz) * (span - 2 * WT) + Math.abs(nz) * (roomD - 2 * WT);
    var floorName = kind === 'bank' ? 'floorBank' : kind === 'jeweller' ? 'floorJewel' : 'floorStore';
    inMerge(floorName).plate(kw, kd, rcx, CURB + 0.02, rcz, 0, 0.5);

    var counter = at(-hT * 0.15, hN - 0.6);
    if (kind === 'store') {
      // shelving down both walls, a fridge bank and a till counter
      for (var row = -1; row <= 1; row += 2) {
        for (var i = 0; i < 3; i++) {
          var o = at(row * (hT - 1.1), -hN + 2.2 + i * 1.5);
          inMerge('metal').box(0.7, 1.9, 1.1, o.x, CURB + 0.95, o.z, 0, 0, 0);
          inMerge('woodDark').box(0.82, 0.1, 1.2, o.x, CURB + 1.92, o.z, 0, 0, 0);
          for (var s2 = 0; s2 < 3; s2++) {
            var g = at(row * (hT - 1.1), -hN + 2.2 + i * 1.5);
            var gName = ['goodsA', 'goodsB', 'goodsC', 'goodsD'][(i + row + s2 + 4) % 4];
            inMerge(gName).box(0.56, 0.26, 0.9, g.x, CURB + 0.55 + s2 * 0.62, g.z, 0, 0, 0);
          }
        }
      }
      var fr = at(hT - 0.9, hN - 3.2);
      inMerge('metal').box(0.9, 2.4, 3.2, fr.x, CURB + 1.2, fr.z, 0, 0, 0);
      inMerge('glass').box(0.34, 2.1, 2.7, fr.x - nx * 0.3, CURB + 1.15, fr.z - nz * 0.3, 0, 0, 0);
      inMerge('lamp').box(0.3, 0.14, 2.6, fr.x - nx * 0.34, CURB + 2.24, fr.z - nz * 0.34, 0, 0, 0);
      inMerge('wood').box(3.4, 1.05, 0.7, counter.x, CURB + 0.52, counter.z, 0, 0, 0);
      inMerge('plinth').box(3.6, 0.1, 0.86, counter.x, CURB + 1.1, counter.z, 0, 0, 0);
      inMerge('screen').box(0.8, 0.5, 0.06, counter.x, CURB + 1.4, counter.z - nz * 0.36, 0, 0, 0);
      textMerge('OPEN', '#123c2a', '#d8ffe8').raw(unitPlane,
        composeMat(counter.x - nx * 0.6, CURB + 2.25, counter.z - nz * 0.6, Math.atan2(-nx, -nz), 1.4, 0.4, 1));
      city.addProp('till', counter.x, counter.z, { r: 2.4, shop: true, name: '24/7' });
    } else if (kind === 'bank') {
      // marble teller counter, queue posts, lamps and a vault on the back wall
      inMerge('stone').box(span - 2 * WT - 1.2, 1.15, 1.5, counter.x, CURB + 0.57, counter.z, 0, 0, 0);
      inMerge('woodDark').box(span - 2 * WT - 1.0, 0.12, 1.7, counter.x, CURB + 1.2, counter.z, 0, 0, 0);
      for (var st = -1; st <= 1; st++) {
        var o2 = at(st * (hT - 2.6), hN - 1.1);
        inMerge('glass').box(2.4, 1.5, 0.08, o2.x, CURB + 1.95, o2.z, 0, 0, 0);
        inMerge('plinth').box(2.6, 0.12, 0.16, o2.x, CURB + 2.72, o2.z, 0, 0, 0);
        inMerge('screenBlue').box(0.7, 0.44, 0.05, o2.x, CURB + 1.6, o2.z + nz * 0.3, 0, 0, 0);
      }
      for (var q = -1; q <= 1; q += 2) {
        for (var qi = 0; qi < 3; qi++) {
          var qp = at(q * 1.5, -hN + 3 + qi * 2.6);
          inMerge('steel').box(0.16, 1.0, 0.16, qp.x, CURB + 0.5, qp.z, 0, 0, 0);
          inMerge('metal').box(0.08, 0.08, 2.6, qp.x, CURB + 0.95, qp.z + 1.3, 0, 0, 0);
        }
      }
      var vt = at(0, hN - 0.5);
      inMerge('steel').box(3.6, 3.2, 0.5, vt.x, CURB + 1.6, vt.z, 0, 0, 0);
      inMerge('metal').box(2.4, 2.4, 0.34, vt.x, CURB + 1.4, vt.z - nz * 0.35, 0, 0, 0);
      inMerge('lamp').box(2.6, 0.12, 0.4, counter.x, CURB + WH - 0.2, counter.z + nz * 1.6, 0, 0, 0);
      textMerge('VAULT', '#12233d', '#f4d873').raw(unitPlane,
        composeMat(vt.x, CURB + 3.4, vt.z - nz * 0.3, Math.atan2(-nx, -nz), 1.8, 0.5, 1));
      city.addProp('vault', vt.x, vt.z, { r: 3.0, shop: true, name: 'BANK' });
    } else {
      // jeweller: velvet display cases either side of a glass counter
      for (var d2 = -1; d2 <= 1; d2 += 2) {
        var dp = at(d2 * (hT - 1.4), hN - 2.4);
        inMerge('woodDark').box(0.9, 0.95, 3.6, dp.x, CURB + 0.48, dp.z, 0, 0, 0);
        inMerge('velvet').box(0.82, 0.18, 3.4, dp.x, CURB + 0.95, dp.z, 0, 0, 0);
        inMerge('glass').box(0.86, 0.7, 3.5, dp.x, CURB + 1.35, dp.z, 0, 0, 0);
        for (var j = 0; j < 5; j++) {
          inMerge(j % 2 ? 'goodsC' : 'screen').box(0.16, 0.12, 0.16, dp.x, CURB + 1.12, dp.z - 1.4 + j * 0.7, 0, 0, 0);
        }
      }
      inMerge('wood').box(1.0, 1.05, 3.0, counter.x, CURB + 0.52, counter.z, 0, 0, 0);
      inMerge('glass').box(1.1, 0.5, 3.1, counter.x, CURB + 1.35, counter.z, 0, 0, 0);
      inMerge('lamp').box(0.5, 0.1, 3.2, counter.x, CURB + 1.7, counter.z, 0, 0, 0);
      var sf = at(-(hT - 0.6), hN - 1.0);
      inMerge('steel').box(1.4, 1.5, 1.1, sf.x, CURB + 0.75, sf.z, 0, 0, 0);
      textMerge('JEWELS', '#3a1020', '#ffe9a8').raw(unitPlane,
        composeMat(counter.x + nx * 0.7, CURB + 2.1, counter.z + nz * 0.7, Math.atan2(-nx, -nz), 2.4, 0.55, 1));
      city.addProp('cases', counter.x, counter.z, { r: 2.6, shop: true, name: 'JEWELLER' });
    }
    // a potted plant in every shop, and a bin by the door
    var pl = at(-(hT - 0.7), -hN + 0.9);
    inMerge('woodDark').box(0.5, 0.5, 0.5, pl.x, CURB + 0.25, pl.z, 0, 0, 0);
    inMerge('goodsD').box(0.9, 0.9, 0.9, pl.x, CURB + 1.0, pl.z, 0, 0, 0);
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
    for (var tm in textMerges) {
      if (!textMerges[tm].count()) continue;
      groups.add(new THREE.Mesh(textMerges[tm].build(), textMats[tm]));
    }
    for (var im in inM) {
      if (im === '__ready' || !inM[im].merge.count()) continue;
      var imesh = new THREE.Mesh(inM[im].merge.build(), inM[im].mat);
      imesh.castShadow = inM[im].shadow; imesh.receiveShadow = true;
      groups.add(imesh);
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
  // ---------------------------------------------------------------- the beach + pier
  // Props on dry sand sit on the sand shelf (SAND_Y), not on the sidewalk height.
  function tiltMat(x, y, z, yaw, rx, rz, sx, sy, sz) {
    var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw || 0, 0));
    var q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, 0, rz || 0));
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), q.multiply(q2),
      new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz));
  }

  function addUmbrella(x, z, rot, mat) {
    var poleH = 2.45;
    inMerge('metal').box(0.13, poleH, 0.13, x, SAND_Y + poleH / 2, z);
    inMerge(mat).raw(unitConeG, tiltMat(x, SAND_Y + poleH + 0.34, z, rot, 0, 0, 1.9, 0.74, 1.9), 3, 1);
    city.addBox(x - 0.16, SAND_Y, z - 0.16, x + 0.16, SAND_Y + poleH, z + 0.16, 'building');
  }

  function addLounger(x, z, rot) {
    var wood = inMerge('woodDark'), fab = inMerge('fabric');
    var bx = Math.sin(rot), bz = Math.cos(rot);          // local +z = leaning back
    wood.raw(unitBoxG, tiltMat(x, SAND_Y + 0.34, z, rot, 0, 0, 0.95, 0.1, 2.05));
    fab.raw(unitBoxG, tiltMat(x, SAND_Y + 0.42, z, rot, 0, 0, 0.86, 0.06, 1.9));
    fab.raw(unitBoxG, tiltMat(x - bx * 0.72, SAND_Y + 0.72, z - bz * 0.72, rot, -0.75, 0, 0.86, 0.06, 1.05));
    for (var s = -1; s <= 1; s += 2) {
      wood.box(0.08, 0.34, 0.08, x + Math.cos(rot) * 0.4 + bx * s * 0.85, SAND_Y + 0.17, z - Math.sin(rot) * 0.4 + bz * s * 0.85);
    }
  }

  // a lifeguard tower: posts, deck, rail, striped canopy, and a ladder to climb
  function addLifeguard(x, z, rot) {
    var metal = inMerge('metal'), wood = inMerge('woodDark'), fab = inMerge('awningA');
    var i, s;
    for (i = -1; i <= 1; i += 2) {
      for (s = -1; s <= 1; s += 2) {
        metal.box(0.22, 3.4, 0.22, x + i * 1.6, SAND_Y + 1.7, z + s * 1.6);
        city.addBox(x + i * 1.6 - 0.2, SAND_Y, z + s * 1.6 - 0.2, x + i * 1.6 + 0.2, SAND_Y + 3.4, z + s * 1.6 + 0.2, 'building');
      }
    }
    wood.raw(unitBoxG, tiltMat(x, SAND_Y + 3.5, z, rot, 0, 0, 4.2, 0.18, 4.2));
    metal.box(4.2, 0.09, 0.09, x, SAND_Y + 4.6, z + 2.1);
    metal.box(4.2, 0.09, 0.09, x, SAND_Y + 4.6, z - 2.1);
    metal.box(0.09, 1.1, 0.09, x - 2.0, SAND_Y + 4.05, z + 2.1);
    metal.box(0.09, 1.1, 0.09, x + 2.0, SAND_Y + 4.05, z + 2.1);
    metal.box(0.09, 1.1, 0.09, x - 2.0, SAND_Y + 4.05, z - 2.1);
    metal.box(0.09, 1.1, 0.09, x + 2.0, SAND_Y + 4.05, z - 2.1);
    fab.raw(unitBoxG, tiltMat(x, SAND_Y + 6.05, z, rot, 0, 0, 4.6, 0.14, 4.6));
    metal.box(0.14, 2.5, 0.14, x, SAND_Y + 4.85, z);      // canopy mast
    for (i = 0; i < 2; i++) metal.box(0.5, 0.4, 0.06, x - 0.9 + i * 1.8, SAND_Y + 4.9, z);  // binoculars
    wood.box(0.12, 3.4, 0.12, x + 2.6, SAND_Y + 1.7, z + 1.2);  // ladder
    for (i = 0; i < 8; i++) wood.box(0.6, 0.07, 0.07, x + 2.35 - i * 0.2, SAND_Y + 0.5 + i * 0.4, z + 1.2, 0, 0, 0.32);
    city.addBox(x, SAND_Y + 3.3, z, x + 2.8, SAND_Y + 3.6, z + 1.35, 'building');
  }

  // the surf bar: counter under a striped awning, stools, a sign and a menu board
  function addBeachBar(x, z, yaw) {
    var wood = inMerge('woodDark'), metal = inMerge('metal'), fab = inMerge('awningB');
    var nx = Math.sin(yaw), nz = Math.cos(yaw), tx = Math.cos(yaw), tz = -Math.sin(yaw);
    var counterY = CURB + 1.05;
    wood.box(6.0, 1.05, 0.75, x, CURB + 0.52, z, 0, yaw, 0);
    wood.box(6.4, 0.12, 0.95, x, CURB + 1.10, z, 0, yaw, 0);
    fab.raw(unitBoxG, tiltMat(x + nx * 1.05, CURB + 3.05, z + nz * 1.05, yaw, 0, -0.22, 6.6, 0.12, 2.3));
    metal.box(0.14, 3.5, 0.14, x + tx * 3.1 - nx * 0.3, CURB + 1.75, z + tz * 3.1 - nz * 0.3);
    metal.box(0.14, 3.5, 0.14, x - tx * 3.1 - nx * 0.3, CURB + 1.75, z - tz * 3.1 - nz * 0.3);
    for (var st = -1; st <= 1; st++) {
      var sx = x + tx * st * 1.6 + nx * 1.5, sz = z + tz * st * 1.6 + nz * 1.5;
      metal.box(0.1, 0.85, 0.1, sx, SAND_Y + 0.42, sz);
      wood.box(0.5, 0.09, 0.5, sx, SAND_Y + 0.9, sz, 0, yaw, 0);
      city.addBox(sx - 0.3, SAND_Y, sz - 0.3, sx + 0.3, SAND_Y + 0.9, sz + 0.3, 'building');
    }
    textMerge('SURF BAR', '#123a44', '#f2e9c8').raw(unitPlane,
      composeMat(x - nx * 0.72, CURB + 2.66, z - nz * 0.72, yaw + Math.PI, 4.4, 0.9, 1));
    textMerge('$ $ $', '#0e2b33', '#ffffff').raw(unitPlane,
      composeMat(x + nx * 0.4, CURB + 1.55, z + nz * 0.4, yaw, 1.1, 0.5, 1));
    city.addBox(x - tx * 3.1, CURB, z - tz * 3.1 - 0.6, x + tx * 3.1, CURB + 1.2, z + tz * 3.1 + 0.6, 'building');
    addProp('bar', x + nx * 2.1, z + nz * 2.1, { r: 2.4, name: 'SURF BAR' });
  }

  function addVolleyball(x, z, yaw) {
    var metal = inMerge('metal'), fab = inMerge('fabric');
    var tx = Math.cos(yaw), tz = -Math.sin(yaw);
    metal.box(0.14, 2.8, 0.14, x + tx * 4, SAND_Y + 1.4, z + tz * 4);
    metal.box(0.14, 2.8, 0.14, x - tx * 4, SAND_Y + 1.4, z - tz * 4);
    fab.raw(unitBoxG, tiltMat(x, SAND_Y + 2.35, z, yaw, 0, 0, 8, 1.0, 0.05), 8, 1);
    for (var i = -3; i <= 3; i++) metal.box(0.05, 1.0, 0.05, x + tx * i * 1.1, SAND_Y + 1.85, z + tz * i * 1.1);
    for (var j = -3; j <= 3; j++) metal.box(8, 0.05, 0.05, x, SAND_Y + 1.35 + j * 0.32, z);
  }

  function addShower(x, z) {
    var metal = inMerge('metal');
    metal.box(0.16, 2.6, 0.16, x, CURB + 1.3, z);
    metal.box(0.6, 0.12, 0.6, x, CURB + 2.62, z);
    metal.box(0.18, 0.26, 0.18, x, CURB + 2.4, z);
    city.addBox(x - 0.2, CURB, z - 0.2, x + 0.2, CURB + 2.6, z + 0.2, 'building');
  }

  function addBeach(s) {
    var i, n, x, z;
    // palm row along the promenade, planted in the sand plaza behind it
    n = (s.x1 > HALF - BLOCK) ? U.randInt(3, 5) : U.randInt(1, 3);
    for (i = 0; i < n; i++) {
      addPalm(s.cx + U.rand(-s.hx + 4, s.hx - 4), s.cz + U.rand(-s.hz + 4, s.hz - 4), U.rand(1.05, 1.5));
    }
    // deckchairs under umbrellas on the dry sand
    n = U.randInt(2, 4);
    for (i = 0; i < n; i++) {
      x = COAST_X + U.rand(5, SHELF_W - 9);
      z = s.cz + U.rand(-s.hz + 3, s.hz - 3);
      addUmbrella(x, z, U.rand(0, 6.28), i % 2 ? 'awningA' : 'awningB');
      addLounger(x + U.rand(-2.4, 2.4), z + U.rand(-2.4, 2.4), U.rand(0, 6.28));
    }
    if (U.rand(0, 1) < 0.25) addLounger(COAST_X + U.rand(4, SHELF_W - 10), s.cz + U.rand(-s.hz + 3, s.hz - 3), U.rand(0, 6.28));
    // one landmark per couple of rows, so the shore never looks copy-pasted
    var roll = U.rand(0, 1);
    if (roll < 0.10) addLifeguard(COAST_X + U.rand(6, 12), s.cz, U.rand(0, 6.28));
    else if (roll < 0.18) addVolleyball(COAST_X + U.rand(7, SHELF_W - 12), s.cz, Math.PI / 2);
    else if (roll < 0.26) addShower(s.x1 - 3, s.cz + U.rand(-s.hz + 6, s.hz - 6));
    else if (roll < 0.33) addBeachBar(s.x1 - 8, s.cz, facadeYaw(s));
    else if (roll < 0.40) addPalm(COAST_X + U.rand(6, 14), s.cz + U.rand(-4, 4), U.rand(1.3, 1.6));
  }

  // the boardwalk pier: deck on pilings, railings, an arch and a tackle shed
  function addPier(groups) {
    var x0 = COAST_X + 1.2, x1 = COAST_X + 52;
    var z0 = PIER_Z - PIER_W / 2, z1 = PIER_Z + PIER_W / 2;
    var deck = inMerge('woodDark'), metal = inMerge('metal'), fab = inMerge('awningB');
    var px, pz;
    deck.raw(unitBoxG, tiltMat((x0 + x1) / 2, PIER_Y - 0.09, PIER_Z, 0, 0, 0, x1 - x0, 0.18, z1 - z0),
      (x1 - x0) / 3.2, PIER_W / 3.2);
    for (px = x0 + 2.4; px < x1; px += 5.6) {                       // pilings + cross braces
      for (var side = -1; side <= 1; side += 2) {
        metal.box(0.3, 3.2, 0.3, px, PIER_Y - 1.7, PIER_Z + side * (PIER_W / 2 - 0.5));
      }
      metal.box(0.18, 0.18, PIER_W - 1.0, px, PIER_Y - 0.55, PIER_Z);
    }
    for (side = -1; side <= 1; side += 2) {                         // railings
      var rz = PIER_Z + side * (PIER_W / 2 - 0.15);
      metal.box(x1 - x0, 0.09, 0.09, (x0 + x1) / 2, PIER_Y + 1.05, rz);
      metal.box(x1 - x0, 0.07, 0.07, (x0 + x1) / 2, PIER_Y + 0.6, rz);
      for (px = x0 + 0.6; px < x1; px += 2.4) metal.box(0.09, 1.05, 0.09, px, PIER_Y + 0.55, rz);
      city.addBox(x0 - 0.4, PIER_Y, rz - 0.12, x1, PIER_Y + 1.15, rz + 0.12, 'building');
    }
    metal.box(0.2, 1.15, PIER_W, x1 - 0.1, PIER_Y + 0.55, PIER_Z);   // end barrier
    city.addBox(x1 - 0.25, PIER_Y, z0, x1 + 0.1, PIER_Y + 1.15, z1, 'building');

    // entrance arch
    metal.box(0.3, 4.6, 0.3, x0 + 0.5, PIER_Y + 2.3, z0 - 1.2);
    metal.box(0.3, 4.6, 0.3, x0 + 0.5, PIER_Y + 2.3, z1 + 1.2);
    fab.raw(unitBoxG, tiltMat(x0 + 0.5, PIER_Y + 4.75, PIER_Z, 0, 0, 0, 0.5, 1.05, PIER_W + 3.7));
    textMerge('PIER 64', '#16323f', '#ffe9b0').raw(unitPlane,
      composeMat(x0 + 0.8, PIER_Y + 4.7, PIER_Z, Math.PI / 2, 6.4, 0.85, 1));
    textMerge('PIER 64', '#16323f', '#ffe9b0').raw(unitPlane,
      composeMat(x0 + 0.2, PIER_Y + 4.7, PIER_Z, -Math.PI / 2, 6.4, 0.85, 1));

    // tackle shed + bait counter at the far end
    var sx = x1 - 7.5;
    metal.box(0.28, 3.0, 0.28, sx - 3.0, PIER_Y + 1.5, PIER_Z - 2.6);
    metal.box(0.28, 3.0, 0.28, sx + 3.0, PIER_Y + 1.5, PIER_Z - 2.6);
    metal.box(0.28, 3.0, 0.28, sx - 3.0, PIER_Y + 1.5, PIER_Z + 2.6);
    metal.box(0.28, 3.0, 0.28, sx + 3.0, PIER_Y + 1.5, PIER_Z + 2.6);
    inMerge('wallWarm').uvBox(6.6, 0.24, 5.9, sx, PIER_Y + 3.1, PIER_Z, 2, 2, [1, 1, 1, 0, 1, 1]);
    fab.raw(unitBoxG, tiltMat(sx, PIER_Y + 3.5, PIER_Z, 0, 0, 0, 7.4, 0.14, 6.7));
    inMerge('woodDark').box(6.2, 1.0, 0.7, sx, PIER_Y + 0.5, PIER_Z + 2.9);
    textMerge('BAIT + TACKLE', '#1c2f24', '#f0e0a8').raw(unitPlane,
      composeMat(sx, PIER_Y + 1.9, PIER_Z + 3.05, 0, 4.6, 0.6, 1));
    for (pz = 0; pz < 3; pz++) {                                   // crates + barrels
      inMerge('woodDark').box(1.1, 1.0, 1.1, x0 + 9 + pz * 2.2, PIER_Y + 0.5, PIER_Z - 3.2);
    }
    inMerge('metal').raw(unitBarrelG, tiltMat(x0 + 16, PIER_Y + 0.7, PIER_Z + 3.0, 0, 0, 0, 1.0, 1.4, 1.0), 2, 1);
    inMerge('metal').raw(unitBarrelG, tiltMat(x0 + 18.4, PIER_Y + 0.7, PIER_Z + 3.4, 0, 0, 0, 1.0, 1.4, 1.0), 2, 1);
    city.addBox(sx - 3.2, PIER_Y, PIER_Z - 2.8, sx + 3.2, PIER_Y + 3.2, PIER_Z + 2.8, 'building');
    city.addBox(x0 + 8, PIER_Y, PIER_Z - 3.8, x0 + 15, PIER_Y + 1.1, PIER_Z - 2.6, 'building');
    addProp('bar', sx, PIER_Z + 4.6, { r: 3.0, name: 'TACKLE SHOP' });

    // benches looking out to sea + lamps
    for (px = x0 + 12; px < x1 - 12; px += 13) {
      inMerge('woodDark').box(2.0, 0.1, 0.5, px, PIER_Y + 0.5, PIER_Z - 3.1, 0, 0.02, 0);
      inMerge('woodDark').box(2.0, 0.5, 0.1, px, PIER_Y + 0.75, PIER_Z - 3.35, 0.15, 0.02, 0);
      for (var bs = -1; bs <= 1; bs += 2) inMerge('metal').box(0.1, 0.5, 0.5, px + bs * 0.85, PIER_Y + 0.25, PIER_Z - 3.1);
      city.addBox(px - 1.1, PIER_Y, PIER_Z - 3.5, px + 1.1, PIER_Y + 0.9, PIER_Z - 2.85, 'building');
      inMerge('metal').box(0.18, 4.2, 0.18, px + 5.5, PIER_Y + 2.1, PIER_Z + 3.9);
      inMerge('lamp').box(0.6, 0.2, 0.9, px + 5.5, PIER_Y + 4.2, PIER_Z + 3.9);
    }

    city.platforms.push({ x0: x0 - 0.6, x1: x1, z0: z0 - 0.2, z1: z1 + 0.2, y: PIER_Y });
    city.pier = { x: x1 - 6, z: PIER_Z, x0: x0, x1: x1, z0: z0, z1: z1 };
  }

  // ---------------------------------------------------------------- your house
  function addHome(s) {
    var yaw = facadeYaw(s);
    var nx = Math.sin(yaw), nz = Math.cos(yaw);          // front faces the street
    var tx = Math.cos(yaw), tz = -Math.sin(yaw);         // along the facade
    var WT = 0.3, WH = 3.3, W = 15, D = 12;
    var hx = s.cx, hz = s.cz;                            // house centre
    var ext = inMerge('brick'), inn = inMerge('wall'), warm = inMerge('wallWarm');
    var wood = inMerge('woodDark'), glass = inMerge('glass', null, false);
    var fx2, fn2;
    function boxAt(mat, offT, offN, lenT, lenN, y0, y1, solid) {
      var cx = hx + tx * offT + nx * offN, cz = hz + tz * offT + nz * offN;
      mat.raw(unitBoxG, tiltMat(cx, (y0 + y1) / 2, cz, yaw, 0, 0, lenT, y1 - y0, lenN),
        Math.max(lenT, lenN) / 2.6, (y1 - y0) / 2.6);
      if (solid !== false) city.addBox(cx - (Math.abs(tx) * lenT + Math.abs(nx) * lenN) / 2, y0,
        cz - (Math.abs(tz) * lenT + Math.abs(nz) * lenN) / 2,
        cx + (Math.abs(tx) * lenT + Math.abs(nx) * lenN) / 2, y1,
        cz + (Math.abs(tz) * lenT + Math.abs(nz) * lenN) / 2, 'building');
    }
    var floorY = CURB + 0.06, roofY = CURB + WH;
    // floor, garden and driveway paving
    inMerge('floorHome').plate(W - 0.6, D - 0.6, hx, floorY, hz, yaw, 0.7);
    inMerge('stone').plate(W + 14, D + 14, hx - nx * 2, CURB + 0.01, hz - nz * 2, yaw, 0.35);
    inMerge('stone').plate(6.5, 16, hx + nx * (D / 2 + 3.2), CURB + 0.02, hz + nz * (D / 2 + 3.2), yaw, 0.35);
    // back + side walls
    boxAt(ext, 0, D / 2, W, WT, CURB, roofY);
    boxAt(ext, -W / 2, 0, WT, D, CURB, roofY);
    boxAt(ext, W / 2, 0, WT, D, CURB, roofY);
    // front wall: two window bays with a doorway between them
    var doorW = 1.4, bay = (W - doorW - 0.6) / 2, off = doorW / 2 + 0.3 + bay / 2;
    for (var sg = -1; sg <= 1; sg += 2) {
      boxAt(ext, sg * off, -D / 2, bay, WT, CURB, CURB + 0.9);            // under-sill wall
      boxAt(ext, sg * off, -D / 2, bay, WT, CURB + 2.5, roofY);           // lintel
      boxAt(ext, sg * off - bay / 2 + 0.12, -D / 2, 0.24, WT, CURB + 0.9, CURB + 2.5);
      boxAt(ext, sg * off + bay / 2 - 0.12, -D / 2, 0.24, WT, CURB + 0.9, CURB + 2.5);
      glass.raw(unitBoxG, tiltMat(hx + tx * sg * off + nx * (-D / 2), CURB + 1.7, hz + tz * sg * off + nz * (-D / 2),
        yaw, 0, 0, bay - 0.4, 1.5, 0.07));
      warm.box(bay + 0.2, 0.18, 0.7, hx + tx * sg * off + nx * (-D / 2 - 0.35), CURB + 0.86, hz + tz * sg * off + nz * (-D / 2 - 0.35), 0, yaw, 0);
    }
    boxAt(ext, 0, -D / 2, doorW, WT, CURB + 2.5, roofY);                  // door header
    boxAt(ext, -doorW / 2 - 0.5, -D / 2, 1.0, WT, CURB, roofY);           // wall between bays
    boxAt(ext, doorW / 2 + 0.5, -D / 2, 1.0, WT, CURB, roofY);
    // porch, steps, doormat, nameplate
    wood.box(3.6, 0.14, 1.5, hx + nx * (-D / 2 - 0.9), CURB + 2.75, hz + nz * (-D / 2 - 0.9), 0, yaw, 0);
    for (var st = 0; st < 2; st++) {
      inMerge('stone').box(2.6, 0.18, 0.7, hx + nx * (-D / 2 - 0.5 - st * 0.6), CURB + 0.09 + (1 - st) * 0.18, hz + nz * (-D / 2 - 0.5 - st * 0.6), 0, yaw, 0);
    }
    city.addProp('phone', hx + nx * (-D / 2 - 1.1), hz + nz * (-D / 2 - 1.1), { r: 1.8, name: 'HOME' });
    city.addProp('door', hx, hz, { r: 2.2, name: 'YOUR HOUSE' });
    // interior: hallway, living room, kitchen, bedroom, bathroom
    boxAt(inn, -W / 2 + 3.4, 0.5, 0.25, D - 2.5, CURB + WH - 0.9, roofY, false);
    boxAt(inn, 0.2, -1.6, 0.25, 5.0, CURB, CURB + WH - 0.9, false);
    inMerge('lamp').box(3.0, 0.08, 0.4, hx, roofY - 0.2, hz, 0, yaw, 0);
    inMerge('lamp').box(3.0, 0.08, 0.4, hx + tx * 4, roofY - 0.2, hz + tz * 4, 0, yaw, 0);
    // living room: sofa, coffee table, rug, TV on a stand
    var lx = -3.2, lz = 2.6;
    wood.box(4.4, 0.5, 1.4, hx + tx * lx, floorY + 0.45, hz + tz * lx + lz, 0, yaw, 0);
    inMerge('fabric').box(4.4, 0.75, 0.35, hx + tx * lx, floorY + 0.85, hz + tz * lx + lz + 0.6, 0, yaw, 0);
    inMerge('fabric').box(0.35, 0.55, 1.4, hx + tx * (lx - 2.2), floorY + 0.7, hz + tz * (lx - 2.2) + lz, 0, yaw, 0);
    inMerge('fabric').box(0.35, 0.55, 1.4, hx + tx * (lx + 2.2), floorY + 0.7, hz + tz * (lx + 2.2) + lz, 0, yaw, 0);
    inMerge('fabric').plate(4.6, 3.2, hx + tx * (-2.6), floorY + 0.02, hz + tz * (-2.6) + 1.2, yaw, 0.4);
    wood.box(2.2, 0.45, 1.1, hx + tx * (-2.6), floorY + 0.35, hz + tz * (-2.6) + 1.2, 0, yaw, 0);
    inMerge('woodDark').box(2.6, 0.55, 0.5, hx + tx * lx, floorY + 0.28, hz + tz * lx + lz - 2.0, 0, yaw, 0);
    inMerge('screenBlue').box(2.3, 1.3, 0.09, hx + tx * lx, floorY + 1.6, hz + tz * lx + lz - 2.3, 0, yaw, 0);
    city.addProp('tv', hx + tx * lx, hz + tz * lx + lz - 2.9, { r: 2.4, name: 'TV' });
    city.addProp('bed', hx + tx * 3.4, hz + tz * 3.4 + 3.4, { r: 2.6, name: 'BED' });
    city.addProp('fridge', hx + tx * (-5.2), hz + tz * (-5.2) - 3.4, { r: 2.2, name: 'FRIDGE' });
    // kitchen run along the back wall + dining table
    for (var k = 0; k < 4; k++) {
      var kx = -5.6 + k * 1.35;
      inMerge('woodDark').box(1.3, 0.9, 1.1, hx + tx * kx, floorY + 0.45, hz + tz * kx + (-D / 2 + 0.85), 0, yaw, 0);
      inMerge('stone').box(1.4, 0.1, 1.2, hx + tx * kx, floorY + 0.93, hz + tz * kx + (-D / 2 + 0.85), 0, yaw, 0);
    }
    inMerge('metal').box(0.95, 2.0, 0.85, hx + tx * (-5.2), floorY + 1.0, hz + tz * (-5.2) - 3.2, 0, yaw, 0);
    wood.box(2.2, 0.12, 1.3, hx + tx * 1.2, floorY + 0.78, hz + tz * 1.2 + (-D / 2 + 2.6), 0, yaw, 0);
    for (var ch = 0; ch < 4; ch++) {
      wood.box(0.45, 0.8, 0.45, hx + tx * (1.2 + (ch - 1.5) * 1.1), floorY + 0.4, hz + tz * (1.2 + (ch - 1.5) * 1.1) + (-D / 2 + 3.9), 0, yaw, 0);
    }
    // bedroom: bed frame, mattress, duvet, pillow, wardrobe, lamp
    var bx2 = hx + tx * 3.4, bz2 = hz + tz * 3.4 + 3.4;
    inMerge('woodDark').box(1.7, 0.35, 2.15, bx2, floorY + 0.2, bz2, 0, yaw, 0);
    inMerge('fabric').box(1.6, 0.28, 2.05, bx2, floorY + 0.5, bz2, 0, yaw, 0);
    inMerge('fabric').box(1.62, 0.1, 1.2, bx2 + nx * 0.35, floorY + 0.66, bz2 + nz * 0.35, 0, yaw, 0);
    inMerge('fabric').box(0.95, 0.16, 0.42, bx2 + nx * (-0.62), floorY + 0.72, bz2 + nz * (-0.62), 0, yaw, 0);
    inMerge('woodDark').box(2.2, 2.2, 0.6, hx + tx * 5.6, floorY + 1.1, hz + tz * 5.6 + 0.4, 0, yaw, 0);
    inMerge('lamp').box(0.4, 0.5, 0.4, hx + tx * 5.9, floorY + 1.6, hz + tz * 5.9 + 3.6, 0, yaw, 0);
    // gabled roof
    wood.raw(unitBoxG, tiltMat(hx + nx * (D / 4), roofY + 0.9, hz + nz * (D / 4), yaw, 0.42, 0, W + 0.9, 0.22, D / 2 + 0.7), 4, 1.5);
    wood.raw(unitBoxG, tiltMat(hx - nx * (D / 4), roofY + 0.9, hz - nz * (D / 4), yaw, -0.42, 0, W + 0.9, 0.22, D / 2 + 0.7), 4, 1.5);
    wood.box(W + 1.0, 0.3, 0.4, hx, roofY + 1.75, hz, 0, yaw, 0);
    // garden fence, gate posts, bushes and flowers
    for (var f = -1; f <= 1; f += 2) {
      for (var gi = 0; gi < 9; gi++) {
        wood.box(0.14, 1.0, 0.14, hx + tx * (f * 8.6) , CURB + 0.5, hz + tz * (f * 8.6) + (gi - 4) * 3.4, 0, yaw, 0);
      }
    }
    for (var gj = 0; gj < 11; gj++) {
      wood.box(0.14, 1.0, 0.14, hx + tx * ((gj - 5) * 1.7), CURB + 0.5, hz + tz * ((gj - 5) * 1.7) - D / 2 - 4.4, 0, yaw, 0);
    }
    ud_styleGrass(hx, hz, nx, nz, tx, tz, W, D);
    // nameplate over the door + a street sign for the map
    textMerge('YOUR HOUSE', '#2a2018', '#ffe9b0').raw(unitPlane,
      composeMat(hx + nx * (-D / 2 - 0.16), CURB + 2.85, hz + nz * (-D / 2 - 0.16), yaw + Math.PI, 3.4, 0.6, 1));
    city.home = {
      x: hx, z: hz, yaw: yaw, room: null,
      spawn: { x: hx + nx * (-D / 2 - 4.0), z: hz + nz * (-D / 2 - 4.0), yaw: yaw + Math.PI },
      bed: { x: bx2, z: bz2 }
    };
  }
  function ud_styleGrass(hx, hz, nx, nz, tx, tz, W, D) {
    for (var i = 0; i < 14; i++) {
      var a = U.rand(0, 6.28), d = U.rand(7, 13);
      var gx = hx + Math.cos(a) * d, gz = hz + Math.sin(a) * d;
      if (Math.abs(gx - hx) < W / 2 + 1.2 && Math.abs(gz - hz) < D / 2 + 1.2) continue;
      addTree(gx, gz, U.rand(0.5, 0.8));
    }
    inMerge('fabric').plate(4.0, 1.6, hx + nx * (-D / 2 - 0.1), CURB + 0.03, hz + nz * (-D / 2 - 0.1), 0, 0.4);
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
