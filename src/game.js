/* Bootstrap: renderer, input, main loop, day/night, pointer lock. */
(function (G) {
  'use strict';
  var U = G.util;
  var renderer, scene, camera, clock, sunTime = 12.6, running = false;
  var input = { keys: {}, mx: 0, my: 0, fire: false, aim: false, ui: false };
  var uiInput = { keys: {}, mx: 0, my: 0, fire: false, aim: false };
  var fps = 0, fpsAcc = 0, fpsN = 0, startGameRef = null, toggleControlsRef = null;

  function showControls(on) {
    var c = document.getElementById('controls');
    if (!c) return;
    c.hidden = !on;
    c.style.display = on ? 'flex' : 'none';
  }
  G.input = input;

  var DAY_FOG = new THREE.Color(0xb9cfe6), NIGHT_FOG = new THREE.Color(0x0b1220);

  function boot() {
    var canvas = document.getElementById('game');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(DAY_FOG.getHex(), 0.0022);
    camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.25, 3000);
    camera.position.set(0, 6, -14);

    G.city.build(scene);
    G.fx.init(scene);
    G.hud.init();
    G.player.init(scene, camera);
    G.entities.init(scene, G.player);
    G.wanted.init(scene, G.player);
    G.heists.init(G.player);
    if (G.home) G.home.init(G.player);
    if (G.phone) G.phone.init();
    if (G.touch) G.touch.init();
    G.city.setTime(sunTime, scene);

    var badge = document.getElementById('build');
    if (badge) badge.textContent = 'v' + G.BUILD;

    bindInput(canvas);
    window.addEventListener('resize', resize);
    clock = new THREE.Clock();
    // the world clock, shared by the phone, the bed and the debug keys
  G.setTime = function (h) { sunTime = ((h % 24) + 24) % 24; G.city.setTime(sunTime, scene); };

  // installable app: a service worker is what lets a phone (or Chrome on a PC)
  // offer "Install" and lets the game open with no network at all
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  G.debug = {
      state: debugState, update: update, input: input, build: G.BUILD, controls: function () { toggleControlsRef(); },
      startGame: function () { startGameRef(); },
      frame: function (dt) { update(dt); renderer.render(scene, camera); },
      step: function (dt) { update(dt); },
      press: function (code, down) { if (down) keyDown(code); else keyUp(code); },
      rob: function () { return G.heists.interact(); },
      setTime: function (h) { G.setTime(h); },
      phone: function () { return G.phone ? G.phone.state() : null; },
      useProp: function () { return G.home ? G.home.use() : false; },
      heal: function () { G.player.hp = 100; },
      scene: scene, camera: camera, renderer: renderer
    };
    startGameRef();          // startGame lives in bindInput's scope
    requestAnimationFrame(loop);
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  function bindInput(canvas) {
    var el = function (id) { return document.getElementById(id); };

    // There is no start screen: the world is live from the first frame, and the audio
    // context is created on the first input (browsers only allow that after a gesture).
    var audioArmed = false;
    function armAudio() {
      if (audioArmed) return;
      audioArmed = true;
      function arm() {
        G.audio.init();
        G.audio.resume();
        document.removeEventListener('pointerdown', arm);
        document.removeEventListener('keydown', arm);
        document.removeEventListener('touchstart', arm);
      }
      document.addEventListener('pointerdown', arm);
      document.addEventListener('keydown', arm);
      document.addEventListener('touchstart', arm);
    }

    function startGame() {
      var hud = el('hud');
      if (hud) hud.hidden = false;
      // A cached older page can still carry the start box or the old PAUSED overlay;
      // the game never waits for them, so drop them instead of showing dead screens.
      ['menu', 'paused'].forEach(function (id) {
        var stale = el(id);
        if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
      });
      running = true;
      input.mx = 0; input.my = 0; input.fire = false; input.aim = false;
      armAudio();
      G.hud.toast('CLICK TO LOOK \u00b7 F1 FOR CONTROLS');
      lockPointer(canvas);
    }
    startGameRef = startGame;

    function toggleControls() {
      var c = el('controls');
      if (!c) return;
      c.hidden = !c.hidden;
      showControls(!c.hidden);
    }
    toggleControlsRef = toggleControls;
    // A cached older page can carry a CSS rule that overrides the hidden attribute, so the
    // list is also forced off inline: nothing controls-shaped may sit over the game.
    showControls(false);

    // One place turns a key into a game action, so the keyboard, the debug helpers and
    // the on-screen touch buttons all behave exactly the same way.
    function keyDown(k) {
      if (input.keys[k]) return;
      input.keys[k] = true;
      if (k === 'F1') { toggleControls(); return; }
      if (!running) return;
      // the phone owns the keyboard while its screen is up
      if (G.phone && G.phone.isOpen()) {
        if (k === 'KeyP' || k === 'Escape') { G.phone.toggle(false); lockPointer(canvas); }
        return;
      }
      if (k === 'KeyP') { if (G.phone) G.phone.toggle(); return; }
      if (k === 'KeyG') { if (G.home) G.home.use(); return; }
      if (k === 'KeyE') toggleCar();
      else if (k === 'KeyF') G.heists.interact();
      else if (k === 'KeyC') G.player.camMode = (G.player.camMode + 1) % 3;
      else if (k === 'KeyH') G.player.camMode = G.player.camMode === 1 ? 0 : 1;
      else if (k === 'Tab') G.wanted.clear(true);
      else if (k === 'KeyM') G.audio.setMute(!G.audio.muted);
      else if (k >= 'Digit1' && k <= 'Digit4') G.player.selectWeapon(+k.slice(5));
    }
    function keyUp(k) { input.keys[k] = false; }
    G.keys = { down: keyDown, up: keyUp };

    document.addEventListener('keydown', function (e) {
      var k = e.code;
      if (k === 'Tab' || k === 'Space' || k.indexOf('Arrow') === 0 ||
          k === 'F1' || k === 'KeyP' || k === 'Escape' || e.key === '?') e.preventDefault();
      if (k === 'F1' || e.key === '?') { toggleControls(); return; }
      keyDown(k);
    });
    document.addEventListener('keyup', function (e) { keyUp(e.code); });
    window.addEventListener('blur', function () { input.keys = {}; });

    canvas.addEventListener('mousedown', function (e) {
      if (!running) return;
      if (G.phone && G.phone.isOpen()) return;
      if (e.button === 0) input.fire = true;
      if (e.button === 2) input.aim = true;
      if (document.pointerLockElement !== canvas) lockPointer(canvas);
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) input.fire = false;
      if (e.button === 2) input.aim = false;
    });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Look-around works with or without pointer lock: embedded views and some browsers
    // refuse the lock, and the game has to stay playable there.
    document.addEventListener('mousemove', function (e) {
      if (!running) return;
      input.mx += e.movementX || 0;
      input.my += e.movementY || 0;
    });
    // Losing the mouse (Esc, alt-tab, another window) never stops the game: keyboard
    // play continues and any click re-captures the pointer.
    document.addEventListener('click', function () {
      if (running && document.pointerLockElement !== canvas) lockPointer(canvas);
    });
  }

  function lockPointer(canvas) {
    if (!canvas.requestPointerLock) return;
    try {
      var r = canvas.requestPointerLock();
      if (r && r.catch) r.catch(function () { });
    } catch (e) { /* headless or unsupported */ }
  }

  function debugState() {
    var p = G.player;
    var a = p.ammo && p.ammo[p.weapon];
    return {
      build: G.BUILD, errors: G.errors.slice(0, 6), running: running, locked: document.pointerLockElement === renderer.domElement, sunTime: +sunTime.toFixed(2),
      hp: p.hp, armor: p.armor, cash: p.cash, onFoot: p.onFoot, dead: p.dead,
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(2),
      vy: +p.vy.toFixed(2), camMode: p.camMode, weapon: p.weapon, mag: a ? a.mag : null,
      wanted: G.wanted.level, heat: +G.wanted.heat.toFixed(2), agitated: +G.wanted.agitated.toFixed(1),
      cops: G.entities.cops.length, copsAlive: G.entities.cops.filter(function (c) { return c.alive; }).length,
      cars: G.entities.cars.length, carsAlive: G.entities.cars.filter(function (c) { return c.alive; }).length,
      policeCars: G.entities.cars.filter(function (c) { return c.driver === 'police'; }).length,
      peds: G.entities.peds.length, pedsAlive: G.entities.peds.filter(function (x) { return x.alive; }).length,
      pickups: G.entities.pickups.filter(function (k) { return !k.taken; }).length,
      carSpeed: p.car ? +p.car.speed.toFixed(2) : null,
      fps: fps, drawCalls: renderer.info.render.calls, tris: renderer.info.render.triangles,
      night: +G.city.night.toFixed(2), helis: G.wanted.helis.length,
      heists: G.heists.targets.length, heistState: G.heists.state, heistsDone: G.heists.done,
      heistNear: G.heists.near ? G.heists.near.name : null,
      phoneOpen: !!(G.phone && G.phone.isOpen()), phoneBatt: G.phone ? +G.phone.state().batt.toFixed(1) : null,
      waypoint: G.waypoint ? { x: +G.waypoint.x.toFixed(1), z: +G.waypoint.z.toFixed(1), label: G.waypoint.label } : null,
      propNear: (function () { var q = G.home ? G.home.nearest() : null; return q ? q.kind + '/' + (q.name || '') : null; })()
    };
  }

  function toggleCar() {
    var p = G.player;
    if (!p.onFoot) { p.exitCar(false); return; }
    var car = G.entities.carNear(p.x, p.z, 3.6);
    if (car) p.enterCar(car);
    else G.hud.toast('NO VEHICLE NEARBY');
  }

  function promptText() {
    var p = G.player;
    if (p.dead) return '';
    var hint = (document.pointerLockElement === renderer.domElement || G.touchMode) ? '' : 'Click to look around &middot; ';
    var job = G.heists.prompt(p);
    if (job) return job;
    var prop = G.home ? G.home.prompt() : '';
    if (prop) return prop;
    if (p.onFoot) {
      var car = G.entities.carNear(p.x, p.z, 3.6);
      if (car) return hint + 'Press E to take the ' + car.model.type.toUpperCase();
      return hint + 'Press E near a car to steal it';
    }
    return hint + 'E exit &middot; Space handbrake &middot; Shift boost';
  }

  function loop() {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, clock.getDelta());
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    if (running) update(dt);
    renderer.render(scene, camera);
  }

  function update(dt) {
    var busy = !!(G.phone && G.phone.isOpen());
    G.player.update(dt, busy ? uiInput : input);
    G.entities.update(dt, sunTime);
    G.wanted.update(dt, sunTime);
    G.heists.update(dt);

    sunTime = (sunTime + dt * 0.05) % 24;
    G.city.shadowAt(G.player.x, G.player.z);
    G.city.setTime(sunTime, scene);
    var day = 1 - G.city.night;
    scene.fog.color.copy(NIGHT_FOG).lerp(DAY_FOG, day);
    scene.fog.density = U.lerp(0.0040, 0.0019, day);

    G.fx.update(dt);

    var p = G.player;
    p.district = G.city.districtName(p.x, p.z);
    G.hud.update(p, dt);
    G.hud.tick(dt);
    G.hud.setClock(sunTime);
    G.hud.drawMinimap(p, G.entities, G.wanted.level);
    if (G.phone) G.phone.update(dt, sunTime);
    if (G.touch) G.touch.update(dt);
    if (G.home) G.home.update(dt);
    G.hud.prompt(promptText());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.G);
