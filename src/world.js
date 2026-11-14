/* Procedural city: road grid, sidewalk blocks, buildings, street props, sky + day/night cycle. */
(function (G) {
  'use strict';
  var U = G.util;

  var BLOCK = 52;          // road centreline spacing
  var ROAD = 14;           // road width
  var GRID = 10;           // blocks per axis
  var WORLD = BLOCK * GRID;
  var HALF = WORLD / 2;
  var CURB = 0.16;         // sidewalk slab height
  var CELL = 16;           // spatial-hash cell for collision queries

  var city = G.city = {
    BLOCK: BLOCK, ROAD: ROAD, GRID: GRID, WORLD: WORLD, HALF: HALF, CURB: CURB,
    colliders: [], boxes: [], parks: [], lamps: [], windowMats: [], treeMats: []
  };

  // ---------------------------------------------------------------- layout math
  function roadCoord(v) { // nearest road index + distance from its centreline
    var i = Math.round((v + HALF) / BLOCK);
    return { i: i, d: Math.abs(v - (-HALF + i * BLOCK)) };
  }
  city.roadAxis = function (v) { var r = roadCoord(v); return r.i >= 0 && r.i <= GRID && r.d <= ROAD / 2; };
  city.isRoad = function (x, z) { return city.roadAxis(x) || city.roadAxis(z); };
  city.groundY = function (x, z) { return city.isRoad(x, z) ? 0 : CURB; };
  city.intersectionOf = function (x, z) {
    var a = roadCoord(x), b = roadCoord(z);
    if (a.d <= ROAD / 2 && b.d <= ROAD / 2) return { i: a.i, j: b.i };
    return null;
  };

  // A point in the middle of a driving lane (right-hand traffic), plus a heading.
  city.randomRoadPoint = function (avoid, minDist) {
    for (var tries = 0; tries < 40; tries++) {
      var along = U.rand(-HALF + 4, HALF - 4), i = U.randInt(1, GRID - 1);
      var dir = U.rng() < 0.5 ? 1 : -1;
      var lane = dir * (ROAD / 4);
      var onX = U.rng() < 0.5;
      var p = onX ? { x: along, z: -HALF + i * BLOCK + (dir > 0 ? lane : -lane), yaw: dir > 0 ? Math.PI / 2 : -Math.PI / 2 }
                  : { x: -HALF + i * BLOCK + (dir > 0 ? -lane : lane), z: along, yaw: dir > 0 ? 0 : Math.PI };
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

  city.randomSidewalkPoint = function (avoid, minDist) {
    var last = null;
    // buildings reach 14.5 from a block centre, the kerb sits at 19: stay in the band between them
    for (var t = 0; t < 60; t++) {
      var i = U.randInt(0, GRID - 1), j = U.randInt(0, GRID - 1);
      var cx = -HALF + (i + 0.5) * BLOCK, cz = -HALF + (j + 0.5) * BLOCK;
      var ring = 15.9 + U.rand(0, 2.6);
      var edge = U.randInt(0, 3), x, z;
      if (edge === 0) { x = cx + U.rand(-ring, ring); z = cz - ring; }
      else if (edge === 1) { x = cx + ring; z = cz + U.rand(-ring, ring); }
      else if (edge === 2) { x = cx + U.rand(-ring, ring); z = cz + ring; }
      else { x = cx - ring; z = cz + U.rand(-ring, ring); }
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
  var _seg = { x: 0, z: 0, hit: false };
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
  city.build = function (scene) {
    var groups = new THREE.Group();
    groups.name = 'city';
    scene.add(groups);

    var roadTex = U.roadTexture(), grass = U.grassTexture();
    var walkTex = U.paveTexture();
    walkTex.repeat.set(7.9, 7.9);                     // 19 m slab, 2.4 m of paving per tile
    var walkMat = new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.92, metalness: 0.02 });
    var curbMat = new THREE.MeshStandardMaterial({ color: 0xb6b3aa, roughness: 0.9 });
    var paintMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 });
    var paintMatY = new THREE.MeshStandardMaterial({ color: 0xe3c249, roughness: 0.7 });

    // ground plane (grass fields around the city)
    var gTex = grass.clone(); gTex.needsUpdate = true; gTex.repeat.set(60, 60);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 4, WORLD * 4),
      new THREE.MeshStandardMaterial({ map: gTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    groups.add(ground);

    // ---- asphalt: the whole grid in one mesh (UVs are baked in metres) ----
    var asphalt = U.merge();
    var tile = 0.22;                                  // ~4.5 m of asphalt per texture tile
    for (var i = 0; i <= GRID; i++) {
      var c = -HALF + i * BLOCK;
      asphalt.plate(WORLD + ROAD, ROAD, 0, 0.01, c, 0, tile);
      asphalt.plate(ROAD, WORLD + ROAD, c, 0.014, 0, 0, tile);
    }
    var roadMesh = new THREE.Mesh(asphalt.build(),
      new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.93, metalness: 0.03 }));
    roadMesh.receiveShadow = true;
    groups.add(roadMesh);

    // ---- painted road markings, merged by colour ----
    var halfR = ROAD / 2;
    var white = U.merge(), yellow = U.merge();
    var GAP = halfR + 3.6;                            // keep paint clear of the intersection box
    var CROSS = halfR + 1.9;                          // centre of the zebra crossing
    function spans(fn) {
      for (var i = 0; i < GRID; i++) {
        fn(-HALF + i * BLOCK + GAP, -HALF + (i + 1) * BLOCK - GAP);
      }
    }
    function paint(isYellow, alongX, c, off, len, mid, wide) {
      var b = isYellow ? yellow : white;
      if (alongX) b.plate(len, wide, mid, 0.035, c + off, 0);
      else b.plate(wide, len, c + off, 0.035, mid, 0);
    }
    for (var mi = 0; mi <= GRID; mi++) {
      var mc = -HALF + mi * BLOCK;
      [true, false].forEach(function (isAlongX) {
        var c = mc;
        spans(function (a, b) {
          var mid = (a + b) / 2, len = b - a;
          paint(false, isAlongX, c, -halfR + 0.5, len, mid, 0.15);   // solid edge lines
          paint(false, isAlongX, c, halfR - 0.5, len, mid, 0.15);
          paint(true, isAlongX, c, -0.2, len, mid, 0.12);            // double yellow centre
          paint(true, isAlongX, c, 0.2, len, mid, 0.12);
          for (var d = a + 1; d < b - 3; d += 8) {                   // dashed lane dividers
            paint(false, isAlongX, c, -ROAD / 4, 3, d + 1.5, 0.14);
            paint(false, isAlongX, c, ROAD / 4, 3, d + 1.5, 0.14);
          }
        });
      });
    }
    // zebra crossings on every approach to every intersection
    for (var gx = 0; gx <= GRID; gx++) {
      for (var gz = 0; gz <= GRID; gz++) {
        var ix = -HALF + gx * BLOCK, iz = -HALF + gz * BLOCK;
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          for (var k = -6; k <= 6; k++) {
            white.plate(0.55, 3.2, ix + k * 1.1, 0.035, iz + sgn * CROSS, 0);
            white.plate(3.2, 0.55, ix + sgn * CROSS, 0.035, iz + k * 1.1, 0);
          }
        }
      }
    }
    groups.add(new THREE.Mesh(white.build(), paintMat));
    groups.add(new THREE.Mesh(yellow.build(), paintMatY));

    // ---- sidewalk slabs + buildings per block ----
    var rng = U.rng;
    for (var bx = 0; bx < GRID; bx++) {
      for (var bz = 0; bz < GRID; bz++) {
        var cx = -HALF + (bx + 0.5) * BLOCK, cz = -HALF + (bz + 0.5) * BLOCK;
        var halfb = (BLOCK - ROAD) / 2;              // 19
        var slab = new THREE.Mesh(new THREE.BoxGeometry(halfb * 2, CURB, halfb * 2), walkMat);
        slab.position.set(cx, CURB / 2, cz);
        slab.receiveShadow = true;
        groups.add(slab);

        var isPark = rng() < 0.07 || (Math.abs(cx) < 20 && Math.abs(cz) < 20);
        if (isPark) {
          city.parks.push({ x: cx, z: cz, r: halfb - 1 });
          addPark(groups, cx, cz, halfb - 1.5);
          city.addBox(cx - halfb, CURB, cz - halfb, cx + halfb, 6, cz + halfb, 'park');
          continue;
        }
        layoutBlock(groups, cx, cz, 14.5);
      }
    }

    // ---- kerb stones around every block (one merged mesh) ----
    var curbs = U.merge();
    var kerbH = CURB + 0.03, kerbW = 0.42;
    for (var kx = 0; kx < GRID; kx++) {
      for (var kz = 0; kz < GRID; kz++) {
        var ccx = -HALF + (kx + 0.5) * BLOCK, ccz = -HALF + (kz + 0.5) * BLOCK;
        var hk = (BLOCK - ROAD) / 2;
        curbs.box(hk * 2 + kerbW * 2, kerbH, kerbW, ccx, kerbH / 2, ccz - hk - kerbW / 2);
        curbs.box(hk * 2 + kerbW * 2, kerbH, kerbW, ccx, kerbH / 2, ccz + hk + kerbW / 2);
        curbs.box(kerbW, kerbH, hk * 2, ccx - hk - kerbW / 2, kerbH / 2, ccz);
        curbs.box(kerbW, kerbH, hk * 2, ccx + hk + kerbW / 2, kerbH / 2, ccz);
      }
    }
    groups.add(new THREE.Mesh(curbs.build(), curbMat));

    // street props: lamps + traffic lights on every road line
    for (var li = 0; li <= GRID; li++) {
      for (var lj = 0; lj <= GRID; lj++) {
        var x = -HALF + li * BLOCK, z = -HALF + lj * BLOCK;
        var off = ROAD / 2 + 0.9;
        addLamp(groups, x + off, z + off, -Math.PI * 0.75);
        addLamp(groups, x - off, z - off, Math.PI * 0.25);
        if (li < GRID && lj < GRID) addTrafficLight(groups, x + off, z + off);
      }
    }

    buildSky(scene);
    return city;
  };

  function layoutBlock(parent, cx, cz, reach) {
    var r = U.rng;
    var downtown = Math.exp(-(cx * cx + cz * cz) / (2 * 150 * 150));
    var pattern = r();
    var cells = pattern < 0.35 ? [[0, 0, 1, 1]]
      : pattern < 0.6 ? [[-0.5, 0, 0.5, 1], [0.5, 0, 0.5, 1]]
      : pattern < 0.8 ? [[0, -0.5, 1, 0.5], [0, 0.5, 1, 0.5]]
      : [[-0.5, -0.5, 0.5, 0.5], [0.5, -0.5, 0.5, 0.5], [-0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var inset = U.rand(0, 1.2);
      var w = c[2] * reach * 2 - inset, d = c[3] * reach * 2 - inset;
      var px = cx + c[0] * reach, pz = cz + c[1] * reach;
      var maxH = U.lerp(12, 88, downtown);
      var h = U.rand(maxH * 0.32, maxH);
      if (r() < 0.12) h = Math.max(9, h * 0.42);          // low-rise parking garages etc.
      makeBuilding(parent, px, pz, w, d, h);
      if (r() < 0.35) makeBuilding(parent, px + U.rand(-2, 2), pz + U.rand(-2, 2), w * 0.30, d * 0.30, h + U.rand(3, 10));
    }
  }

  // Per-building UVs give correct window density without a material per building.
  function buildingGeometry(w, h, d) {
    var g = new THREE.BoxGeometry(w, h, d);
    var uv = g.attributes.uv, arr = uv.array;
    var su = [d / 4, d / 4, w / 4, w / 4, w / 4, w / 4];
    var sv = [h / 4, h / 4, 1, 1, h / 4, h / 4];
    for (var f = 0; f < 6; f++) {
      for (var v = 0; v < 4; v++) {
        var k = (f * 4 + v) * 2;
        arr[k] *= su[f]; arr[k + 1] *= sv[f];
      }
    }
    uv.needsUpdate = true;
    return g;
  }

  var buildingMats = null, roofMat = null;
  function initBuildingMats() {
    buildingMats = [];
    var tints = [0xbfc6cc, 0xa9b3bb, 0xcfc3b4, 0x9aa7b4, 0xc9b9ae, 0xb4c2c0];
    for (var i = 0; i < 6; i++) {
      var tex = U.buildingTextures(4, 6);
      var m = new THREE.MeshStandardMaterial({
        map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff,
        emissiveIntensity: 0, roughness: 0.72, metalness: 0.12, color: tints[i]
      });
      buildingMats.push(m);
      city.windowMats.push(m);
    }
    roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.95 });
  }

  function makeBuilding(parent, x, z, w, d, h) {
    if (!buildingMats) initBuildingMats();
    var y0 = CURB;
    var geo = buildingGeometry(w, h, d);
    var side = U.pick(buildingMats);
    var mesh = new THREE.Mesh(geo, [side, side, roofMat, roofMat, side, side]);
    mesh.position.set(x, y0 + h / 2, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    city.addBox(x - w / 2, y0, z - d / 2, x + w / 2, y0 + h, z + d / 2, 'building');

    if (h > 26 && w > 8 && d > 8) { // rooftop clutter
      var n = U.randInt(1, 3);
      for (var i = 0; i < n; i++) {
        var bw = U.rand(1.6, w * 0.3), bd = U.rand(1.6, d * 0.3), bh = U.rand(1.2, 3);
        var box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), roofMat);
        box.position.set(x + U.rand(-w / 2 + bw, w / 2 - bw), y0 + h + bh / 2, z + U.rand(-d / 2 + bd, d / 2 - bd));
        box.castShadow = true; parent.add(box);
      }
    }
    if (h > 60) { // antenna
      var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 10, 5),
        new THREE.MeshStandardMaterial({ color: 0x8a8f95, metalness: 0.7, roughness: 0.4 }));
      mast.position.set(x, y0 + h + 5, z); parent.add(mast);
      var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 2 }));
      bulb.position.set(x, y0 + h + 10, z); parent.add(bulb);
    }
  }

  function addPark(parent, cx, cz, r) {
    var g = new THREE.Mesh(new THREE.BoxGeometry(r * 2, 0.12, r * 2),
      new THREE.MeshStandardMaterial({ map: U.grassTexture(), roughness: 1 }));
    g.material.map.repeat.set(r, r);
    g.position.set(cx, CURB + 0.02, cz); g.receiveShadow = true; parent.add(g);
    for (var i = 0; i < 7; i++) {
      var a = U.rand(0, Math.PI * 2), d = U.rand(3, r - 2.5);
      addTree(parent, cx + Math.cos(a) * d, cz + Math.sin(a) * d, U.rand(0.8, 1.4));
    }
  }

  function addTree(parent, x, z, s) {
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.28 * s, 2.4 * s, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }));
    trunk.position.set(x, CURB + 1.2 * s, z); trunk.castShadow = true; parent.add(trunk);
    var leafMat = new THREE.MeshStandardMaterial({ color: 0x35592e, roughness: 1, flatShading: true });
    var crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 * s, 0), leafMat);
    crown.position.set(x, CURB + 3.0 * s, z); crown.castShadow = true;
    crown.scale.set(1, 1.25, 1); parent.add(crown);
    city.treeMats.push(leafMat);
  }

  function addLamp(parent, x, z, rotY) {
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0x2f3338, metalness: 0.6, roughness: 0.5 }));
    pole.position.set(x, 3, z); parent.add(pole);
    var headMat = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffe9b0, emissiveIntensity: 0.15 });
    var head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.22, 0.6), headMat);
    head.position.set(x + Math.cos(rotY) * 1.1, 5.95, z + Math.sin(rotY) * 1.1);
    head.rotation.y = -rotY; parent.add(head);
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: U.glowTexture('rgba(255,225,160,1)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    glow.scale.set(9, 9, 1);
    glow.position.set(x + Math.cos(rotY) * 1.1, 5.5, z + Math.sin(rotY) * 1.1);
    parent.add(glow);
    city.lamps.push({ headMat: headMat, glow: glow });
  }

  function addTrafficLight(parent, x, z) {
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x26292d, metalness: 0.5, roughness: 0.6 }));
    pole.position.set(x, 2.2, z); parent.add(pole);
    var mats = { r: 0xff2d2d, y: 0xffc32d, g: 0x39e05a };
    ['r', 'y', 'g'].forEach(function (c, i) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x111111, emissive: mats[c], emissiveIntensity: 0 }));
      m.position.set(x, 4.0 - i * 0.42, z + 0.05);
      parent.add(m);
      city.lamps.push({ headMat: null, traffic: { mesh: m, kind: c } });
    });
  }

  // ---------------------------------------------------------------- sky + time
  var sky, skyU, stars, sun, moon, sunLight, hemi;
  city.night = 0;
  function buildSky(scene) {
    skyU = {
      top: { value: new THREE.Color(0x2b6fd6) },
      bottom: { value: new THREE.Color(0xbfd9f2) },
      offset: { value: 120 }, exponent: { value: 0.85 }
    };
    sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 20),
      new THREE.ShaderMaterial({
        uniforms: skyU, side: THREE.BackSide, depthWrite: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform float offset; uniform float exponent;' +
          'varying vec3 vP; void main(){ float h = normalize(vP + vec3(0.0,offset,0.0)).y;' +
          'gl_FragColor = vec4(mix(bottom, top, pow(max(h,0.0), exponent)), 1.0); }'
      }));
    scene.add(sky);

    var sp = [], sc = [];
    for (var i = 0; i < 1400; i++) {
      var v = new THREE.Vector3().setFromSphericalCoords(1800, Math.acos(U.rand(-0.1, 1)), U.rand(0, Math.PI * 2));
      sp.push(v.x, v.y, v.z); var b = U.rand(0.5, 1);
      sc.push(b, b, b * 1.05);
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 9, vertexColors: true, transparent: true, opacity: 0, depthWrite: false }));
    scene.add(stars);

    sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: U.glowTexture('rgba(255,248,215,1)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sun.scale.set(420, 420, 1); scene.add(sun);
    moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: U.glowTexture('rgba(215,232,255,1)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    moon.scale.set(200, 200, 1); scene.add(moon);

    // sun + ambient rig lives here so the world is self-contained
    sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.name = 'sun-light';
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    var cam = sunLight.shadow.camera;
    cam.left = -70; cam.right = 70; cam.top = 70; cam.bottom = -70; cam.near = 1; cam.far = 420;
    sunLight.shadow.bias = -0.0006;
    scene.add(sunLight);
    scene.add(sunLight.target);
    hemi = new THREE.HemisphereLight(0x88bbff, 0x2a2f22, 0.6);
    scene.add(hemi);
    city.sunLight = sunLight;
  }

  // t: 0..24 hours
  city.setTime = function (t, scene) {
    var a = (t / 24) * Math.PI * 2 - Math.PI / 2;
    var el = Math.sin(a);                       // sun elevation -1..1
    var day = U.clamp(el * 2.2 + 0.22, 0, 1);   // 0 = night, 1 = noon
    city.night = 1 - day;

    sunLight.position.set(Math.cos(a) * 260, el * 300 + 40, 110);
    sunLight.intensity = U.lerp(0.04, 1.5, day);
    sunLight.color.setHSL(U.lerp(0.08, 0.14, day), U.lerp(0.75, 0.25, day), U.lerp(0.55, 0.95, day));
    hemi.intensity = U.lerp(0.16, 0.75, day);
    hemi.color.setHSL(0.6, 0.5, U.lerp(0.05, 0.55, day));
    hemi.groundColor.setHSL(0.08, 0.3, U.lerp(0.03, 0.25, day));

    var dusk = U.clamp(1 - Math.abs(el) * 3.2, 0, 1);   // orange band at the horizon
    skyU.top.value.setHSL(0.62, 0.55, U.lerp(0.045, 0.36, day));
    skyU.top.value.lerp(new THREE.Color().setHSL(0.03, 0.7, 0.35), dusk * 0.5);
    skyU.bottom.value.setHSL(0.58, 0.45, U.lerp(0.07, 0.78, day));
    skyU.bottom.value.lerp(new THREE.Color().setHSL(0.06, 0.85, 0.5), dusk * 0.75);

    stars.material.opacity = U.clamp(city.night * 1.4 - 0.35, 0, 0.95);
    stars.rotation.y += 0.0006;
    sun.position.set(Math.cos(a) * 1500, el * 1100, 700);
    sun.material.opacity = U.clamp(el * 3 + 0.3, 0, 1);
    moon.position.set(-Math.cos(a) * 1500, -el * 1100, -700);
    moon.material.opacity = U.clamp(-el * 3 + 0.2, 0, 0.9);

    var winOn = U.clamp(city.night * 1.6 - 0.25, 0, 1);
    for (var i = 0; i < city.windowMats.length; i++) city.windowMats[i].emissiveIntensity = winOn * 0.9;
    for (var j = 0; j < city.lamps.length; j++) {
      var L = city.lamps[j];
      if (L.glow) L.glow.material.opacity = winOn * 0.85;
      if (L.headMat) L.headMat.emissiveIntensity = 0.15 + winOn * 1.5;
      if (L.traffic) {
        var on = (Math.floor(t * 60) % 3 + 3) % 3;
        var want = (L.traffic.kind === 'r' && on === 0) || (L.traffic.kind === 'y' && on === 1) || (L.traffic.kind === 'g' && on === 2);
        L.traffic.mesh.material.emissiveIntensity = want ? 1.6 : 0.05;
      }
    }
  };

  city.districtName = function (x, z) {
    var r = Math.sqrt(x * x + z * z);
    if (r < 60) return 'CENTRAL DISTRICT';
    if (z < -120) return 'MIRABEL HILLS';
    if (z > 120) return 'PALMA BEACH';
    if (x > 120) return 'EAST VERONA';
    if (x < -120) return 'DEL SOL';
    return 'MISSION ROW';
  };

})(window.G);
