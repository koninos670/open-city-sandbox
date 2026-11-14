/* In-game smartphone: map, cab, home waypoint, bank, messages, settings.
   It is a DOM panel (so text stays crisp at any zoom) and it pauses the
   player's controls while it is open. */
(function (G) {
  'use strict';
  var U = G.util;

  var st = {
    open: false,
    batt: 100,
    view: 'home',
    msg: [],
    dead: false
  };
  var root = null, appEl = null, statusEl = null, fadeEl = null;
  var homeSeen = null;
  var APPS = [
    ['home', 'HOME', 'House waypoint, wakami'],
    ['taxi', 'CAB', 'Call a cab'],
    ['map', 'MAP', 'Job markers'],
    ['bank', 'BANK', 'Cash & jobs'],
    ['msg', 'CHAT', 'Messages'],
    ['cfg', 'SET', 'Sound, view']
  ];

  function el(tag, cls, txt) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (txt != null) d.textContent = txt;
    return d;
  }

  function player() { return G.player; }
  function home() { return G.city && G.city.home ? G.city.home : null; }
  function dist(x, z) {
    var p = player();
    if (!p) return 0;
    return Math.sqrt((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z));
  }
  function m(v) { return Math.round(v) + ' m'; }
  function cash(v) { return '$' + Math.round(v).toLocaleString('en-US'); }

  // ---- waypoint: mirrored onto G.waypoint so the minimap can draw it ----
  function setWaypoint(x, z, label) {
    G.waypoint = { x: x, z: z, label: label || 'WAYPOINT' };
    if (G.hud && G.hud.toast) G.hud.toast('WAYPOINT: ' + G.waypoint.label);
  }
  function clearWaypoint() { G.waypoint = null; }

  // ---------------------------------------------------------------- phone DOM
  function build() {
    root = el('div'); root.id = 'phone'; root.hidden = true;
    var body = el('div', 'ph-body');
    body.appendChild(el('div', 'ph-notch'));
    var bar = el('div', 'ph-status');
    statusEl = bar;
    body.appendChild(bar);
    appEl = el('div', 'ph-app');
    body.appendChild(appEl);
    root.appendChild(body);
    document.body.appendChild(root);
    fadeEl = el('div'); fadeEl.id = 'phFade'; fadeEl.hidden = true;
    document.body.appendChild(fadeEl);
    root.addEventListener('click', onClick);
    root.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    act(t.getAttribute('data-act'));
  }

  function statusBar() {
    var p = player();
    var lvl = G.wanted ? G.wanted.level : 0;
    var h24 = st.sun == null ? 12 : st.sun;
    var hh = String(Math.floor(h24) % 24).padStart(2, '0') + ':' + String(Math.floor((h24 % 1) * 60)).padStart(2, '0');
    var parts = [];
    parts.push('<span class="ph-net">OYSTER 5G</span>');
    parts.push('<span class="ph-sig">' + (lvl ? '\u2605'.repeat(lvl) : '\u2013') + '</span>');
    parts.push('<span class="ph-batt">' + Math.max(0, Math.round(st.batt)) + '%</span>');
    parts.push('<i class="ph-battbar"><b style="width:' + Math.max(0, Math.min(100, st.batt)) + '%"></b></i>');
    statusEl.innerHTML = parts.join('') + '<div class="ph-clock">' + hh + '</div>';
  }

  function tile(id, name, sub) {
    return '<button class="ph-tile" data-act="app:' + id + '"><b>' + name + '</b><i>' + sub + '</i></button>';
  }

  function viewHome() {
    var h = home();
    var p = player();
    var d = h ? dist(h.x, h.z) : 0;
    var s = '<div class="ph-h">YOUR HOUSE</div>';
    if (!h) return s + '<p class="ph-p">No address on file.</p>';
    s += '<div class="ph-hero"><b>' + m(d) + '</b><i>from your house</i></div>';
    s += '<p class="ph-p">Palm Row, by the shore. Bed to sleep, fridge to eat, TV for the news.</p>';
    s += '<button class="ph-go" data-act="wp">SET WAYPOINT</button>';
    s += '<button class="ph-go" data-act="clear">CLEAR WAYPOINT</button>';
    if (d < 9) s += '<p class="ph-note ok">ON THE CHARGER &middot; BATTERY FILLING</p>';
    else s += '<p class="ph-note">Battery only charges at home.</p>';
    return s;
  }

  function viewTaxi() {
    var p = player();
    var lvl = G.wanted ? G.wanted.level : 0;
    var s = '<div class="ph-h">OYSTER CABS</div>';
    if (!p.onFoot) s += '<p class="ph-note warn">GET OUT OF THE VEHICLE FIRST</p>';
    if (lvl > 0) s += '<p class="ph-note warn">NO RIDE WHILE WANTED</p>';
    s += '<p class="ph-p">Flat fare ' + cash(50) + ', paid on pickup.</p>';
    var can = p.onFoot && lvl === 0 && p.cash >= 50;
    function dest(id, name, x, z) {
      var d = Math.round(dist(x, z));
      return '<button class="ph-go' + (can ? '' : ' off') + '" data-act="taxi:' + id + '">' + name +
        '<i>' + d + ' m</i></button>';
    }
    var h = home();
    if (h) s += dest('home', 'YOUR HOUSE', h.x, h.z);
    s += dest('beach', 'PALMA BEACH', G.city.COAST_X + 3.5, G.city.PIER_Z - 52);
    s += dest('pier', 'THE PIER', G.city.pier ? G.city.pier.x - 14 : G.city.COAST_X + 30, G.city.PIER_Z);
    s += dest('city', 'DOWNTOWN', 0, 0);
    if (p.cash < 50) s += '<p class="ph-note warn">You only carry ' + cash(p.cash) + '.</p>';
    return s;
  }

  function targets() {
    var t = (G.heists && G.heists.targets) || (G.city && G.city.targets) || [];
    return t;
  }

  function viewMap() {
    var s = '<div class="ph-h">JOBS NEARBY</div>';
    var p = player(), list = [], i;
    var tg = targets();
    for (i = 0; i < tg.length; i++) {
      var t = tg[i];
      if (!t || t.robbed) continue;
      list.push({ t: t, d: dist(t.x, t.z) });
    }
    list.sort(function (a, b) { return a.d - b.d; });
    if (!list.length) s += '<p class="ph-p">Everything on the island is already cleaned out.</p>';
    for (i = 0; i < Math.min(6, list.length); i++) {
      var it = list[i];
      s += '<button class="ph-row" data-act="tp:' + (it.t.x | 0) + ':' + (it.t.z | 0) + '">' + it.t.name +
        '<i>' + m(it.d) + ' &middot; ' + cash(it.t.loot) + '</i></button>';
    }
    var h = home();
    if (h) s += '<button class="ph-row" data-act="wp">YOUR HOUSE<i>' + m(dist(h.x, h.z)) + '</i></button>';
    s += '<p class="ph-note">Tap a line to put it on the minimap.</p>';
    return s;
  }

  function viewBank() {
    var p = player();
    var s = '<div class="ph-h">MAZE BANK OF OYSTER</div>';
    s += '<div class="ph-hero"><b>' + cash(p.cash) + '</b><i>cash in pocket</i></div>';
    var last = G.heists && G.heists.lastLoot;
    s += '<p class="ph-p">' + (last ? 'Last job: ' + last.name + ' for ' + cash(last.loot) + '.' :
      'No jobs on record. Rob a bank, a jeweller, a store or an ATM.') + '</p>';
    s += '<button class="ph-go" data-act="app:map">FIND A JOB</button>';
    s += '<button class="ph-go" data-act="loan">TAKE A LOAN ' + cash(500) + '</button>';
    var debt = G.city && G.city.debt ? G.city.debt : 0;
    if (debt) s += '<p class="ph-note warn">Outstanding balance ' + cash(debt) + ' (charged on your next job).</p>';
    return s;
  }

  function viewMsg() {
    var s = '<div class="ph-h">MESSAGES</div>';
    var p = player();
    if (!st.msg.length) {
      st.msg = [{ who: 'Ray', txt: 'Welcome to the island. Your address is on the map \u2014 dont be a stranger.' }];
    }
    if (home() && dist(home().x, home().z) < 12 && p) {
      if (!homeSeen) { homeSeen = 1; st.msg.push({ who: 'Ray', txt: 'You found the house. Sleep in the bed to save yourself.' }); }
    }
    for (var i = st.msg.length - 1; i >= 0; i--) {
      s += '<div class="ph-msg"><b>' + st.msg[i].who + '</b><span>' + st.msg[i].txt + '</span></div>';
    }
    return s;
  }

  function viewCfg() {
    var p = player();
    var s = '<div class="ph-h">SETTINGS</div>';
    s += '<button class="ph-row" data-act="mute">SOUND<i>' + (G.audio.muted ? 'OFF' : 'ON') + '</i></button>';
    s += '<button class="ph-row" data-act="view">CAMERA<i>' + (p.camMode === 1 ? 'FIRST PERSON' : p.camMode === 2 ? 'CINEMA' : 'THIRD PERSON') + '</i></button>';
    s += '<button class="ph-row" data-act="app:keys">CONTROLS<i>W A S D</i></button>';
    s += '<p class="ph-note">P closes the phone. On a phone: left thumb moves, right thumb looks.</p>';
    return s;
  }

  function viewKeys() {
    var rows = [['W A S D', 'Move / drive'], ['MOUSE', 'Look'], ['SHIFT', 'Sprint'], ['SPACE', 'Jump / brake'],
      ['E', 'Enter / exit car'], ['F', 'Horn / hold up'], ['R', 'Reload'], ['1-4', 'Weapons'],
      ['C / H', 'Camera'], ['P', 'Phone'], ['M', 'Mute'], ['F1', 'Controls']];
    var s = '<div class="ph-h">CONTROLS</div>';
    for (var i = 0; i < rows.length; i++) s += '<div class="ph-row2"><kbd>' + rows[i][0] + '</kbd><i>' + rows[i][1] + '</i></div>';
    return s;
  }

  var VIEWS = { home: viewHome, taxi: viewTaxi, map: viewMap, bank: viewBank, msg: viewMsg, cfg: viewCfg, keys: viewKeys };

  function render() {
    if (!st.open) return;
    statusBar();
    var v = VIEWS[st.view] || viewHome;
    var html = '';
    if (st.view === 'applist') {
      html = '<div class="ph-h">OYSTER OS</div><div class="ph-grid">';
      for (var i = 0; i < APPS.length; i++) html += tile(APPS[i][0], APPS[i][1], APPS[i][2]);
      html += '</div>';
    } else {
      html = v() + '<button class="ph-back" data-act="apps">\u25c0 APPS</button>';
    }
    if (st.dead) html = '<div class="ph-h">BATTERY EMPTY</div><p class="ph-p">Charge it at your house.</p>';
    appEl.innerHTML = html;
    appEl.scrollTop = appEl.scrollHeight;
  }

  // ---------------------------------------------------------------- actions
  function ride(id, name) {
    var p = player();
    if (!p.onFoot) { toast('GET OUT OF THE CAR FIRST'); return; }
    if (G.wanted && G.wanted.level > 0) { toast('THE CAB WILL NOT STOP WHILE YOU ARE WANTED'); return; }
    if (p.cash < 50) { toast('NOT ENOUGH CASH \u2014 A RIDE IS $50'); return; }
    var goal;
    var h = home();
    if (id === 'home' && h) goal = h.spawn;
    else if (id === 'beach') goal = { x: G.city.COAST_X + 3.5, z: G.city.PIER_Z - 52, yaw: Math.PI / 2 };
    else if (id === 'pier') goal = { x: (G.city.pier ? G.city.pier.x - 14 : G.city.COAST_X + 30), z: G.city.PIER_Z, yaw: Math.PI / 2 };
    else goal = { x: 6, z: 4, yaw: 0 };
    if (!goal) { toast('NO ADDRESS'); return; }
    p.cash -= 50;
    toast('CAB BOOKED \u00b7 ' + name);
    clearWaypoint();
    if (fadeEl) { fadeEl.hidden = false; fadeEl.style.opacity = '1'; }
    setTimeout(function () {
      p.x = goal.x; p.z = goal.z; p.vy = 0;
      p.y = G.city.groundY(p.x, p.z);
      if (goal.yaw != null) { p.yaw = goal.yaw; p.camYaw = goal.yaw; }
      G.hud.toast('ARRIVED: ' + name);
      if (fadeEl) fadeEl.style.opacity = '0';
      setTimeout(function () { if (fadeEl) fadeEl.hidden = true; }, 320);
      render();
    }, 420);
  }

  function toast(t) { if (G.hud && G.hud.toast) G.hud.toast(t); }

  function act(a) {
    var p = player();
    if (a.indexOf('app:') === 0) { st.view = a.slice(4); render(); return; }
    if (a === 'apps') { st.view = 'applist'; render(); return; }
    if (a === 'wp') {
      var h = home();
      if (h) setWaypoint(h.x, h.z, 'YOUR HOUSE');
      render(); return;
    }
    if (a === 'clear') { clearWaypoint(); toast('WAYPOINT CLEARED'); render(); return; }
    if (a.indexOf('tp:') === 0) {
      var q = a.split(':');
      setWaypoint(+q[1], +q[2], 'JOB');
      render(); return;
    }
    if (a.indexOf('taxi:') === 0) {
      var id = a.slice(5);
      var name = id === 'home' ? 'YOUR HOUSE' : id === 'beach' ? 'PALMA BEACH' : id === 'pier' ? 'THE PIER' : 'DOWNTOWN';
      ride(id, name); return;
    }
    if (a === 'mute') { G.audio.setMute(!G.audio.muted); render(); return; }
    if (a === 'view') { p.camMode = (p.camMode + 1) % 3; render(); return; }
    if (a === 'loan') {
      if (G.city.debt) { toast('ALREADY IN DEBT'); }
      else { G.city.debt = 500; p.cash += 500; toast('LOAN APPROVED: ' + cash(500)); }
      render(); return;
    }
  }

  // ---------------------------------------------------------------- open/close
  function toggle(force) {
    var want = force == null ? !st.open : !!force;
    if (want && st.batt <= 0) { toast('PHONE IS DEAD \u2014 CHARGE IT AT HOME'); return; }
    st.open = want;
    root.hidden = !want;
    if (want) {
      if (drawLocked()) document.exitPointerLock();
      if (st.view === 'home' || !VIEWS[st.view]) st.view = 'applist';
      render();
      G.input.ui = true;
      G.input.fire = false; G.input.aim = false;
    } else {
      G.input.ui = false;
    }
  }
  function drawLocked() { return document.pointerLockElement; }
  function isOpen() { return st.open; }

  function update(dt, sunTime) {
    if (!root) return;
    st.sun = sunTime;
    var nearHome = home() && dist(home().x, home().z) < 9;
    if (st.batt > 0) {
      st.batt -= dt * (st.open ? 0.075 : 0.02);
      if (st.batt < 0) st.batt = 0;
    }
    if (nearHome) {
      st.batt = Math.min(100, st.batt + dt * 9);
      if (st.dead && st.batt > 6) st.dead = false;
    }
    if (st.batt <= 0) st.dead = true;
    if (st.open && st.dead) toggle(false);
    else if (st.open) statusBar();
    // arriving at a waypoint clears it
    if (G.waypoint && dist(G.waypoint.x, G.waypoint.z) < 7) clearWaypoint();
  }

  var api = {
    init: function () { build(); statusBar(); },
    update: update,
    toggle: toggle,
    isOpen: isOpen,
    setWaypoint: setWaypoint,
    clearWaypoint: clearWaypoint,
    distribute: function () { st.batt = 100; st.dead = false; },
    state: function () { return { open: st.open, batt: st.batt, view: st.view, waypoint: G.waypoint }; }
  };
  G.phone = api;
})(window.G);
