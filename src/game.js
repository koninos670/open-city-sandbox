/* Bootstrap: renderer, input, main loop, day/night, pointer lock. */
(function (G) {
  'use strict';
  var U = G.util;
  var renderer, scene, camera, clock, sunTime = 12.6, running = false;
  var input = { keys: {}, mx: 0, my: 0, fire: false, aim: false };
  var fps = 0, fpsAcc = 0, fpsN = 0, startGameRef = null;
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
    G.audio.init();
    G.hud.init();
    G.player.init(scene, camera);
    G.entities.init(scene, G.player);
    G.wanted.init(scene, G.player);
    G.city.setTime(sunTime, scene);

    bindInput(canvas);
    window.addEventListener('resize', resize);
    clock = new THREE.Clock();
    G.debug = {
      state: debugState, update: update, input: input,
      startGame: function () { startGameRef(); },
      frame: function (dt) { update(dt); renderer.render(scene, camera); },
      step: function (dt) { update(dt); },
      press: function (code, down) { input.keys[code] = !!down; },
      setTime: function (h) { sunTime = h; G.city.setTime(sunTime, scene); },
      heal: function () { G.player.hp = 100; },
      scene: scene, camera: camera, renderer: renderer
    };
    requestAnimationFrame(loop);
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  function bindInput(canvas) {
    var el = function (id) { return document.getElementById(id); };

    function startGame() {
      el('menu').hidden = true;
      el('hud').hidden = false;
      running = true;
      G.audio.init();
      G.audio.resume();
      G.audio.startEngine();
      G.audio.startSiren();
      lockPointer(canvas);
    }
    startGameRef = startGame;
    el('startBtn').addEventListener('click', startGame);

    document.addEventListener('keydown', function (e) {
      var k = e.code;
      if (k === 'Tab' || k === 'Space' || k.indexOf('Arrow') === 0) e.preventDefault();
      if (input.keys[k]) return;
      input.keys[k] = true;
      if (!running) return;
      if (k === 'KeyE') toggleCar();
      else if (k === 'KeyC') G.player.camMode = (G.player.camMode + 1) % 3;
      else if (k === 'KeyH') G.player.camMode = G.player.camMode === 1 ? 0 : 1;
      else if (k === 'Tab') G.wanted.clear(true);
      else if (k === 'KeyM') G.audio.setMute(!G.audio.muted);
      else if (k >= 'Digit1' && k <= 'Digit4') G.player.selectWeapon(+k.slice(5));
    });
    document.addEventListener('keyup', function (e) { input.keys[e.code] = false; });
    window.addEventListener('blur', function () { input.keys = {}; });

    canvas.addEventListener('mousedown', function (e) {
      if (!running) return;
      if (e.button === 0) input.fire = true;
      if (e.button === 2) input.aim = true;
      if (document.pointerLockElement !== canvas) lockPointer(canvas);
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) input.fire = false;
      if (e.button === 2) input.aim = false;
    });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('mousemove', function (e) {
      if (document.pointerLockElement !== canvas) return;
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
      errors: G.errors.slice(0, 6), running: running, locked: document.pointerLockElement === renderer.domElement, sunTime: +sunTime.toFixed(2),
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
      night: +G.city.night.toFixed(2), helis: G.wanted.helis.length
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
    var hint = document.pointerLockElement === renderer.domElement ? '' : 'Click to look around &middot; ';
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
    G.player.update(dt, input);
    G.entities.update(dt, sunTime);
    G.wanted.update(dt, sunTime);

    sunTime = (sunTime + dt * 0.05) % 24;
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
    G.hud.prompt(promptText());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.G);
