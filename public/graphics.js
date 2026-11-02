/*
 * Hand-built SVG illustrations for KB Movement. Colors come from CSS tokens (see .art rules in styles.css),
 * so every drawing works in light and dark mode. Exposes window.Art.
 */
(function (root) {
  'use strict';
  var uid = 0;
  function f(n) { return (Math.round(n * 10) / 10).toString(); }
  function polar(cx, cy, r, deg) { var a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function poly(cx, cy, r, rot, n) {
    var out = [];
    for (var i = 0; i < n; i++) { var p = polar(cx, cy, r, rot + i * 360 / n); out.push(f(p[0]) + ',' + f(p[1])); }
    return out.join(' ');
  }
  function star(cx, cy, r, inner, points) {
    var out = [];
    for (var i = 0; i < points * 2; i++) {
      var p = polar(cx, cy, i % 2 ? r * inner : r, -90 + i * 180 / points);
      out.push(f(p[0]) + ',' + f(p[1]));
    }
    return out.join(' ');
  }
  function sparkle(cx, cy, r) { return '<polygon class="a-sun" points="' + star(cx, cy, r, 0.3, 4) + '"/>'; }

  /* A classic soccer ball: center pentagon, seams, and pentagons around the rim. */
  function ball(cx, cy, r) {
    var id = 'kbm-ball-' + (++uid);
    var pr = r * 0.36, sw = Math.max(1, r * 0.06);
    var s = '<g class="a-ballg"><defs><clipPath id="' + id + '"><circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r) + '"/></clipPath></defs>' +
      '<circle class="a-white" cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r) + '"/>' +
      '<g clip-path="url(#' + id + ')">' +
      '<polygon class="a-ink" points="' + poly(cx, cy, pr, -90, 5) + '"/>';
    for (var k = 0; k < 5; k++) {
      var deg = -90 + k * 72;
      var v = polar(cx, cy, pr, deg), w = polar(cx, cy, r * 0.68, deg);
      var o = polar(cx, cy, r * 0.98, deg);
      s += '<line class="a-seam" x1="' + f(v[0]) + '" y1="' + f(v[1]) + '" x2="' + f(w[0]) + '" y2="' + f(w[1]) + '" style="stroke-width:' + f(sw) + '"/>';
      s += '<polygon class="a-ink" points="' + poly(o[0], o[1], r * 0.3, deg + 180, 5) + '"/>';
    }
    s += '<circle class="a-shade" cx="' + f(cx + r * 0.42) + '" cy="' + f(cy + r * 0.42) + '" r="' + f(r) + '"/></g>' +
      '<circle class="a-outline" cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r) + '" style="stroke-width:' + f(sw) + '"/></g>';
    return s;
  }

  function cone(x, y, h) {
    var w = h * 0.4;
    return '<g>' +
      '<rect class="a-sun-deep" x="' + f(x - h * 0.55) + '" y="' + f(y - h * 0.08) + '" width="' + f(h * 1.1) + '" height="' + f(h * 0.14) + '" rx="' + f(h * 0.05) + '"/>' +
      '<path class="a-sun" d="M' + f(x - w) + ' ' + f(y - h * 0.06) + ' L' + f(x - h * 0.09) + ' ' + f(y - h) + ' Q' + f(x) + ' ' + f(y - h * 1.06) + ' ' + f(x + h * 0.09) + ' ' + f(y - h) + ' L' + f(x + w) + ' ' + f(y - h * 0.06) + ' Z"/>' +
      '<path class="a-white" d="M' + f(x - h * 0.27) + ' ' + f(y - h * 0.4) + ' L' + f(x - h * 0.19) + ' ' + f(y - h * 0.6) + ' L' + f(x + h * 0.19) + ' ' + f(y - h * 0.6) + ' L' + f(x + h * 0.27) + ' ' + f(y - h * 0.4) + ' Z"/>' +
      '</g>';
  }

  function cloud(x, y, s) {
    return '<g class="a-cloud">' +
      '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(14 * s) + '"/>' +
      '<circle cx="' + f(x + 16 * s) + '" cy="' + f(y - 8 * s) + '" r="' + f(18 * s) + '"/>' +
      '<circle cx="' + f(x + 36 * s) + '" cy="' + f(y) + '" r="' + f(13 * s) + '"/>' +
      '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(36 * s) + '" height="' + f(13 * s) + '"/></g>';
  }

  function goal(x, y, w, hgt, cell) {
    var s = '<rect class="a-netbg" x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(hgt) + '"/>';
    for (var gx = x + cell; gx < x + w; gx += cell) s += '<line class="a-net" x1="' + f(gx) + '" y1="' + f(y) + '" x2="' + f(gx) + '" y2="' + f(y + hgt) + '"/>';
    for (var gy = y + cell; gy < y + hgt; gy += cell) s += '<line class="a-net" x1="' + f(x) + '" y1="' + f(gy) + '" x2="' + f(x + w) + '" y2="' + f(gy) + '"/>';
    s += '<path class="a-frame" d="M' + f(x) + ' ' + f(y + hgt) + ' V' + f(y) + ' H' + f(x + w) + ' V' + f(y + hgt) + '"/>';
    return s;
  }

  /* Hero: a ball curving into the goal past training cones. */
  function heroScene() {
    var id = 'kbm-hero-' + (++uid), pid = id + '-pitch';
    var stripes = '';
    for (var i = -2; i < 9; i++) {
      var t0 = 10 + i * 70, b0 = -120 + i * 110;
      if (i % 2) stripes += '<polygon class="a-grass2" points="' + t0 + ',270 ' + (t0 + 35) + ',270 ' + (b0 + 55) + ',420 ' + b0 + ',420"/>';
    }
    return '<svg class="art hero-art" viewBox="0 0 560 420" role="img" aria-label="Illustration of a soccer ball curving into a goal past training cones">' +
      '<defs><clipPath id="' + id + '"><rect x="10" y="10" width="540" height="400" rx="40"/></clipPath>' +
      '<clipPath id="' + pid + '"><path d="M10 288 C160 262 400 262 560 284 L560 420 L10 420 Z"/></clipPath></defs>' +
      '<rect class="a-sky" x="10" y="10" width="540" height="400" rx="40"/>' +
      '<g clip-path="url(#' + id + ')">' +
      cloud(70, 80, 1.1) + cloud(380, 60, 0.8) + cloud(250, 120, 0.6) +
      '<path class="a-hill" d="M10 245 C110 205 210 215 300 238 C390 258 470 212 560 222 L560 420 L10 420 Z"/>' +
      '<path class="a-grass" d="M10 288 C160 262 400 262 560 284 L560 420 L10 420 Z"/>' +
      '<g clip-path="url(#' + pid + ')">' + stripes + '</g>' +
      '<path class="a-pitchline" d="M40 420 C150 330 410 330 520 420"/>' +
      goal(320, 196, 160, 104, 13) +
      '<line class="a-pole" x1="52" y1="212" x2="52" y2="298"/>' +
      '<path class="a-sun" d="M54 213 L90 224 L54 238 Z"/>' +
      cone(398, 360, 34) + cone(450, 372, 38) + cone(506, 386, 42) +
      '<path class="a-trail" d="M160 318 C205 220 285 170 356 222"/>' +
      '<g class="a-speed"><line x1="70" y1="330" x2="96" y2="330"/><line x1="78" y1="346" x2="98" y2="346"/><line x1="82" y1="362" x2="98" y2="362"/></g>' +
      '<ellipse class="a-shadow" cx="140" cy="390" rx="34" ry="7"/>' +
      ball(138, 346, 38) +
      sparkle(372, 186, 11) + sparkle(250, 168, 7) + sparkle(470, 160, 8) +
      '</g></svg>';
  }

  /* Wavy grass edge under the hero. */
  function wave() {
    return '<svg class="art wave" viewBox="0 0 1440 56" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="a-bg" d="M0 30 C180 6 360 6 540 24 S900 52 1080 34 S1320 4 1440 18 V56 H0 Z"/></svg>';
  }

  /* Small illustrations, 64×64 */
  function icon(inner, label) {
    return '<svg class="art art-icon" viewBox="0 0 64 64"' + (label ? ' role="img" aria-label="' + label + '"' : ' aria-hidden="true"') + '>' + inner + '</svg>';
  }
  function ballIcon(label) { return icon(ball(32, 32, 26), label); }
  function weekIcon() {
    var cells = '';
    [13, 27, 41].forEach(function (x) {
      cells += '<rect class="a-brand" x="' + x + '" y="31" width="11" height="13" rx="3"/>' +
        '<path class="a-check" d="M' + (x + 2.5) + ' 37.5 l2.6 2.6 4.4 -5"/>';
    });
    return icon('<rect class="a-white a-stroke" x="7" y="11" width="50" height="44" rx="9"/>' +
      '<path class="a-brand" d="M7 20 a9 9 0 0 1 9 -9 h32 a9 9 0 0 1 9 9 v4 H7 Z"/>' +
      '<rect class="a-ink" x="18" y="6" width="5" height="11" rx="2.5"/><rect class="a-ink" x="41" y="6" width="5" height="11" rx="2.5"/>' +
      cells + '<rect class="a-soft" x="13" y="47" width="38" height="3" rx="1.5"/>');
  }
  function whistleIcon() {
    return icon('<circle class="a-none a-stroke-ink" cx="13" cy="25" r="6" style="stroke-width:3"/>' +
      '<rect class="a-brand" x="24" y="21" width="32" height="13" rx="4"/>' +
      '<circle class="a-brand" cx="28" cy="40" r="15"/>' +
      '<circle class="a-white" cx="28" cy="40" r="5"/>' +
      '<g class="a-sound"><line x1="58" y1="14" x2="61" y2="9"/><line x1="52" y1="12" x2="52" y2="6"/><line x1="61" y1="20" x2="63" y2="17"/></g>');
  }
  function shinIcon() {
    return icon('<path class="a-white a-stroke" d="M20 8 h24 c4 0 7 3 7 7 v19 c0 11 -8 20 -19 23 c-11 -3 -19 -12 -19 -23 v-19 c0 -4 3 -7 7 -7 Z"/>' +
      '<rect class="a-brand" x="8" y="18" width="48" height="6" rx="3"/><rect class="a-brand" x="10" y="36" width="44" height="6" rx="3"/>' +
      '<polygon class="a-sun" points="' + star(32, 29, 5, 0.45, 5) + '"/>');
  }
  function cleatIcon() {
    return icon('<path class="a-brand" d="M6 44 C6 36 10 32 17 31 L23 21 C25 17 30 17 32 20 L37 27 C46 28 54 32 58 38 C59 42 57 44 54 44 Z"/>' +
      '<path class="a-lace" d="M27 25 l5 -2 M30 29 l5 -2 M34 32 l5 -2"/>' +
      '<rect class="a-ink" x="5" y="43" width="54" height="5" rx="2.5"/>' +
      '<rect class="a-ink" x="10" y="47" width="5" height="6" rx="1.5"/><rect class="a-ink" x="21" y="47" width="5" height="6" rx="1.5"/>' +
      '<rect class="a-ink" x="38" y="47" width="5" height="6" rx="1.5"/><rect class="a-ink" x="49" y="47" width="5" height="6" rx="1.5"/>');
  }
  function bottleIcon() {
    var id = 'kbm-water-' + (++uid);
    return icon('<defs><clipPath id="' + id + '"><rect x="20" y="18" width="24" height="40" rx="8"/></clipPath></defs>' +
      '<rect class="a-ink" x="26" y="5" width="12" height="7" rx="2.5"/>' +
      '<rect class="a-brand" x="24" y="11" width="16" height="8" rx="2"/>' +
      '<rect class="a-white" x="20" y="18" width="24" height="40" rx="8"/>' +
      '<rect class="a-water" x="18" y="30" width="28" height="30" clip-path="url(#' + id + ')"/>' +
      '<rect class="a-sun" x="20" y="36" width="24" height="9"/>' +
      '<rect class="a-none a-stroke" x="20" y="18" width="24" height="40" rx="8"/>');
  }

  /* Winter Select trophy with snowflakes. */
  function snowflake(cx, cy, r, cls) {
    var s = '<g class="' + (cls || 'a-flake') + '">';
    for (var k = 0; k < 6; k++) {
      var deg = k * 60, e = polar(cx, cy, r, deg), b = polar(cx, cy, r * 0.55, deg);
      var l = polar(b[0], b[1], r * 0.28, deg + 140), rr = polar(b[0], b[1], r * 0.28, deg - 140);
      s += '<line x1="' + f(cx) + '" y1="' + f(cy) + '" x2="' + f(e[0]) + '" y2="' + f(e[1]) + '"/>' +
        '<path d="M' + f(l[0]) + ' ' + f(l[1]) + ' L' + f(b[0]) + ' ' + f(b[1]) + ' L' + f(rr[0]) + ' ' + f(rr[1]) + '"/>';
    }
    return s + '</g>';
  }
  function trophy() {
    return '<svg class="art trophy-art" viewBox="0 0 220 200" role="img" aria-label="Illustration of a trophy surrounded by snowflakes">' +
      snowflake(30, 40, 16) + snowflake(190, 30, 12) + snowflake(196, 120, 18) + snowflake(22, 130, 11) + snowflake(160, 180, 9) + snowflake(55, 182, 8) +
      '<path class="a-trophy-handle" d="M74 52 C46 50 44 92 80 96"/><path class="a-trophy-handle" d="M146 52 C174 50 176 92 140 96"/>' +
      '<path class="a-sun" d="M70 36 H150 V72 C150 100 132 118 110 118 C88 118 70 100 70 72 Z"/>' +
      '<path class="a-shine" d="M84 46 V74 C84 88 90 98 98 104"/>' +
      '<polygon class="a-white" points="' + star(110, 72, 14, 0.45, 5) + '"/>' +
      '<rect class="a-sun-deep" x="102" y="116" width="16" height="20"/>' +
      '<rect class="a-sun-deep" x="84" y="134" width="52" height="12" rx="3"/>' +
      '<rect class="a-plinth" x="76" y="146" width="68" height="18" rx="4"/>' +
      sparkle(160, 40, 7) + sparkle(56, 64, 6) +
      '</svg>';
  }
  function snowField() {
    return '<svg class="art snow-field" viewBox="0 0 600 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      snowflake(40, 50, 14, 'a-flake-dim') + snowflake(150, 190, 10, 'a-flake-dim') + snowflake(300, 30, 9, 'a-flake-dim') +
      snowflake(420, 200, 16, 'a-flake-dim') + snowflake(560, 70, 12, 'a-flake-dim') + snowflake(250, 140, 6, 'a-flake-dim') + '</svg>';
  }

  /* Confirmation: ball in the net with confetti. */
  function celebrate() {
    var conf = '';
    var bits = [[18, 30, 'a-sun', 20], [40, 12, 'a-brand', -30], [150, 18, 'a-sun', 45], [176, 40, 'a-brand', 10], [10, 74, 'a-brand', 60], [190, 86, 'a-sun', -20], [120, 8, 'a-brand', 70], [70, 6, 'a-sun', -50]];
    bits.forEach(function (b) {
      conf += '<rect class="' + b[2] + '" x="' + (b[0] - 4) + '" y="' + (b[1] - 2) + '" width="8" height="4" rx="1.5" transform="rotate(' + b[3] + ' ' + b[0] + ' ' + b[1] + ')"/>';
    });
    var cid = 'kbm-cel-' + (++uid);
    return '<svg class="art celebrate-art" viewBox="0 0 200 130" role="img" aria-label="Illustration of a ball in the back of the net">' +
      '<defs><clipPath id="' + cid + '"><rect x="2" y="2" width="196" height="126" rx="22"/></clipPath></defs>' +
      '<rect class="a-sky" x="2" y="2" width="196" height="126" rx="22"/>' +
      '<g clip-path="url(#' + cid + ')"><rect class="a-grass" x="0" y="108" width="200" height="30"/></g>' +
      conf + goal(36, 34, 128, 76, 11) +
      '<ellipse class="a-shadow" cx="112" cy="108" rx="18" ry="4"/>' + ball(110, 90, 18) +
      sparkle(60, 30, 6) + sparkle(168, 60, 5) + '</svg>';
  }

  root.Art = {
    heroScene: heroScene, wave: wave, ball: ballIcon, week: weekIcon, whistle: whistleIcon,
    shin: shinIcon, cleat: cleatIcon, bottle: bottleIcon, trophy: trophy, snowField: snowField, celebrate: celebrate
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
