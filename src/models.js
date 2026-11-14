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

  // opts: {shirt, pants, skin, h, hat, vest, uniform}
  M.human = function (opts) {
    opts = opts || {};
    var skin = opts.skin === undefined ? U.pick(SKINS) : opts.skin;
    var shirt = opts.shirt === undefined ? U.pick(SHIRTS) : opts.shirt;
    var pants = opts.pants === undefined ? U.pick(PANTS) : opts.pants;
    var g = new THREE.Group();

    var mShirt = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 });
    var mPants = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
    var mSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
    var mHair = new THREE.MeshStandardMaterial({ color: opts.hair === undefined ? 0x2a1f18 : opts.hair, roughness: 1 });

    var torso = new THREE.Mesh(box(0.52, 0.64, 0.3), mShirt);
    torso.position.y = 1.2; torso.castShadow = true; g.add(torso);

    if (opts.vest) {
      var vest = new THREE.Mesh(box(0.58, 0.6, 0.36), new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.7 }));
      vest.position.y = 1.2; g.add(vest);
    }

    var neck = new THREE.Mesh(box(0.14, 0.1, 0.14), mSkin);
    neck.position.y = 1.56; g.add(neck);

    var head = new THREE.Mesh(geoCache.head || (geoCache.head = new THREE.SphereGeometry(0.155, 10, 8)), mSkin);
    head.position.y = 1.71; head.castShadow = true; g.add(head);

    var cap = new THREE.Mesh(new THREE.SphereGeometry(0.165, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.62), mHair);
    cap.position.y = 1.72; g.add(cap);
    if (opts.hat) {
      var brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12), mHair);
      brim.position.y = 1.76; g.add(brim);
    }

    function arm(x) {
      var a = new THREE.Mesh(limb(0.15, 0.62, 0.15), mShirt);
      a.position.set(x, 1.5, 0); a.castShadow = true; g.add(a);
      var hand = new THREE.Mesh(box(0.13, 0.14, 0.13), mSkin);
      hand.position.y = -0.64; a.add(hand);
      return a;
    }
    function leg(x) {
      var l = new THREE.Mesh(limb(0.19, 0.92, 0.19), mPants);
      l.position.set(x, 0.92, 0); l.castShadow = true; g.add(l);
      var shoe = new THREE.Mesh(box(0.2, 0.12, 0.28), new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.9 }));
      shoe.position.set(0, -0.9, 0.04); l.add(shoe);
      return l;
    }
    var armL = arm(-0.34), armR = arm(0.34), legL = leg(-0.14), legR = leg(0.14);
    g.userData.parts = { armL: armL, armR: armR, legL: legL, legR: legR, torso: torso, head: head };

    if (opts.gunProp) {
      var gun = new THREE.Mesh(box(0.08, 0.14, 0.42), new THREE.MeshStandardMaterial({ color: 0x1a1a1c, metalness: 0.6, roughness: 0.4 }));
      gun.position.set(0, -0.68, 0.28); armR.add(gun);
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
      p.armL.rotation.x = -1.35; p.armR.rotation.x = -1.35;
      p.armL.rotation.z = 0.18; p.armR.rotation.z = -0.18;
      p.legL.rotation.x = s * 0.35 * amp; p.legR.rotation.x = -s * 0.35 * amp;
      p.torso.rotation.y = 0;
      return;
    }
    p.armL.rotation.x = s * 0.9 * amp; p.armR.rotation.x = -s * 0.9 * amp;
    p.armL.rotation.z = 0.08; p.armR.rotation.z = -0.08;
    p.legL.rotation.x = -s * 1.0 * amp; p.legR.rotation.x = s * 1.0 * amp;
    p.torso.rotation.y = c * 0.08 * amp;
    g.position.y = Math.abs(c) * 0.04 * amp;
  };

  M.panic = function (g, phase) {
    var p = g.userData.parts;
    if (!p) return;
    var s = Math.sin(phase * 1.6);
    p.armL.rotation.x = -2.4; p.armR.rotation.x = -2.4;
    p.armL.rotation.z = 0.5 + s * 0.15; p.armR.rotation.z = -0.5 - s * 0.15;
    p.legL.rotation.x = -s * 1.15; p.legR.rotation.x = s * 1.15;
  };

  // ---- vehicles: nose points down local +Z ----
  M.CAR_TYPES = {
    sedan: { len: 4.3, wid: 1.86, mass: 1, h: 0.6 },
    coupe: { len: 4.1, wid: 1.94, mass: 0.95, h: 0.52 },
    suv: { len: 4.9, wid: 2.02, mass: 1.35, h: 0.78 },
    van: { len: 5.3, wid: 2.06, mass: 1.5, h: 0.95 },
    taxi: { len: 4.5, wid: 1.9, mass: 1.05, h: 0.6 },
    police: { len: 4.6, wid: 1.94, mass: 1.1, h: 0.62 }
  };
  M.CAR_COLORS = [0xb01d2a, 0x1e4f9c, 0x22242a, 0xd8d8d8, 0xe0b429, 0x2f7d4f, 0x8a4bd6, 0xd97f36, 0x6d757d, 0xf2f2f2];

  M.car = function (typeKey, color) {
    var T = M.CAR_TYPES[typeKey] || M.CAR_TYPES.sedan;
    var color = color === undefined ? U.pick(M.CAR_COLORS) : color;
    var g = new THREE.Group();
    var mBody = new THREE.MeshStandardMaterial({ color: color, roughness: 0.35, metalness: 0.55 });
    var mGlass = new THREE.MeshStandardMaterial({ color: 0x0d1a24, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.72 });
    var mTrim = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 });
    var L = T.len, W = T.wid, H = T.h;

    var body = new THREE.Mesh(box(W, H, L), mBody);
    body.position.y = 0.48 + H / 2; body.castShadow = true; g.add(body);

    var cabinH = typeKey === 'van' ? 0.85 : typeKey === 'suv' ? 0.72 : 0.56;
    var cabinL = L * (typeKey === 'van' ? 0.66 : 0.44);
    var cabin = new THREE.Mesh(box(W * 0.9, cabinH, cabinL), mBody);
    cabin.position.set(0, 0.48 + H + cabinH / 2 - 0.04, L * (typeKey === 'van' ? 0.02 : -0.08));
    cabin.castShadow = true; g.add(cabin);

    var glass = new THREE.Mesh(box(W * 0.92, cabinH * 0.62, cabinL * 0.99), mGlass);
    glass.position.copy(cabin.position); glass.position.y += 0.03; g.add(glass);

    // wheels: geometry rotated so mesh.rotation.x spins them
    var wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    var rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.28, 8);
    rimGeo.rotateZ(Math.PI / 2);
    var mRim = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.3 });
    var wheels = [];
    var ax = W / 2 - 0.06, az = L / 2 - 0.95;
    [[-ax, az], [ax, az], [-ax, -az], [ax, -az]].forEach(function (p) {
      var w = new THREE.Group();
      var tyre = new THREE.Mesh(wheelGeo, mTrim); w.add(tyre);
      var rim = new THREE.Mesh(rimGeo, mRim); w.add(rim);
      w.position.set(p[0], 0.36, p[1]);
      g.add(w); wheels.push(w);
    });

    var headMats = [], tailMats = [], headGlows = [];
    [-1, 1].forEach(function (s) {
      var hm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d0, emissiveIntensity: 0.2 });
      var h = new THREE.Mesh(box(0.42, 0.2, 0.1), hm);
      h.position.set(s * (W / 2 - 0.34), 0.72, L / 2 + 0.01); g.add(h); headMats.push(hm);
      var tm = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2200, emissiveIntensity: 0.25 });
      var t = new THREE.Mesh(box(0.4, 0.18, 0.08), tm);
      t.position.set(s * (W / 2 - 0.32), 0.78, -L / 2 - 0.01); g.add(t); tailMats.push(tm);
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: U.glowTexture('rgba(255,240,200,1)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
      glow.scale.set(3.4, 3.4, 1);
      glow.position.set(s * (W / 2 - 0.34), 0.72, L / 2 + 0.5);
      g.add(glow);
      headGlows.push(glow);
    });

    var car = {
      group: g, type: typeKey, T: T, wheels: wheels, body: body,
      headMats: headMats, tailMats: tailMats, headGlows: headGlows, color: color, mBody: mBody,
      halfLen: L / 2, halfWid: W / 2, health: 100, burning: false
    };

    if (typeKey === 'police') {
      var barMatR = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff0000, emissiveIntensity: 1.4 });
      var barMatB = new THREE.MeshStandardMaterial({ color: 0x000033, emissive: 0x2244ff, emissiveIntensity: 0.2 });
      var barR = new THREE.Mesh(box(0.5, 0.18, 0.32), barMatR);
      barR.position.set(-0.3, 0.48 + H + cabinH + 0.12, -0.1); g.add(barR);
      var barB = new THREE.Mesh(box(0.5, 0.18, 0.32), barMatB);
      barB.position.set(0.3, 0.48 + H + cabinH + 0.12, -0.1); g.add(barB);
      var stripe = new THREE.Mesh(box(W + 0.02, 0.3, L * 0.62), new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.6 }));
      stripe.position.set(0, 0.55, 0); g.add(stripe);
      var decal = new THREE.Mesh(box(W + 0.03, 0.16, L * 0.3), new THREE.MeshStandardMaterial({ color: 0xf0f0f0 }));
      decal.position.set(0, 0.72, -L * 0.1); g.add(decal);
      car.barMatR = barMatR; car.barMatB = barMatB;
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
