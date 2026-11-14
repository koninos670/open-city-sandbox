/* Heists: hold up the banks, jewellers, corner stores and ATMs scattered over the city. */
(function (G) {
  'use strict';
  var U = G.util;
  var H = G.heists = { targets: [], state: 'idle', tgt: null, t: 0, near: null, done: 0, clock: 0 };

  var player, COOL = 150, REACH = 5.0, KEEP = 10, MARK_RANGE = 90;
  var TICK = 6;                        // alarm beeps per robbery

  H.init = function (pl) {
    player = pl;
    H.targets = G.city.targets || [];
    for (var i = 0; i < H.targets.length; i++) {
      var t = H.targets[i];
      t.robbed = 0; t.cool = 0; t.beep = 0;
    }
  };

  function nearest(x, z, maxD) {
    var best = null, bd = maxD * maxD;
    for (var i = 0; i < H.targets.length; i++) {
      var t = H.targets[i];
      if (t.robbed) continue;
      var d = U.dist2(x, z, t.x, t.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  H.canRob = function () {
    return !!player && !player.dead && player.onFoot && H.state === 'idle' && !!nearest(player.x, player.z, REACH);
  };

  // called on the F key: start a job, or drop one already running
  H.interact = function () {
    if (H.state === 'rob') { abort('YOU BROKE OFF THE JOB'); return true; }
    if (!player || player.dead) return false;
    var t = nearest(player.x, player.z, REACH);
    if (!t) return false;
    if (!player.onFoot) { G.hud.toast('GET OUT OF THE CAR FIRST'); return true; }
    H.state = 'rob'; H.tgt = t; H.t = 0; t.beep = 0;
    // the alarm goes out the moment you make your move
    G.wanted.crime('heist', t.x, t.z, t.heat * 0.35);
    G.wanted.agitated = Math.max(G.wanted.agitated, 12);
    G.entities.panicNear(t.x, t.z, 34);
    G.hud.toast(t.hint);
    G.audio.ui();
    return true;
  };

  function abort(msg) {
    H.state = 'idle'; H.tgt = null;
    if (msg) G.hud.toast(msg);
  }

  function complete(t) {
    H.state = 'idle'; H.tgt = null;
    t.robbed = 1; t.cool = COOL;
    H.done++;
    player.cash += t.loot;
    G.wanted.crime('heist', t.x, t.z, t.heat * 0.75);
    G.wanted.agitated = Math.max(G.wanted.agitated, 14);
    G.entities.panicNear(t.x, t.z, 40);
    G.hud.bigMessage('$' + t.loot.toLocaleString(), '#ffd447');
    G.hud.toast(t.name + ' CLEANED OUT \u00b7 ' + H.done + ' JOB' + (H.done === 1 ? '' : 'S') + ' DONE');
    G.audio.pickup();
  }

  H.update = function (dt) {
    if (!player) return;
    H.clock += dt;
    for (var i = 0; i < H.targets.length; i++) {
      var t = H.targets[i];
      if (t.robbed) { t.cool -= dt; if (t.cool <= 0) t.robbed = 0; }
    }

    if (H.state === 'rob') {
      var j = H.tgt;
      if (!j || player.dead || !player.onFoot) { abort(''); }
      else if (U.dist2(player.x, player.z, j.x, j.z) > KEEP * KEEP) { abort('TOO FAR \u00b7 JOB DROPPED'); }
      else {
        H.t += dt;
        var beep = Math.floor(H.t / (j.secs / TICK));
        if (beep > j.beep) { j.beep = beep; G.audio.ui(); }
        if (H.t >= j.secs) complete(j);
      }
    }

    H.near = H.state === 'rob' ? H.tgt : nearest(player.x, player.z, REACH);
    if (G.city.marker) {
      var mark = H.state === 'rob' ? H.tgt : nearest(player.x, player.z, MARK_RANGE);
      if (mark) { G.city.marker.set(mark.x, mark.z); G.city.marker.pulse(H.clock); }
      else G.city.marker.hide();
    }
  };

  H.prompt = function (p) {
    if (H.state === 'rob' && H.tgt) {
      var pct = Math.round(U.clamp(H.t / H.tgt.secs, 0, 1) * 100);
      return '<b style="color:#ffd447">' + H.tgt.hint + ' ' + pct + '%</b> &middot; stay in the marker';
    }
    if (H.near && p.onFoot && !p.dead) {
      return '<b style="color:#ffd447">PRESS F</b> &middot; ' + H.near.hint + ' &middot; $' + H.near.loot.toLocaleString();
    }
    return '';
  };

})(window.G);
