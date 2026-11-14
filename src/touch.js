/* On-screen controls for phones and tablets: a stick under the left thumb, look
   on the rest of the screen and round buttons on the right. They are just another
   hand on the keyboard: every button holds down the same key the desktop build
   listens for, and dragging writes camera deltas into G.input. */
(function (G) {
  'use strict';

  var forced = /[?&]touch=1/.test(location.search);
  var coarse = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    'ontouchstart' in window || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  if (!forced && !coarse) return;

  var root = null, stick = null, knob = null, pad = null, lookEl = null;
  var lookId = null, lookX = 0, lookY = 0, moveId = null;
  var stickVec = { x: 0, y: 0 };
  var held = {};

  // a button: pointer down holds a key (or a flag) until it is released
  // buttons hold keys down through the game's own key handling, so a touch and a
  // keypress are the same event as far as the game is concerned
  function press(key) { if (!held[key]) { held[key] = 1; if (G.keys) G.keys.down(key); else G.input.keys[key] = true; } }
  function release(key) { if (held[key]) { held[key] = 0; if (G.keys) G.keys.up(key); else G.input.keys[key] = false; } }
  function capture(el, e) { try { el.setPointerCapture && el.setPointerCapture(e.pointerId); } catch (err) {} }

  function el(tag, cls, parent, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    (parent || root).appendChild(e);
    return e;
  }

  function button(cls, label, sub, key) {
    var b = el('div', 'tc-btn ' + cls, root, '<b>' + label + '</b>' + (sub ? '<i>' + sub + '</i>' : ''));
    b.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      b.classList.add('on'); capture(b, e);
      press(key);
    });
    var up = function (e) { if (e) e.preventDefault(); b.classList.remove('on'); release(key); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    return b;
  }

  function build() {
    root = document.createElement('div');
    root.id = 'tc';
    document.body.appendChild(root);

    lookEl = el('div', 'tc-look', root);
    lookEl.addEventListener('pointerdown', function (e) {
      if (lookId !== null) return;
      lookId = e.pointerId; lookX = e.clientX; lookY = e.clientY;
      capture(lookEl, e);
      e.preventDefault();
    });
    lookEl.addEventListener('pointermove', function (e) {
      if (e.pointerId !== lookId) return;
      G.input.mx += (e.clientX - lookX) * 1.15;
      G.input.my += (e.clientY - lookY) * 1.15;
      lookX = e.clientX; lookY = e.clientY;
      e.preventDefault();
    });
    var lookUp = function (e) { if (e.pointerId === lookId) lookId = null; };
    lookEl.addEventListener('pointerup', lookUp);
    lookEl.addEventListener('pointercancel', lookUp);

    pad = el('div', 'tc-pad', root);
    stick = el('div', 'tc-stick', pad);
    knob = el('div', 'tc-knob', stick);
    stick.addEventListener('pointerdown', function (e) {
      moveId = e.pointerId; capture(stick, e);
      stickVec.x = stickVec.y = 0; moveStick(e); e.preventDefault();
    });
    stick.addEventListener('pointermove', function (e) { if (e.pointerId === moveId) { moveStick(e); e.preventDefault(); } });
    var stickUp = function (e) {
      if (e.pointerId !== moveId) return;
      moveId = null; stickVec.x = stickVec.y = 0;
      knob.style.transform = 'translate(0,0)';
      release('KeyW'); release('KeyA'); release('KeyS'); release('KeyD'); release('ShiftLeft');
    };
    stick.addEventListener('pointerup', stickUp);
    stick.addEventListener('pointercancel', stickUp);

    button('tc-jump', 'JUMP', '', 'Space');
    button('tc-fire', 'FIRE', '', 'FireKey');
    button('tc-aim', 'AIM', '', 'AimKey');
    var col = el('div', 'tc-col', root);
    var mk = function (label, sub, key) {
      var b = el('div', 'tc-mini', col, '<b>' + label + '</b>' + (sub ? '<i>' + sub + '</i>' : ''));
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation(); b.classList.add('on');
        if (key === 'CycleWeapon') cycleWeapon(); else press(key);
      });
      var up = function (e) { if (e) e.preventDefault(); b.classList.remove('on'); release(key); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
      return b;
    };
    mk('CAR', 'E', 'KeyE');
    mk('USE', 'G', 'KeyG');
    mk('ROB', 'F', 'KeyF');
    mk('PHONE', 'P', 'KeyP');
    mk('RELOAD', 'R', 'KeyR');
    mk('GUN', '1-4', 'CycleWeapon');
  }

  function moveStick(e) {
    var r = stick.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1) { dx /= len; dy /= len; }
    stickVec.x = dx; stickVec.y = dy;
    knob.style.transform = 'translate(' + (dx * r.width * 0.3) + 'px,' + (dy * r.height * 0.3) + 'px)';
  }

  // the stick, the fire and aim buttons are translated into key presses every frame
  function apply() {
    var t = 0.32, dx = stickVec.x, dy = stickVec.y;
    setKey('KeyA', dx < -t); setKey('KeyD', dx > t);
    setKey('KeyW', dy < -t); setKey('KeyS', dy > t);
    var hard = Math.sqrt(dx * dx + dy * dy) > 0.88;
    setKey('ShiftLeft', hard);
    G.input.fire = !!held.FireKey;
    G.input.aim = !!held.AimKey;
  }

  function setKey(key, on) {
    if (on) press(key); else release(key);
  }

  var ORDER = ['pistol', 'smg', 'rifle', 'shotgun'];
  function cycleWeapon() {
    var p = G.player;
    if (!p || !p.selectWeapon) return;
    var at = ORDER.indexOf(p.weapon);
    for (var k = 1; k <= ORDER.length; k++) {
      var i = (at + k) % ORDER.length;
      if (p.owned[ORDER[i]]) { p.selectWeapon(i + 1); return; }
    }
  }

  function update() {
    if (!root) return;
    apply();
    // the phone screen is its own interface: get the buttons out of its way
    var open = G.phone && G.phone.isOpen();
    root.style.opacity = open ? '0' : '1';
    root.style.pointerEvents = open ? 'none' : '';
  }

  function init() {
    build();
    G.touchMode = true;
    setTimeout(function () {
      if (G.hud && G.hud.toast) G.hud.toast('BROWSER MENU \u2192 ADD TO HOME SCREEN TO INSTALL');
    }, 3500);
    // a long press on a button must not pop the browser's own menu
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  G.touch = { init: init, update: update, isOn: function () { return !!root; } };
})(window.G);
