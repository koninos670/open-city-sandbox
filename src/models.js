/* Low-poly model factories: humans (player, pedestrians, cops) and vehicles. */
(function (G) {
  'use strict';
  var U = G.util;
  var M = G.models = {};

  var geoCache = {};
  function box(w, h, d) {
    var k = 'b' + w + '_' + h + '_' + d;
    return geoCache[k] || (geoCache[k] = new THREE.BoxGeometry(w, h, d));
  }
  // pivot at the top edge so the limb swings from its joint
  function limb(w, h, d) {
    var k = 'l' + w + '_' + h + '_' + d;
    if (!geoCache[k]) { var g = new THREE.BoxGeometry(w, h, d); g.translate(0, -h / 2, 0); geoCache[k] = g; }
    return geoCache[k];
  }

  var SKINS = [0xe8b48c, 0xc98b5f, 0x8d5a3b, 0xf0c9a0, 0x6b432a];
  var SHIRTS = [0xd94f4f, 0x3d7dd6, 0x2fa36b, 0xe0c04a, 0x8a5fd6, 0xe8e8e8, 0x2b2f36, 0xd97f36];
  var PANTS = [0x2b3a55, 0x3b3b3b, 0x6b5a45, 0x24303f, 0x4a4a52];
  var HAIRS = [0x2a1f18, 0x14100c, 0x513625, 0x8a6a3f, 0x6b3b1c, 0x2b2b2f];

  // heads and faces are the only textures people share, so cache them by look
  var headMatCache = {};
  function headMaterial(skin, hair) {
    var k = skin + '_' + hair;
    if (!headMatCache[k]) {
      headMatCache[k] = new THREE.MeshStandardMaterial({ map: U.faceTexture(skin, hair), roughness: 0.75 });
    }
    return headMatCache[k];
  }
  var matCache = {};
  function flatMaterial(color, rough) {
    var k = color + '_' + rough;
    if (!matCache[k]) matCache[k] = new THREE.MeshStandardMaterial({ color: color, roughness: rough });
    return matCache[k];
  }

  // opts: {shirt, pants, skin, hair, hat, vest, gunProp, detail}
  // detail adds elbows and knees, which is what lets the figure aim two-handed
  // and sit in a car; the cheap build keeps the pedestrian draw call count down.
  M.human = function (opts) {
    opts = opts || {};
    var skin = opts.skin === undefined ? U.pick(SKINS) : opts.skin;
    var shirt = opts.shirt === undefined ? U.pick(SHIRTS) : opts.shirt;
    var pants = opts.pants === undefined ? U.pick(PANTS) : opts.pants;
    var hair = opts.hair === undefined ? U.pick(HAIRS) : opts.hair;
    var detail = !!opts.detail;
    var g = new THREE.Group();

    var mShirt = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 });
    var mPants = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
    var mSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
    var mHair = new THREE.MeshStandardMaterial({ color: hair, roughness: 1 });
    var mHead = headMaterial(skin, hair);

    var chest = new THREE.Mesh(box(0.44, 0.44, 0.26), mShirt);
    chest.position.y = 1.26; chest.castShadow = true; g.add(chest);
    var torso = chest;                              // the chest is what the walk cycle turns
    var waist = new THREE.Mesh(box(0.32, 0.2, 0.23), mPants);
    waist.position.y = 0.95; g.add(waist);
    var belt = new THREE.Mesh(box(0.335, 0.055, 0.245), flatMaterial(0x1a1a1d, 0.6));
    belt.position.y = 1.055; g.add(belt);

    if (opts.vest) {
      var vest = new THREE.Mesh(box(0.48, 0.42, 0.32), flatMaterial(0x1b2430, 0.7));
      vest.position.y = 1.26; g.add(vest);
    }
    if (detail) {                                    // jacket yoke over the shoulders
      var yoke = new THREE.Mesh(box(0.5, 0.09, 0.28), mShirt);
      yoke.position.y = 1.44; g.add(yoke);
    }

    var neck = new THREE.Mesh(box(0.115, 0.09, 0.115), mSkin);
    neck.position.y = 1.52; g.add(neck);

    var head = new THREE.Mesh(geoCache.head || (geoCache.head = new THREE.SphereGeometry(0.118, 14, 12)), mHead);
    head.position.y = 1.645; head.castShadow = true; g.add(head);

    var cap = new THREE.Mesh(geoCache.cap || (geoCache.cap = new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), mHair);
    cap.position.y = 1.668; g.add(cap);
    if (detail) {
      var nose = new THREE.Mesh(box(0.042, 0.05, 0.05), mSkin);
      nose.position.set(0, 1.638, 0.118); g.add(nose);
      [-1, 1].forEach(function (se) {
        var ear = new THREE.Mesh(box(0.022, 0.055, 0.032), mSkin);
        ear.position.set(se * 0.118, 1.648, 0.005); g.add(ear);
      });
    }
    if (opts.hat) {
      var brim = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.035, 12), flatMaterial(0x14181f, 0.80));
      brim.position.y = 1.70; g.add(brim);
      var badgeHat = new THREE.Mesh(box(0.05, 0.03, 0.02), flatMaterial(0xd8c46a, 0.4));
      badgeHat.position.set(0, 1.665, 0.115); g.add(badgeHat);
    }

    function hand(mat) {
      return new THREE.Mesh(box(0.095, 0.105, 0.10), mat);
    }
    function arm(x) {
      var a = new THREE.Group(); a.position.set(x, 1.43, 0); g.add(a);
      if (detail) {
        var upper = new THREE.Mesh(limb(0.105, 0.32, 0.105), mShirt);
        upper.castShadow = true; a.add(upper);
        var fore = new THREE.Group(); fore.position.y = -0.32; a.add(fore);
        var lower = new THREE.Mesh(limb(0.092, 0.28, 0.092), mSkin);
        fore.add(lower);
        var h = hand(mSkin); h.position.y = -0.30; fore.add(h);
        a.userData.fore = fore; a.userData.hand = h;
      } else {
        var limbArm = new THREE.Mesh(limb(0.13, 0.60, 0.13), mShirt);
        limbArm.castShadow = true; a.add(limbArm);
        var h2 = hand(mSkin); h2.position.y = -0.62; a.add(h2);
        a.userData.hand = h2;
      }
      return a;
    }
    function leg(x) {
      var l = new THREE.Group(); l.position.set(x, 0.92, 0); g.add(l);
      if (detail) {
        var thigh = new THREE.Mesh(limb(0.165, 0.46, 0.165), mPants);
        thigh.castShadow = true; l.add(thigh);
        var shin = new THREE.Group(); shin.position.y = -0.46; l.add(shin);
        var calf = new THREE.Mesh(limb(0.145, 0.42, 0.145), mPants);
        shin.add(calf);
        var shoe = new THREE.Mesh(box(0.165, 0.1, 0.27), flatMaterial(0x1c1c1f, 0.9));
        shoe.position.set(0, -0.44, 0.05); shin.add(shoe);
        l.userData.shin = shin;
      } else {
        var whole = new THREE.Mesh(limb(0.185, 0.9, 0.185), mPants);
        whole.castShadow = true; l.add(whole);
        var shoe2 = new THREE.Mesh(box(0.185, 0.11, 0.28), flatMaterial(0x1c1c1f, 0.9));
        shoe2.position.set(0, -0.88, 0.045); l.add(shoe2);
      }
      return l;
    }
    var armL = arm(-0.265), armR = arm(0.265), legL = leg(-0.135), legR = leg(0.135);
    g.userData.parts = {
      armL: armL, armR: armR, legL: legL, legR: legR,
      foreL: armL.userData.fore, foreR: armR.userData.fore,
      shinL: legL.userData.shin, shinR: legR.userData.shin,
      handL: armL.userData.hand, handR: armR.userData.hand,
      torso: torso, chest: chest, head: head
    };

    if (opts.gunProp) {                              // cops carry the pistol model
      var gun = M.weapon('pistol');
      gun.position.set(0, -0.055, 0.02);
      armR.userData.hand.add(gun);
      g.userData.gunProp = gun;
    }
    return g;
  };

  // swing amplitude 0..1 (walk) or 1..1.6 (run)
  M.animateHuman = function (g, phase, amp, aiming) {
    var p = g.userData.parts;
    if (!p) return;
    var s = Math.sin(phase), c = Math.cos(phase);
    if (aiming) {
      p.armL.rotation.set(-1.35, 0, 0.18); p.armR.rotation.set(-1.35, 0, -0.18);
      p.legL.rotation.x = s * 0.35 * amp; p.legR.rotation.x = -s * 0.35 * amp;
      p.torso.rotation.y = 0;
      return;
    }
    p.armL.rotation.set(s * 0.9 * amp, 0, 0.08);
    p.armR.rotation.set(-s * 0.9 * amp, 0, -0.08);
    p.legL.rotation.x = -s * 1.0 * amp; p.legR.rotation.x = s * 1.0 * amp;
    p.torso.rotation.y = c * 0.08 * amp;
    g.position.y = Math.abs(c) * 0.04 * amp;
    if (p.foreL) {                                   // elbows lag the swing a little
      p.foreL.rotation.set(-Math.max(0, s) * 0.45 * amp, 0, 0);
      p.foreR.rotation.set(-Math.max(0, -s) * 0.45 * amp, 0, 0);
    }
    if (p.shinL) {
      p.shinL.rotation.x = Math.max(0, -s) * 0.7 * amp;
      p.shinR.rotation.x = Math.max(0, s) * 0.7 * amp;
    }
  };

  M.panic = function (g, phase) {
    var p = g.userData.parts;
    if (!p) return;
    var s = Math.sin(phase * 1.6);
    p.armL.rotation.set(-2.4, 0, 0.5 + s * 0.15); p.armR.rotation.set(-2.4, 0, -0.5 - s * 0.15);
    p.legL.rotation.x = -s * 1.15; p.legR.rotation.x = s * 1.15;
  };

  // Both hands on the gun, pointing where the camera looks.
  M.aimPose = function (g, pitch) {
    var p = g.userData.parts;
    if (!p) return;
    p.armR.rotation.set(-1.5 + pitch * 0.55, 0, -0.14);
    p.armL.rotation.set(-1.34 + pitch * 0.55, 0, 0.5);
    if (p.foreR) p.foreR.rotation.set(-0.2, 0, 0);
    if (p.foreL) p.foreL.rotation.set(-0.55, 0.35, 0);
    p.torso.rotation.y = -0.1;
  };

  // Sitting in the driver seat: thighs forward, shins down, hands on the wheel.
  M.seatedPose = function (g, steer) {
    var p = g.userData.parts;
    if (!p) return;
    p.armL.rotation.set(-1.1, 0, 0.34); p.armR.rotation.set(-1.1, 0, -0.34);
    if (p.foreL) p.foreL.rotation.set(-0.85, 0, 0.22 * steer);
    if (p.foreR) p.foreR.rotation.set(-0.85, 0, 0.22 * steer);
    p.legL.rotation.set(-1.42, 0, 0.05); p.legR.rotation.set(-1.42, 0, -0.05);
    if (p.shinL) {
      p.shinL.rotation.x = 1.34; p.shinR.rotation.x = 1.34;
    }
    p.torso.rotation.y = 0;
    g.position.y = 0;
  };

  // ---- weapons: origin sits in the fist, barrel points down local +Z ----
  var WM = {};
  function wMetal() { return flatMaterial(0x1d2023, 0.35); }
  function wPoly() { return flatMaterial(0x23262a, 0.6); }
  function wWood() { return flatMaterial(0x6b4423, 0.75); }
  function part(parent, geo, mat, x, y, z, rx) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    m.castShadow = false;
    parent.add(m);
    return m;
  }
  function tube(parent, r, len, mat, x, y, z) {
    var g2 = new THREE.CylinderGeometry(r, r, len, 8);
    g2.rotateX(Math.PI / 2);                        // lie along +Z
    return part(parent, g2, mat, x, y, z);
  }

  M.weapon = function (kind) {
    if (!WM[kind]) WM[kind] = buildWeapon(kind);
    var g = WM[kind].clone();
    // Object3D.clone stringifies userData, so re-attach the live muzzle marker
    g.userData.muzzle = g.getObjectByName('muzzle');
    return g;
  };

  function buildWeapon(kind) {
    var g = new THREE.Group();
    var metal = wMetal(), poly = wPoly(), wood = wWood();
    if (kind === 'pistol') {
      part(g, box(0.035, 0.052, 0.20), metal, 0, 0.072, 0.09);
      part(g, box(0.032, 0.038, 0.15), poly, 0, 0.036, 0.07);
      part(g, box(0.036, 0.125, 0.062), poly, 0, -0.03, -0.012, -0.3);
      part(g, box(0.028, 0.012, 0.05), poly, 0, 0.0, 0.045);
      part(g, box(0.008, 0.014, 0.008), metal, 0.019, 0.062, -0.005);
      tube(g, 0.009, 0.02, wMetal(), 0, 0.072, 0.20);
    } else if (kind === 'smg') {
      part(g, box(0.045, 0.088, 0.26), metal, 0, 0.05, 0.07);
      part(g, box(0.04, 0.055, 0.2), poly, 0, 0.045, 0.05);
      tube(g, 0.013, 0.14, metal, 0, 0.05, 0.26);
      part(g, box(0.03, 0.17, 0.05), poly, 0, -0.075, 0.10, 0.1);
      part(g, box(0.038, 0.12, 0.055), poly, 0, -0.045, -0.02, -0.22);
      part(g, box(0.042, 0.055, 0.14), poly, 0, 0.045, -0.13);
      part(g, box(0.03, 0.02, 0.09), metal, 0, 0.098, 0.12);
    } else if (kind === 'rifle') {
      part(g, box(0.05, 0.1, 0.34), metal, 0, 0.06, 0.04);
      part(g, box(0.046, 0.06, 0.2), wood, 0, 0.05, 0.22);
      tube(g, 0.015, 0.34, metal, 0, 0.062, 0.42);
      tube(g, 0.026, 0.19, metal, 0, 0.135, 0.06);
      part(g, box(0.02, 0.05, 0.02), metal, 0, 0.1, -0.02);
      part(g, box(0.02, 0.05, 0.02), metal, 0, 0.1, 0.14);
      part(g, box(0.035, 0.16, 0.055), poly, 0, -0.07, 0.06, 0.06);
      part(g, box(0.038, 0.11, 0.05), poly, 0, -0.04, -0.05, -0.25);
      part(g, box(0.048, 0.085, 0.22), wood, 0, 0.045, -0.25, 0.04);
    } else {                                          // shotgun
      tube(g, 0.021, 0.5, metal, 0, 0.072, 0.34);
      tube(g, 0.014, 0.42, metal, 0, 0.036, 0.30);
      part(g, box(0.052, 0.05, 0.13), wood, 0, 0.036, 0.26);
      part(g, box(0.05, 0.1, 0.22), metal, 0, 0.062, 0.03);
      part(g, box(0.028, 0.012, 0.05), poly, 0, 0.005, 0.05);
      part(g, box(0.04, 0.11, 0.05), poly, 0, -0.04, -0.04, -0.25);
      part(g, box(0.058, 0.1, 0.28), wood, 0, 0.02, -0.2, 0.05);
    }
    var muzzle = new THREE.Object3D();
    muzzle.name = 'muzzle';
    muzzle.position.set(0, kind === 'pistol' ? 0.072 : kind === 'shotgun' ? 0.072 : 0.06,
      kind === 'pistol' ? 0.21 : kind === 'smg' ? 0.33 : kind === 'rifle' ? 0.60 : 0.60);
    g.add(muzzle);
    g.userData.muzzle = muzzle;
    g.userData.kind = kind;
    return g;
  }

  // muzzle world position of a weapon group (fallback: the group's own origin)
  M.muzzleWorld = function (gun, out) {
    var m = gun && gun.userData && gun.userData.muzzle;
    if (!m) return out.set(0, 0, 0);
    return m.getWorldPosition(out);
  };

  // ---- vehicles: nose points down local +Z ----
  // Road-car proportions in metres: floor, beltline and roof heights are what
  // make a car read as a car, so they are per type rather than derived.
  M.CAR_TYPES = {
    sedan:  { len: 4.34, wid: 1.84, mass: 1.00, wr: 0.33, sill: 0.30, belt: 0.86, roof: 1.44, cabL: 1.55, cabZ: -0.15, over: 0.80 },
    coupe:  { len: 4.16, wid: 1.90, mass: 0.95, wr: 0.33, sill: 0.26, belt: 0.84, roof: 1.38, cabL: 1.30, cabZ: -0.22, over: 0.72 },
    suv:    { len: 4.86, wid: 2.00, mass: 1.35, wr: 0.39, sill: 0.38, belt: 1.06, roof: 1.82, cabL: 1.80, cabZ: -0.10, over: 0.92 },
    van:    { len: 5.28, wid: 2.02, mass: 1.50, wr: 0.35, sill: 0.40, belt: 1.12, roof: 2.14, cabL: 2.70, cabZ: -0.05, over: 1.00 },
    taxi:   { len: 4.52, wid: 1.88, mass: 1.05, wr: 0.33, sill: 0.30, belt: 0.90, roof: 1.54, cabL: 1.65, cabZ: -0.10, over: 0.84 },
    police: { len: 4.62, wid: 1.92, mass: 1.10, wr: 0.32, sill: 0.28, belt: 0.86, roof: 1.40, cabL: 1.60, cabZ: -0.14, over: 0.86 }
  };
  M.CAR_COLORS = [0xb01d2a, 0x1e4f9c, 0x22242a, 0xd8d8d8, 0xe0b429, 0x2f7d4f, 0x8a4bd6, 0xd97f36, 0x6d757d, 0xf2f2f2];

  function tyreGeo(r) {
    var k = 'tyre' + r;
    if (!geoCache[k]) { var g = new THREE.CylinderGeometry(r, r, 0.25, 18); g.rotateZ(Math.PI / 2); geoCache[k] = g; }
    return geoCache[k];
  }
  // five-spoke alloy: hub, spokes and a rim lip, all one mesh
  function rimGeo(r) {
    var k = 'rim' + r;
    if (!geoCache[k]) {
      var b = U.merge(), I = new THREE.Matrix4();
      b.raw(new THREE.CylinderGeometry(r * 0.34, r * 0.34, 0.27, 12).rotateZ(Math.PI / 2), I);
      b.raw(new THREE.TorusGeometry(r * 0.72, 0.042, 5, 16).rotateY(Math.PI / 2), I);
      for (var i = 0; i < 5; i++) {
        var th = i * Math.PI * 2 / 5;
        b.box(0.26, r * 0.86, 0.075, 0, Math.cos(th) * r * 0.45, Math.sin(th) * r * 0.45, th, 0, 0);
      }
      geoCache[k] = b.build();
    }
    return geoCache[k];
  }

  M.car = function (typeKey, color) {
    var T = M.CAR_TYPES[typeKey] || M.CAR_TYPES.sedan;
    if (color === undefined) color = U.pick(M.CAR_COLORS);
    var L = T.len, W = T.wid, wr = T.wr, sill = T.sill, belt = T.belt, roof = T.roof;
    var axleZ = L / 2 - T.over, archL = wr * 2.15, archTop = wr * 2 + 0.07;
    var cabL = T.cabL, cabZ = T.cabZ;
    var g = new THREE.Group();

    var mBody = new THREE.MeshStandardMaterial({ color: color, roughness: 0.3, metalness: 0.5 });
    var mTrim = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.78, metalness: 0.08 });
    var mChrome = new THREE.MeshStandardMaterial({ color: 0xccd1d6, roughness: 0.2, metalness: 0.95 });
    var mGlass = new THREE.MeshStandardMaterial({ color: 0x0b141c, roughness: 0.07, metalness: 0.5, transparent: true, opacity: 0.66 });
    var mInner = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.95 });
    var mRim = new THREE.MeshStandardMaterial({ color: 0xa8adb3, roughness: 0.28, metalness: 0.9 });

    var bP = U.merge(), bT = U.merge(), bC = U.merge(), bG = U.merge(), bI = U.merge();

    // ---- body: three side segments plus an arch roof per wheel, which is
    // what leaves a real wheel cut-out instead of burying the tyres ----
    var archHalf = archL / 2;
    var noseLen = L / 2 - axleZ - archHalf, tailLen = noseLen;
    bP.box(W, belt - sill, 2 * (axleZ - archHalf), 0, (sill + belt) / 2, 0);
    bP.box(W, belt - sill, noseLen, 0, (sill + belt) / 2, (axleZ + archHalf + L / 2) / 2);
    bP.box(W, belt - sill, tailLen, 0, (sill + belt) / 2, -(axleZ + archHalf + L / 2) / 2);
    bP.box(W, belt - archTop, archL, 0, (archTop + belt) / 2, axleZ);
    bP.box(W, belt - archTop, archL, 0, (archTop + belt) / 2, -axleZ);
    bP.box(W * 0.88, sill - 0.05, L * 0.98, 0, 0.025 + (sill - 0.05) / 2, 0);   // floor pan
    [axleZ, -axleZ].forEach(function (az) {                           // wheel arch lips
      bP.box(W + 0.05, 0.09, archL + 0.05, 0, archTop + 0.02, az);
    });

    // ---- greenhouse ----
    var rakeF = (roof - belt) * 0.95, rakeR = (roof - belt) * 0.7;
    var zf0 = cabZ + cabL / 2, zf1 = zf0 - rakeF;
    var zr0 = cabZ - cabL / 2, zr1 = zr0 + rakeR;
    function raked(bld, w, th, y0, y1, z0, z1, x) {
      var dy = y1 - y0, dz = z1 - z0, len = Math.sqrt(dy * dy + dz * dz);
      bld.box(w, len, th, x || 0, (y0 + y1) / 2, (z0 + z1) / 2, Math.atan2(dz, dy), 0, 0);
    }
    raked(bG, W * 0.90, 0.05, belt + 0.01, roof - 0.02, zf0, zf1);      // windscreen
    raked(bG, W * 0.90, 0.05, belt + 0.01, roof - 0.02, zr0, zr1);      // rear window
    // Side glass: one trapezoid quad per side whose front and rear edges follow
    // the A and C pillars. A plain box pane leaves an open triangle at each end,
    // through which you can see straight out of the cabin.
    function sideGlass(bld, y0, y1, zF0, zF1, zR0, zR1, x) {
      var g = new THREE.BufferGeometry(), nn = new Float32Array(18), i;
      var n = x < 0 ? -1 : 1;
      for (i = 0; i < 6; i++) nn[i * 3] = n;
      var front = [[y0, zF0], [y1, zF1], [y1, zR1], [y0, zF0], [y1, zR1], [y0, zR0]];
      var back = [[y0, zF0], [y1, zR1], [y1, zF1], [y0, zF0], [y0, zR0], [y1, zR1]];
      var v = n < 0 ? front : back, p = new Float32Array(18);
      for (i = 0; i < 6; i++) { p[i * 3] = x; p[i * 3 + 1] = v[i][0]; p[i * 3 + 2] = v[i][1]; }
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
      bld.raw(g, new THREE.Matrix4());
    }
    [-1, 1].forEach(function (sx) {
      sideGlass(bG, belt + 0.01, roof - 0.02, zf0, zf1, zr0, zr1, sx * (W / 2 * 0.9));
    });
    bP.box(W * 0.88, 0.05, zf1 - zr1, 0, roof - 0.025, (zf1 + zr1) / 2); // roof panel
    [-1, 1].forEach(function (sx) {
      raked(bP, 0.075, 0.07, belt, roof, zf0, zf1, sx * (W / 2 * 0.9));  // A pillar
      raked(bP, 0.07, 0.07, belt, roof, zr0, zr1, sx * (W / 2 * 0.9));   // C pillar
      bP.box(0.07, roof - belt, 0.09, sx * (W / 2 * 0.9), (belt + roof) / 2, cabZ + cabL * 0.02); // B pillar
    });
    if (typeKey === 'suv' || typeKey === 'van') {                       // roof rails
      [-1, 1].forEach(function (sx) {
        bT.box(0.05, 0.045, zf1 - zr1 - 0.1, sx * (W * 0.32), roof + 0.02, (zf1 + zr1) / 2);
      });
    }

    // ---- front and rear ends ----
    bT.box(W * 1.01, 0.26, 0.16, 0, sill + 0.11, L / 2 + 0.04);         // bumpers
    bT.box(W * 1.01, 0.26, 0.16, 0, sill + 0.11, -L / 2 - 0.04);
    bT.box(W * 0.94, 0.13, 0.12, 0, sill - 0.05, L / 2 + 0.03);         // front lip / rear valance
    bT.box(W * 0.94, 0.13, 0.12, 0, sill - 0.05, -L / 2 - 0.03);
    bT.box(W * 0.52, 0.15, 0.07, 0, belt - 0.15, L / 2 + 0.01);         // grille
    bC.box(W * 0.55, 0.02, 0.03, 0, belt - 0.075, L / 2 + 0.02);
    bC.box(0.13, 0.08, 0.13, W * 0.28, sill - 0.07, -L / 2 - 0.07);     // exhaust tip
    bT.box(W * 0.84, 0.06, 0.05, 0, belt - 0.02, L / 2 - 0.12);         // shutline under the bonnet

    // ---- side detailing ----
    var midLen = 2 * (axleZ - archHalf);
    bT.box(W * 0.9, 0.13, Math.min(midLen + 1.3, L * 0.66), 0, sill + 0.03, 0);   // rocker
    [-1, 1].forEach(function (sx) {
      bC.box(0.016, 0.026, cabL * 0.99, sx * (W / 2 + 0.005), belt - 0.035, cabZ);   // belt trim
      [cabZ + cabL * 0.33, cabZ - cabL * 0.3].forEach(function (sz) {
        bT.box(0.012, belt - sill - 0.08, 0.02, sx * (W / 2 + 0.004), (sill + belt) / 2, sz);
        bC.box(0.022, 0.036, 0.15, sx * (W / 2 + 0.012), belt - 0.11, sz + 0.09);     // door handle
      });
      bT.box(0.11, 0.035, 0.06, sx * (W / 2 + 0.055), belt + 0.05, cabZ + cabL * 0.4); // mirror stalk
      bP.box(0.15, 0.1, 0.055, sx * (W / 2 + 0.14), belt + 0.06, cabZ + cabL * 0.4);   // mirror cap
    });

    // ---- interior (visible through the glass, and the driver sits here) ----
    var seatZ = cabZ - cabL * 0.02;
    bI.box(W * 0.9, 0.17, 0.44, 0, belt - 0.16, cabZ + cabL * 0.4);       // dashboard
    bI.box(0.08, 0.08, 0.34, -W * 0.19, belt - 0.16, cabZ + cabL * 0.34); // steering column
    bI.raw(new THREE.TorusGeometry(0.15, 0.024, 5, 14), new THREE.Matrix4().compose(
      new THREE.Vector3(-W * 0.19, belt - 0.1, cabZ + cabL * 0.28),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.28, 0, 0)), new THREE.Vector3(1, 1, 1)));
    [-1, 1].forEach(function (sx) {
      bI.box(0.44, 0.32, 0.46, sx * W * 0.19, sill + 0.2, seatZ);         // cushion
      bI.box(0.44, 0.6, 0.11, sx * W * 0.19, sill + 0.5, seatZ - 0.26);   // backrest
    });
    bI.box(W * 0.82, 0.26, 0.42, 0, sill + 0.17, seatZ - 0.66);           // rear bench
    if (typeKey === 'taxi') {                                             // roof sign
      bC.box(0.5, 0.15, 0.2, 0, roof + 0.08, cabZ + cabL * 0.16);
    }

    // ---- lights ----
    var headMats = [], tailMats = [], headGlows = [];
    [-1, 1].forEach(function (s) {
      var hm = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, emissive: 0xfff0cf, emissiveIntensity: 0.18 });
      var h = new THREE.Mesh(box(0.40, 0.13, 0.06), hm);
      h.position.set(s * (W / 2 - 0.3), belt - 0.11, L / 2 + 0.015); g.add(h); headMats.push(hm);
      var tm = new THREE.MeshStandardMaterial({ color: 0x4a0406, emissive: 0xff2a14, emissiveIntensity: 0.3 });
      var t = new THREE.Mesh(box(0.42, 0.12, 0.05), tm);
      t.position.set(s * (W / 2 - 0.3), belt - 0.1, -L / 2 - 0.015); g.add(t); tailMats.push(tm);
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: U.glowTexture('rgba(255,240,200,1)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
      glow.scale.set(3.4, 3.4, 1);
      glow.position.set(s * (W / 2 - 0.3), belt - 0.11, L / 2 + 0.5);
      g.add(glow);
      headGlows.push(glow);
    });

    var bodyMesh = new THREE.Mesh(bP.build(), mBody);
    var trimMesh = new THREE.Mesh(bT.build(), mTrim);
    var chromeMesh = new THREE.Mesh(bC.build(), mChrome);
    var glassMesh = new THREE.Mesh(bG.build(), mGlass);
    var innerMesh = new THREE.Mesh(bI.build(), mInner);
    [bodyMesh, trimMesh, chromeMesh].forEach(function (m) { m.castShadow = true; m.receiveShadow = true; });
    glassMesh.castShadow = false; glassMesh.receiveShadow = false;
    g.add(bodyMesh, trimMesh, chromeMesh, glassMesh, innerMesh);

    // ---- wheels: steer about Y, roll about X, so the order must be YXZ ----
    var wheels = [];
    var ax = W / 2 - 0.09;
    [[-ax, axleZ], [ax, axleZ], [-ax, -axleZ], [ax, -axleZ]].forEach(function (p, idx) {
      var w = new THREE.Group();
      var tyre = new THREE.Mesh(tyreGeo(wr), mTrim); tyre.castShadow = true;
      var rim = new THREE.Mesh(rimGeo(wr), mRim); rim.castShadow = false;
      w.add(tyre, rim);
      w.position.set(p[0], wr, p[1]);
      w.rotation.order = 'YXZ';
      w.userData.front = idx < 2;
      g.add(w); wheels.push(w);
    });

    var car = {
      group: g, type: typeKey, T: T, wheels: wheels, body: bodyMesh, seat: {
        x: -W * 0.19, y: sill - 0.57, z: seatZ
      },
      roofY: roof, beltY: belt, headMats: headMats, tailMats: tailMats, headGlows: headGlows,
      color: color, mBody: mBody,
      halfLen: L / 2, halfWid: W / 2, health: 100, burning: false
    };

    if (typeKey === 'police') {
      var stripe = new THREE.Mesh(box(W + 0.02, 0.3, L * 0.62), new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.6 }));
      stripe.position.set(0, sill + 0.06, 0); g.add(stripe);
      var decal = new THREE.Mesh(box(W + 0.03, 0.16, L * 0.3), new THREE.MeshStandardMaterial({ color: 0xf0f0f0 }));
      decal.position.set(0, belt - 0.16, -L * 0.1); g.add(decal);
    }
    return car;
  };

  // ---- pickups ----
  M.pickup = function (kind) {
    var g = new THREE.Group();
    var core;
    if (kind === 'health') {
      var m = new THREE.MeshStandardMaterial({ color: 0x39d36a, emissive: 0x1f8f42, emissiveIntensity: 0.7 });
      core = new THREE.Group();
      var a = new THREE.Mesh(box(0.12, 0.5, 0.12), m), b = new THREE.Mesh(box(0.5, 0.12, 0.12), m);
      core.add(a, b);
    } else if (kind === 'armor') {
      core = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0),
        new THREE.MeshStandardMaterial({ color: 0x46a3ff, emissive: 0x1c5fa8, emissiveIntensity: 0.6, flatShading: true }));
      core.scale.set(1, 1.2, 0.5);
    } else if (kind === 'ammo') {
      core = new THREE.Group();
      var boxm = new THREE.Mesh(box(0.46, 0.3, 0.34), new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.7 }));
      core.add(boxm);
      for (var i = 0; i < 3; i++) {
        var b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.24, 6),
          new THREE.MeshStandardMaterial({ color: 0xd9b23a, metalness: 0.8, roughness: 0.3 }));
        b.position.set(-0.12 + i * 0.12, 0.2, 0); core.add(b);
      }
    } else { // cash
      core = new THREE.Group();
      for (var k = 0; k < 4; k++) {
        var note = new THREE.Mesh(box(0.5, 0.03, 0.28),
          new THREE.MeshStandardMaterial({ color: 0x5ec46b, emissive: 0x1d6b2c, emissiveIntensity: 0.5, roughness: 0.8 }));
        note.position.y = k * 0.035; note.rotation.y = U.rand(-0.2, 0.2); core.add(note);
      }
    }
    core.position.y = 0.75; g.add(core);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.03, 6, 20),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.35; g.add(ring);
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: U.glowTexture(kind === 'health' ? 'rgba(90,255,140,1)' : kind === 'armor' ? 'rgba(90,180,255,1)' : kind === 'ammo' ? 'rgba(255,220,120,1)' : 'rgba(120,255,150,1)'),
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.45
    }));
    glow.scale.set(2.2, 2.2, 1); glow.position.y = 0.75; g.add(glow);
    g.userData.core = core;
    return g;
  };

})(window.G);
