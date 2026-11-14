/* Everything you can walk up to and use: your bed, the fridge, the TV, the
   phone charger, the door of your house and the bars on the promenade. */
(function (G) {
  'use strict';
  var U = G.util;
  var USE = 0.0;                      // extra reach on top of the prop's own radius
  var player = null, fadeEl = null, fadeT = 0, fadeDir = 0;
  var sleptDay = 0;

  var ACTS = {
    bed: { label: 'SLEEP UNTIL MORNING', run: sleep },
    fridge: { label: 'GET SOMETHING TO EAT', run: eat, cool: 45 },
    tv: { label: 'WATCH THE NEWS', run: news, cool: 4 },
    phone: { label: 'CHARGE YOUR PHONE', run: charge, cool: 3 },
    door: { label: 'HOME SWEET HOME', run: door, cool: 3 },
    bar: { label: 'BUY A DRINK ($25)', run: drink, cool: 3 }
  };

  function toast(t) { if (G.hud && G.hud.toast) G.hud.toast(t); }
  function big(t, c) { if (G.hud && G.hud.bigMessage) G.hud.bigMessage(t, c); }

  function buildFade() {
    fadeEl = document.createElement('div');
    fadeEl.id = 'homeFade';
    fadeEl.hidden = true;
    fadeEl.style.opacity = '0';
    document.body.appendChild(fadeEl);
  }

  function fadeTo(on) { fadeDir = on ? 1 : -1; if (fadeEl) fadeEl.hidden = false; }

  function nearest() {
    if (!player || !player.onFoot) return null;
    var props = G.city.props || [], best = null, bd = 1e9;
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (!ACTS[p.kind] || (p.cool || 0) > 0) continue;
      var d = Math.sqrt((p.x - player.x) * (p.x - player.x) + (p.z - player.z) * (p.z - player.z));
      if (d <= p.r + USE && d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function use() {
    var p = nearest();
    if (!p) return false;
    var a = ACTS[p.kind];
    a.run(p);
    if (a.cool) p.cool = a.cool;
    return true;
  }

  function prompt() {
    var p = nearest();
    if (!p) return '';
    return '<b style="color:#8ef0c0">PRESS G</b> &middot; ' + ACTS[p.kind].label +
      (p.name ? ' &middot; ' + p.name : '');
  }

  // ------------------------------------------------------------------- actions
  function sleep() {
    if (G.wanted && G.wanted.level > 0) { toast('YOU CANNOT SLEEP WITH THE COPS OUTSIDE'); return; }
    sleptDay++;
    toast('GOOD NIGHT');
    fadeTo(true);
    setTimeout(function () {
      var p = player;
      p.hp = 100; p.armor = Math.max(p.armor, 40);
      if (G.setTime) G.setTime(7.1);
      p.x = G.city.home.spawn.x; p.z = G.city.home.spawn.z;
      p.y = G.city.groundY(p.x, p.z); p.vy = 0;
      big('A NEW DAY', '#ffe9a8');
      toast('DAY ' + (sleptDay + 1) + ' &middot; RESTED, HEALTH FULL');
      fadeTo(false);
    }, 700);
  }

  function eat() {
    var p = player;
    if (p.hp >= 100) { toast('NOT HUNGRY'); return; }
    p.hp = Math.min(100, p.hp + 30);
    G.audio.pickup();
    toast('THAT HIT THE SPOT &middot; +30 HEALTH');
  }

  function news(p) {
    var lvl = G.wanted ? G.wanted.level : 0;
    var near = null, best = 1e9;
    var tg = (G.heists && G.heists.targets) || [];
    for (var i = 0; i < tg.length; i++) {
      var t = tg[i];
      if (t.robbed) continue;
      var d = (t.x - p.x) * (t.x - p.x) + (t.z - p.z) * (t.z - p.z);
      if (d < best) { best = d; near = t; }
    }
    var line = 'CHANNEL 7: nothing new on the island.';
    if (lvl > 0) line = 'CHANNEL 7: police hunting a suspect in ' + (p.district || 'the city') + ' \u00b7 ' + lvl + ' star' + (lvl > 1 ? 's' : '') + '.';
    else if (near) line = 'CHANNEL 7: ' + near.name + ' still open, ' + Math.round(Math.sqrt(best)) + ' m from here.';
    toast(line);
  }

  function charge() {
    if (G.phone) G.phone.distribute();
    G.audio.ui();
    toast('PHONE CHARGED TO 100%');
  }

  function door() { toast('YOUR HOUSE \u00b7 PALM ROW'); }

  function drink() {
    var p = player;
    if (p.cash < 25) { toast('YOU CANNOT AFFORD A DRINK'); return; }
    p.cash -= 25;
    p.hp = Math.min(100, p.hp + 12);
    G.audio.ui();
    toast('CHEERS &middot; -$25, +12 HEALTH');
  }

  // --------------------------------------------------------------------- loop
  function update(dt) {
    var props = G.city.props || [], i;
    for (i = 0; i < props.length; i++) if (props[i].cool > 0) props[i].cool -= dt;
    if (fadeEl && fadeDir) {
      var o = parseFloat(fadeEl.style.opacity || '0') + fadeDir * dt * 2.6;
      if (o >= 1) { o = 1; fadeDir = 0; }
      else if (o <= 0) { o = 0; fadeDir = 0; fadeEl.hidden = true; }
      fadeEl.style.opacity = String(o);
    }
  }

  G.home = {
    init: function (pl) { player = pl; buildFade(); },
    update: update,
    nearest: nearest,
    use: use,
    prompt: prompt,
    acts: ACTS
  };
})(window.G);
