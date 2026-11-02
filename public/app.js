/* KB Movement: single-page front end. Works with api-http.js (live) or api-preview.js (preview build). */
(function () {
  'use strict';
  var C = window.Core;
  var API = window.API;
  var Art = window.Art;
  var $app = document.getElementById('app');
  var $toast = document.getElementById('toast');

  /* ---------- utilities ---------- */
  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var ls = {
    get: function (k, d) { try { var v = localStorage.getItem('kbm:' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('kbm:' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  };
  function first(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }
  function T(id) { return C.track(S.cfg, id); }
  function when(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  var toastTimer;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.hidden = true; }, 2600);
  }

  /* ---------- state ---------- */
  var blankWinterForm = function () { return { playerName: '', playerAge: '', parentName: '', email: '', phone: '', signature: '', agree: false }; };
  var S = {
    cfg: null,
    route: 'home',
    sched: null, schedAt: 0, schedError: '',
    kind: ls.get('kind', null),     // 'group' | 'private'
    age: ls.get('age', null),       // player's age, for group training
    cart: ls.get('cart', []),
    step: 'dates',
    form: { playerName: '', playerAge: '', parentName: '', email: '', phone: '', notes: '', consent: false },
    errors: {}, bookingError: '', payError: '', notice: null, busy: false,
    pending: null, confirmation: null, confirmationToken: '',
    winter: { stage: 'code', code: '', invite: null, error: '', form: blankWinterForm(), errors: {}, done: null, busy: false },
    coach: {
      checked: false, authed: false, tab: 'sessions', overview: null, winter: null, error: '', loginError: '',
      open: {}, confirm: null, lastInvite: null, inviteMsg: '', inviteForm: { name: '', contact: '', note: '' },
      closureForm: { date: '', track: 'all', reason: '' }, closureError: '', busy: false
    }
  };
  if (S.age) S.form.playerAge = String(S.age);
  function saveCart() { ls.set('cart', S.cart); }

  function groupTracks() { return S.cfg.tracks.filter(function (t) { return t.kind === 'group'; }); }
  function privateTrack() { return S.cfg.tracks.filter(function (t) { return t.kind === 'private'; })[0]; }
  function groupForAge(age) {
    return groupTracks().filter(function (t) { return age >= t.minAge && age <= t.maxAge; })[0] || null;
  }
  function currentTrack() {
    if (S.kind === 'private') return privateTrack();
    if (S.kind === 'group' && S.age) return groupForAge(S.age);
    return null;
  }
  function ageRange() {
    var g = groupTracks();
    return { min: Math.min.apply(null, g.map(function (t) { return t.minAge; })), max: Math.max.apply(null, g.map(function (t) { return t.maxAge; })) };
  }

  var ROUTES = { home: 1, book: 1, winter: 1, coach: 1, booked: 1 };
  function routeFromHash() { var r = (location.hash || '').replace(/^#/, ''); return ROUTES[r] ? r : 'home'; }
  function go(route) {
    if (routeFromHash() === route && location.hash) { onRoute(); }
    else location.hash = route;
  }

  /* ---------- rendering ---------- */
  function focusKey() {
    var a = document.activeElement;
    if (!a || a === document.body || !$app.contains(a)) return null;
    if (a.id) return '#' + a.id;
    if (a.dataset && a.dataset.action) return '[data-action="' + a.dataset.action + '"][data-id="' + (a.dataset.id || '') + '"]';
    return null;
  }
  function render() {
    if (!S.cfg) return;
    var key = focusKey();
    var r = S.route;
    var body = r === 'book' ? viewBook() : r === 'winter' ? viewWinter() : r === 'coach' ? viewCoach() : r === 'booked' ? viewBooked() : viewHome();
    $app.innerHTML = banner() + header() + '<main id="main">' + body + '</main>' + footer() + (r === 'book' && S.step === 'dates' ? mobileBar() : '');
    if (key) {
      var el = $app.querySelector(key);
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
    }
  }
  function focusFirstError() {
    var el = $app.querySelector('.has-error input, .has-error select, .has-error textarea');
    if (el) el.focus();
  }

  var CHECK = '<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" style="fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round"/></svg>';
  var CHECK_SM = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" style="fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round"/></svg>';
  var SNOW = '<svg class="snow" viewBox="0 0 24 24" aria-hidden="true"><g style="fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round">' +
    '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2M4.2 10.3l3-.6-1-3M19.8 13.7l-3 .6 1 3M4.2 13.7l3 .6-1 3M19.8 10.3l-3-.6 1-3"/></g></svg>';
  var LOCK = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="3" style="fill:none;stroke:currentColor;stroke-width:2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" style="fill:none;stroke:currentColor;stroke-width:2"/></svg>';

  function initials(name) {
    var words = String(name).split(/\s+/).filter(Boolean);
    if (words.length > 1 && words[0].length <= 3 && words[0] === words[0].toUpperCase()) return words[0];
    return words.slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function banner() {
    if (API.mode === 'preview') {
      return '<div class="test-banner"><div class="wrap">This is a preview. Bookings and payments here are pretend and only saved in this browser. ' +
        '<button class="link" data-action="reset-preview">Start over</button></div></div>';
    }
    if (S.cfg.payments === 'test') return '<div class="test-banner"><div class="wrap">Demo site: bookings work, but payments are simulated and no card is charged.</div></div>';
    return '';
  }

  function header() {
    var r = S.route;
    var cur = function (x) { return r === x ? ' aria-current="page"' : ''; };
    return '<header class="site-header"><div class="wrap">' +
      '<a class="brand" href="#home"><span class="logo-badge" aria-hidden="true">' + h(initials(S.cfg.businessName)) + '</span>' +
      '<span class="brand-name">' + h(S.cfg.businessName) + '<small>Youth soccer training</small></span></a>' +
      '<nav class="nav" aria-label="Main">' +
      '<a href="#home"' + cur('home') + '>Home</a>' +
      '<a href="#winter"' + cur('winter') + '>Winter Select</a>' +
      '</nav>' +
      '<a class="btn btn-primary btn-sm" href="#book">Book now</a>' +
      '</div></header>';
  }

  function footer() {
    var c = S.cfg;
    var contact = '';
    if (c.contactEmail || c.contactPhone || c.location) {
      contact = '<div class="foot-contact">' +
        (c.location ? '<span>' + h(c.location) + '</span>' : '') +
        (c.contactEmail ? '<span>' + h(c.contactEmail) + '</span>' : '') +
        (c.contactPhone ? '<span>' + h(c.contactPhone) + '</span>' : '') +
        '</div>';
    }
    return '<footer class="site-footer"><div class="wrap">' +
      '<div class="brand"><span class="logo-badge" aria-hidden="true">' + h(initials(c.businessName)) + '</span><span class="brand-name">' + h(c.businessName) + '<small>Soccer training for ages 8 to 14</small></span></div>' +
      contact +
      '<div class="foot-meta"><span>© ' + new Date().getFullYear() + ' ' + h(c.businessName) + '</span>' +
      '<span class="foot-links"><a href="#winter">Winter Select</a><a href="#coach">Coach sign-in</a></span></div>' +
      '</div></footer>';
  }

  /* ---------- home ---------- */
  function scheduleCard() {
    var rows = S.cfg.tracks.map(function (t) {
      var who = t.kind === 'private' ? 'Private 1-on-1' : t.label;
      var sub = t.kind === 'private' ? 'Any age, one player' : 'Group training';
      return '<a class="sched-row" href="#book" data-action="pick" data-id="' + t.id + '">' +
        '<span class="time">' + C.fmtTimeRange(t.start, t.end) + '</span>' +
        '<span class="who">' + h(who) + '<small>' + sub + '</small></span>' +
        '<span class="go">Book</span></a>';
    }).join('');
    return '<div class="sched-card"><h2>Weekly schedule</h2><p class="days">Every Wednesday, Thursday and Friday</p>' + rows +
      '<p class="foot">Every session is 75 minutes.</p></div>';
  }

  function viewHome() {
    var c = S.cfg;
    var g = groupTracks()[0], p = privateTrack();
    var photos = c.photos || [];
    var heroSide = photos.length
      ? '<div class="hero-photo"><img src="' + h(photos[0]) + '" alt="A ' + h(c.businessName) + ' training session"></div>'
      : Art.heroScene();
    var save = g.price * c.days.length - g.bundlePrice;
    return '' +
      '<section class="hero"><div class="wrap hero-grid">' +
      '<div>' +
      '<p class="kicker">Soccer training for ages 8 to 14</p>' +
      '<h1>Small groups, real progress, coached by me.</h1>' +
      '<p class="lede">Group sessions by age and private 1-on-1 training, every Wednesday, Thursday and Friday evening. I coach every session myself, so every player gets real attention.</p>' +
      '<div class="hero-actions"><a class="btn btn-primary" href="#book">Book a session</a><a class="btn btn-secondary" href="#winter">I have a Winter Select code</a></div>' +
      '</div>' + heroSide +
      '</div>' + Art.wave() + '</section>' +

      '<section class="section"><div class="wrap two-col"><div class="section-head"><h2 class="h2">When we train</h2><p class="lede">Three evenings a week, with each session matched to your player\'s age.</p></div>' + scheduleCard() + '</div></section>' +

      '<section class="section section-alt"><div class="wrap">' +
      '<div class="section-head"><h2 class="h2">Prices</h2><p class="lede">Every session is paid for when you book, so your player\'s spot is saved.</p></div>' +
      '<div class="prices">' +
      '<div class="price-card">' + Art.ball() + '<h3>Single group session</h3><div class="amount">' + C.money(g.price) + '</div><p>Drop in for any Wednesday, Thursday or Friday session in your player\'s age group.</p></div>' +
      '<div class="price-card featured"><span class="badge">Best value</span>' + Art.week() + '<h3>Full week of group training</h3><div class="amount">' + C.money(g.bundlePrice) + ' <small>for 3 sessions</small></div><p>Wednesday, Thursday and Friday of the same week. <span class="save">You save ' + C.money(save) + '.</span></p></div>' +
      '<div class="price-card">' + Art.whistle() + '<h3>Private 1-on-1</h3><div class="amount">' + C.money(p.price) + '</div><p>75 minutes of one-on-one coaching for any age, ' + C.fmtTimeRange(p.start, p.end) + '.</p></div>' +
      '</div>' +
      '<p class="prepaid">' + LOCK + '<span>Secure online payment. Your spot is held for 30 minutes while you check out.</span></p>' +
      '</div></section>' +

      '<section class="section"><div class="wrap">' +
      '<div class="section-head"><h2 class="h2">Booking takes about two minutes</h2></div>' +
      '<div class="steps">' +
      '<div class="step"><span class="step-num">1</span><div><h3>Tell us about your player</h3><p class="muted">Choose group training or a 1-on-1, then your player\'s age. We\'ll put them in the right group.</p></div></div>' +
      '<div class="step"><span class="step-num">2</span><div><h3>Pick your dates</h3><p class="muted">Tap the days that work for you. Book all three days in a week and you automatically get the week price.</p></div></div>' +
      '<div class="step"><span class="step-num">3</span><div><h3>Pay to save your spot</h3><p class="muted">Pay securely online and you\'re all set. You\'ll get a confirmation right away.</p></div></div>' +
      '</div></div></section>' +

      '<section class="section section-alt"><div class="wrap">' +
      '<div class="section-head"><h2 class="h2">What to bring</h2><p class="lede">Pack these for every session, and arrive five minutes early.</p></div>' +
      '<div class="bring-grid">' +
      bringItem(Art.ball(), 'Soccer ball', 'Size 4 for ages 8 to 11, size 5 for 12 and up') +
      bringItem(Art.shin(), 'Shin guards', 'Worn under socks, every session') +
      bringItem(Art.cleat(), 'Cleats or turf shoes', 'Whatever suits the field surface') +
      bringItem(Art.bottle(), 'Water bottle', 'A full one. Sessions are 75 minutes') +
      '</div></div></section>' +

      photoStrip() +

      '<section class="winter-band">' + Art.snowField() + '<div class="wrap">' +
      '<div><h2>' + SNOW + 'Winter Select</h2>' +
      '<p>' + h(c.winter.summary) + ' I choose the players myself and send each family a personal invite code by text or email.</p>' +
      (c.winter.host ? '<p>Tournaments are hosted by ' + h(c.winter.host.name) + '. ' + hostLink() + '</p>' : '') + '</div>' +
      '<div class="cta">' + Art.trophy() + '<a class="btn btn-light" href="#winter">Enter my invite code</a><p>Invite only. Codes are sent by your coach.</p></div>' +
      '</div></section>' +

      '<section class="section"><div class="wrap two-col">' +
      '<div class="section-head"><h2 class="h2">Questions parents ask</h2></div>' +
      '<div class="faq">' +
      faq('Which group should my child join?', 'It depends on their age. Players aged ' + g.minAge + ' to ' + g.maxAge + ' train at ' + C.fmtTime(g.start) + '. ' + groupTracks().slice(1).map(function (t) { return 'Players aged ' + t.minAge + ' to ' + t.maxAge + ' train at ' + C.fmtTime(t.start) + '.'; }).join(' ') + ' When you book, just tell us your child\'s age and we\'ll show the right sessions.') +
      faq('When do I pay?', 'When you book. Every session is paid in advance, and your child\'s spot is confirmed as soon as the payment goes through.') +
      faq('How does the full-week price work?', 'Book Wednesday, Thursday and Friday of the same week and you pay ' + C.money(g.bundlePrice) + ' instead of ' + C.money(g.price * 3) + '. There\'s no code to enter. It\'s applied automatically.') +
      faq('What if a session is full?', 'Full sessions are greyed out and can\'t be booked. Try another day that week, or the week after.') +
      faq('How does Winter Select work?', 'Winter Select is invite only. I pick players for our winter tournament team and send each family a personal code. Enter the code on the Winter Select page to accept the spot.' + (c.winter.host ? ' The tournaments are hosted by ' + c.winter.host.name + '.' : '')) +
      '</div></div></section>';
  }
  function hostLink() {
    var host = S.cfg.winter.host;
    if (!host || !host.url) return '';
    return '<a class="host-link" href="' + h(host.url) + '" target="_blank" rel="noopener">See their tournament schedule</a>';
  }
  function photoStrip() {
    var photos = (S.cfg.photos || []).slice(1);
    if (!photos.length) return '';
    return '<section class="section section-alt"><div class="wrap">' +
      '<div class="section-head"><h2 class="h2">At training</h2></div>' +
      '<div class="photo-strip">' + photos.map(function (src, i) {
        return '<figure class="photo' + (i === 0 ? ' photo-lead' : '') + '"><img src="' + h(src) + '" alt="Training photo ' + (i + 1) + '" loading="lazy"></figure>';
      }).join('') + '</div></div></section>';
  }
  function bringItem(icon, title, note) {
    return '<div class="bring-item">' + icon + '<strong>' + h(title) + '</strong>' + (note ? '<span>' + h(note) + '</span>' : '') + '</div>';
  }
  function faq(q, a) { return '<details><summary>' + h(q) + '</summary><p>' + h(a) + '</p></details>'; }

  /* ---------- booking ---------- */
  function stepper(n) {
    var labels = ['Choose sessions', 'Player details', 'Payment'];
    return '<div class="stepper" aria-label="Booking steps">' + labels.map(function (l, i) {
      var cls = i + 1 === n ? 'on' : i + 1 < n ? 'done' : '';
      return '<span class="' + cls + '"' + (i + 1 === n ? ' aria-current="step"' : '') + '><b>' + (i + 1) + '</b>' + l + '</span>';
    }).join('') + '</div>';
  }

  function noticeHtml() {
    if (!S.notice) return '';
    return '<p class="notice notice-' + S.notice.kind + '" role="alert">' + h(S.notice.text) + '</p>';
  }

  function viewBook() {
    if (S.step === 'details') return bookDetails();
    if (S.step === 'pay' && S.pending) return bookPay();
    var g = groupTracks()[0], p = privateTrack();
    var t = currentTrack();

    var qKind = '<section class="q"><h2>What would you like to book?</h2><div class="choice-grid">' +
      '<button class="choice" data-action="kind" data-id="group" aria-pressed="' + (S.kind === 'group') + '"><strong>Group training</strong>' +
      '<span>Ages ' + ageRange().min + ' to ' + ageRange().max + ' · ' + C.money(g.price) + ' a session or ' + C.money(g.bundlePrice) + ' for a full week</span></button>' +
      '<button class="choice" data-action="kind" data-id="private" aria-pressed="' + (S.kind === 'private') + '"><strong>Private 1-on-1</strong>' +
      '<span>Any age · ' + C.money(p.price) + ' a session · ' + C.fmtTimeRange(p.start, p.end) + '</span></button>' +
      '</div></section>';

    var qAge = '';
    if (S.kind === 'group') {
      var r = ageRange(), btns = '';
      for (var a = r.min; a <= r.max; a++) btns += '<button class="age-btn" data-action="age" data-id="' + a + '" aria-pressed="' + (S.age === a) + '" aria-label="' + a + ' years old">' + a + '</button>';
      var match = t ? '<p class="match">' + CHECK_SM + '<span>Your player will join the <strong>' + h(t.label) + ' group</strong>, ' + C.fmtTimeRange(t.start, t.end) + ' on Wednesdays, Thursdays and Fridays.</span></p>' : '';
      qAge = '<section class="q"><h2>How old is your player?</h2><div class="age-row" role="group" aria-label="Player\'s age">' + btns + '</div>' + match +
        '<p class="hint">Younger than ' + r.min + ' or older than ' + r.max + '? Private 1-on-1 sessions are open to any age.</p></section>';
    }

    var qDates = '';
    if (t) {
      var cal;
      if (S.schedError) cal = '<p class="notice notice-bad">' + h(S.schedError) + ' <button class="link" data-action="reload-schedule">Try again</button></p>';
      else if (!S.sched) cal = '<p class="notice notice-info">Loading dates…</p>';
      else if (!S.sched.weeks.length) cal = '<p class="notice notice-info">No sessions are open for booking right now. Please check back soon.</p>';
      else cal = '<div class="weeks">' + S.sched.weeks.map(function (w) { return weekRow(w, t); }).join('') + '</div>';
      var hint = t.kind === 'private'
        ? 'Tap the days you\'d like. Each 1-on-1 runs ' + C.fmtTimeRange(t.start, t.end) + '.'
        : 'Tap the days you\'d like. Book all three days in a week and you\'ll pay ' + C.money(t.bundlePrice) + ' for the week instead of ' + C.money(t.price * 3) + '.';
      qDates = '<section class="q"><h2>Pick your dates</h2><p class="muted">' + h(hint) + '</p>' + cal + '</section>';
    }

    return '<div class="wrap">' +
      '<div class="page-head"><h1>Book a session</h1>' + stepper(1) + '</div>' +
      '<div class="book-layout">' +
      '<div class="book-main">' + noticeHtml() + qKind + qAge + qDates + '</div>' +
      '<aside>' + summary(true) + '</aside>' +
      '</div></div>';
  }

  function weekRow(w, t) {
    var ss = w.sessions[t.id];
    var picked = ss.filter(function (s) { return S.cart.indexOf(s.id) !== -1; });
    var fullWeek = t.bundlePrice && picked.length === ss.length;
    var allOpen = ss.every(function (s) { return s.status === 'open' || S.cart.indexOf(s.id) !== -1; });
    var action = '';
    if (t.bundlePrice) {
      if (fullWeek) action = '<button class="btn btn-secondary" data-action="week" data-id="' + w.key + '">Remove week</button><small>Week price applied</small>';
      else if (allOpen) action = '<button class="btn btn-primary" data-action="week" data-id="' + w.key + '">Book all 3 days</button><span class="save">' + C.money(t.bundlePrice) + ', save ' + C.money(t.price * ss.length - t.bundlePrice) + '</span>';
      else action = '<small>Full week not available</small>';
    } else {
      action = '<small>' + C.money(t.price) + ' per session</small>';
    }
    return '<div class="week' + (fullWeek ? ' is-full-week' : '') + '">' +
      '<div class="week-label"><span>Week of</span><strong>' + h(w.label) + '</strong>' + (fullWeek ? '<span class="chip">Full week</span>' : '') + '</div>' +
      '<div class="week-days">' + ss.map(function (s) { return slot(s, t); }).join('') + '</div>' +
      '<div class="week-actions">' + action + '</div>' +
      '</div>';
  }

  function slot(s, t) {
    var picked = S.cart.indexOf(s.id) !== -1;
    var meta, cls = '';
    if (picked) meta = 'Added';
    else if (s.status === 'past') meta = 'Closed';
    else if (s.status === 'closed') meta = s.reason || 'No session';
    else if (s.status === 'full') meta = t.kind === 'private' ? 'Taken' : 'Full';
    else if (t.kind === 'private') meta = 'Available';
    else meta = s.left === 1 ? '1 spot left' : s.left + ' spots left';
    if (!picked && s.status === 'open' && t.kind === 'group' && s.left <= 3) cls = ' is-low';
    var disabled = !picked && s.status !== 'open';
    var day = C.DAY_SHORT[C.weekday(s.date)];
    var label = C.fmtDayLong(s.date) + ', ' + C.fmtTimeRange(t.start, t.end) + ': ' + meta;
    return '<button class="slot' + cls + '" data-action="slot" data-id="' + s.id + '" aria-pressed="' + picked + '" aria-label="' + h(label) + '"' + (disabled ? ' disabled' : '') + '>' +
      '<span class="s-day">' + day + '</span><span class="s-date">' + h(C.fmtDay(s.date).split(', ')[1]) + '</span><span class="s-meta">' + h(meta) + '</span></button>';
  }

  function summary(editable) {
    var p = C.priceCart(S.cfg, S.cart);
    var body = p.lines.length
      ? p.lines.map(function (l) {
        return '<div class="sum-line">' +
          '<div><div class="sl-title">' + h(l.title) + '</div><div class="sl-detail">' + h(l.detail) + '</div></div>' +
          '<span class="sl-amt">' + C.money(l.cents) + '</span>' +
          (editable ? '<button class="remove" data-action="remove-line" data-id="' + l.sessions.join(',') + '" aria-label="Remove ' + h(l.title + ', ' + l.detail) + '">×</button>' : '<span></span>') +
          '</div>';
      }).join('')
      : '<p class="summary-empty">' + Art.ball() + '<span>Nothing added yet. Your sessions will show up here.</span></p>';
    return '<section class="summary" aria-label="Your booking">' +
      '<div class="summary-head"><h2>Your booking</h2>' + (editable && p.count ? '<button class="link small" data-action="clear-cart">Clear</button>' : '') + '</div>' +
      '<div class="summary-body">' + body + '</div>' +
      '<div class="summary-foot">' +
      '<div class="total-row"><span class="t-label">Total</span><span class="t-amt">' + C.money(p.totalCents) + '</span></div>' +
      (p.savingsCents > 0 ? '<span class="save">You\'re saving ' + C.money(p.savingsCents) + ' with the full-week price</span>' : '') +
      (editable ? '<button class="btn btn-primary btn-block" data-action="to-details"' + (p.count ? '' : ' disabled') + '>Continue</button>' : '') +
      '<span class="fine">Paid when you book. Your spots are held for 30 minutes while you check out.</span>' +
      '</div></section>';
  }

  function mobileBar() {
    var p = C.priceCart(S.cfg, S.cart);
    return '<div class="mobile-bar' + (p.count ? ' show' : '') + '"><div><div class="mb-total">' + C.money(p.totalCents) + '</div><div class="mb-count">' + p.count + (p.count === 1 ? ' session' : ' sessions') + '</div></div>' +
      '<button class="btn btn-primary" data-action="to-details">Continue</button></div>';
  }

  function field(id, label, input, err, extra) {
    return '<div class="field' + (err ? ' has-error' : '') + (extra || '') + '"><label for="' + id + '">' + label + '</label>' + input + (err ? '<span class="err" id="' + id + '-err">' + h(err) + '</span>' : '') + '</div>';
  }
  function textInput(id, key, value, type, auto, err) {
    return '<input class="input" id="' + id + '" data-bind="' + key + '" type="' + (type || 'text') + '" value="' + h(value) + '"' + (auto ? ' autocomplete="' + auto + '"' : '') + (err ? ' aria-invalid="true" aria-describedby="' + id + '-err"' : '') + '>';
  }
  function ageSelect(id, key, value, err) {
    var opts = '<option value="">Select age</option>';
    for (var a = 5; a <= 18; a++) opts += '<option value="' + a + '"' + (String(value) === String(a) ? ' selected' : '') + '>' + a + '</option>';
    return '<select class="select" id="' + id + '" data-bind="' + key + '"' + (err ? ' aria-invalid="true" aria-describedby="' + id + '-err"' : '') + '>' + opts + '</select>';
  }

  function bookDetails() {
    var f = S.form, e = S.errors;
    var p = C.priceCart(S.cfg, S.cart);
    return '<div class="wrap">' +
      '<div class="page-head"><h1>Who\'s playing?</h1>' + stepper(2) + '</div>' +
      '<div class="book-layout">' +
      '<form class="panel" id="details-form" novalidate data-scope="form">' +
      '<button type="button" class="link back" data-action="back-dates">← Back to dates</button>' +
      '<div class="form-grid">' +
      field('f-player', 'Player\'s name', textInput('f-player', 'playerName', f.playerName, 'text', 'off', e.playerName), e.playerName) +
      field('f-age', 'Player\'s age', ageSelect('f-age', 'playerAge', f.playerAge, e.playerAge), e.playerAge) +
      field('f-parent', 'Your name (parent or guardian)', textInput('f-parent', 'parentName', f.parentName, 'text', 'name', e.parentName), e.parentName) +
      field('f-phone', 'Your mobile number', textInput('f-phone', 'phone', f.phone, 'tel', 'tel', e.phone), e.phone) +
      field('f-email', 'Your email', textInput('f-email', 'email', f.email, 'email', 'email', e.email) + '<span class="hint">We\'ll send your confirmation and receipt here.</span>', e.email, ' full') +
      '<div class="field full"><label for="f-notes">Anything I should know? <span class="muted" style="font-weight:400">(optional)</span></label>' +
      '<textarea class="textarea" id="f-notes" data-bind="notes" placeholder="For example: position, experience, goals, injuries or allergies">' + h(f.notes) + '</textarea></div>' +
      '<div class="field full' + (e.consent ? ' has-error' : '') + '"><label class="check" for="f-consent"><input type="checkbox" id="f-consent" data-bind="consent"' + (f.consent ? ' checked' : '') + '>' +
      '<span>I\'m this player\'s parent or guardian and I give permission for them to take part. I understand sessions are paid in advance.</span></label>' +
      (e.consent ? '<span class="err">' + h(e.consent) + '</span>' : '') + '</div>' +
      '</div>' +
      (S.bookingError ? '<p class="notice notice-bad" role="alert">' + h(S.bookingError) + '</p>' : '') +
      '<button class="btn btn-primary btn-block" type="submit"' + (S.busy ? ' disabled' : '') + '>' +
      (S.busy === 'redirect' ? 'Opening secure checkout…' : S.busy ? 'Saving your spots…' : 'Continue to payment (' + C.money(p.totalCents) + ')') + '</button>' +
      '</form>' +
      '<aside>' + summary(false) + '</aside>' +
      '</div></div>';
  }

  function bookPay() {
    var pend = S.pending;
    var until = new Date(pend.holdExpiresAt || (Date.now() + S.cfg.holdMinutes * 60000));
    var copy = API.mode === 'preview'
      ? 'This is a preview, so no money changes hands. On the real website this step opens a secure payment page where parents pay by card, Apple Pay or Google Pay.'
      : 'This is a demo, so no card is charged. When online payments are switched on, this step opens a secure checkout page where parents pay by card, Apple Pay or Google Pay.';
    return '<div class="wrap">' +
      '<div class="page-head"><h1>Payment</h1>' + stepper(3) + '</div>' +
      '<div class="book-layout">' +
      '<div class="panel">' +
      '<div class="test-pay"><h3>Demo payment</h3><p>' + h(copy) + '</p>' +
      '<div class="total-row"><span class="t-label">Total</span><span class="t-amt">' + C.money(pend.totalCents) + '</span></div>' +
      (S.payError ? '<p class="notice notice-bad" role="alert">' + h(S.payError) + '</p>' : '') +
      '<button class="btn btn-primary btn-block" data-action="test-pay"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Confirming…' : 'Complete demo payment') + '</button></div>' +
      '<p class="small muted">Your spots are saved until ' + until.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '. <button class="link" data-action="cancel-pending">Cancel and go back</button></p>' +
      '</div>' +
      '<aside>' + summary(false) + '</aside>' +
      '</div></div>';
  }

  function viewBooked() {
    var b = S.confirmation;
    if (!b) {
      return '<div class="wrap confirm"><h1>No booking to show</h1><p class="lede">If you just paid, check your email for the receipt.</p><div class="row-actions"><a class="btn btn-primary" href="#book">Book a session</a></div></div>';
    }
    if (b.status === 'pending') {
      return '<div class="wrap confirm"><h1>Confirming your payment…</h1><p class="lede">This usually takes a few seconds. Please keep this page open.</p></div>';
    }
    if (b.status !== 'paid') {
      return '<div class="wrap confirm"><h1>This booking wasn\'t finished</h1><p class="lede">No payment was taken and the spots were released. You can pick your sessions again.</p><div class="row-actions"><a class="btn btn-primary" href="#book">Back to booking</a></div></div>';
    }
    var items = b.sessions.slice().sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : C.minutes(T(a.track).start) - C.minutes(T(c.track).start); });
    var cal = API.calendarUrl(b.id, S.confirmationToken);
    return '<div class="wrap confirm">' +
      Art.celebrate() +
      '<h1>You\'re all set, ' + h(first(b.playerName)) + '!</h1>' +
      '<p class="ref">Booking number <b>' + h(b.id) + '</b> · ' + C.money(b.totalCents) + ' paid' + (S.cfg.payments === 'stripe' ? '. Your receipt is on its way to ' + h(b.parentEmail) + '.' : '') + '</p>' +
      '<div class="session-list">' + items.map(function (s) {
        var t = T(s.track);
        return '<div class="session-item"><div><div class="si-day">' + C.fmtDayLong(s.date) + '</div><div class="si-meta">' + (t.kind === 'group' ? h(t.label) + ' group training' : 'Private 1-on-1') + '</div></div><span class="si-time">' + C.fmtTimeRange(t.start, t.end) + '</span></div>';
      }).join('') + '</div>' +
      (S.cfg.location ? '<p><strong>Where:</strong> ' + h(S.cfg.location) + '</p>' : '') +
      '<div style="display:grid;gap:12px"><h2 class="h3">What to bring</h2><div class="bring-grid">' +
      bringItem(Art.ball(), 'Soccer ball', 'Size 4 or 5') + bringItem(Art.shin(), 'Shin guards', '') + bringItem(Art.cleat(), 'Cleats or turf shoes', '') + bringItem(Art.bottle(), 'Water bottle', '') +
      '</div><p class="muted">Please arrive 5 minutes early.</p></div>' +
      '<div class="row-actions">' + (cal ? '<a class="btn btn-primary" href="' + h(cal) + '">Add to my calendar</a>' : '') + '<a class="btn btn-secondary" href="#book">Book more sessions</a></div>' +
      '</div>';
  }

  /* ---------- Winter Select ---------- */
  function formatCode(v) {
    var raw = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw === 'W' || raw === 'WS') return raw;
    if (raw.indexOf('WS') === 0 && raw.length <= 10) raw = raw.slice(2);
    raw = raw.slice(0, 8);
    if (!raw) return '';
    return 'WS-' + raw.slice(0, 4) + (raw.length > 4 ? '-' + raw.slice(4) : '');
  }

  function viewWinter() {
    var W = S.winter;
    var host = S.cfg.winter.host;
    var card;
    if (W.stage === 'done') {
      card = Art.trophy() +
        '<h2>Welcome to Winter Select, ' + h(first(W.done.playerName)) + '!</h2>' +
        '<p>Your spot on the team is confirmed. I\'ll be in touch at <strong>' + h(W.done.email) + '</strong> with the tournament dates and training plan.</p>' +
        '<p class="ref">Confirmation number <b>' + h(W.done.id) + '</b></p>';
    } else if (W.stage === 'form') {
      var f = W.form, e = W.errors;
      card = '<div class="row-actions"><span class="chip chip-ok">Code accepted</span><span class="code-pill">' + h(W.invite.code) + '</span></div>' +
        '<h2>' + (W.invite.inviteeName ? h(first(W.invite.inviteeName)) + ', you\'ve been selected!' : 'You\'ve been selected!') + '</h2>' +
        '<p class="muted">Here\'s what joining the team means. If it works for your family, fill in the details below to accept the spot.</p>' +
        '<ul class="commit-list">' + S.cfg.winter.commitments.map(function (c) { return '<li>' + h(c) + '</li>'; }).join('') + '</ul>' +
        '<form id="enroll-form" novalidate data-scope="winter" style="display:grid;gap:16px">' +
        '<div class="form-grid">' +
        field('w-player', 'Player\'s name', textInput('w-player', 'playerName', f.playerName, 'text', 'off', e.playerName), e.playerName) +
        field('w-age', 'Player\'s age', ageSelect('w-age', 'playerAge', f.playerAge, e.playerAge), e.playerAge) +
        field('w-parent', 'Your name (parent or guardian)', textInput('w-parent', 'parentName', f.parentName, 'text', 'name', e.parentName), e.parentName) +
        field('w-phone', 'Your mobile number', textInput('w-phone', 'phone', f.phone, 'tel', 'tel', e.phone), e.phone) +
        field('w-email', 'Your email', textInput('w-email', 'email', f.email, 'email', 'email', e.email), e.email, ' full') +
        field('w-sign', 'Sign by typing your full name', '<input class="input sign-input" id="w-sign" data-bind="signature" value="' + h(f.signature) + '" autocomplete="off">', e.signature, ' full') +
        '<div class="field full' + (e.agree ? ' has-error' : '') + '"><label class="check" for="w-agree"><input type="checkbox" id="w-agree" data-bind="agree"' + (f.agree ? ' checked' : '') + '>' +
        '<span>We\'ve read the commitment above and accept a spot on the Winter Select team.</span></label>' + (e.agree ? '<span class="err">' + h(e.agree) + '</span>' : '') + '</div>' +
        '</div>' +
        (W.error ? '<p class="notice notice-bad" role="alert">' + h(W.error) + '</p>' : '') +
        '<button class="btn btn-primary btn-block" type="submit"' + (W.busy ? ' disabled' : '') + '>' + (W.busy ? 'Saving…' : 'Accept my spot') + '</button>' +
        '<button type="button" class="link small" data-action="winter-reset" style="justify-self:start">Use a different code</button>' +
        '</form>';
    } else {
      card = '<h2>Enter your invite code</h2>' +
        '<form id="code-form" novalidate style="display:grid;gap:14px">' +
        '<div class="field' + (W.error ? ' has-error' : '') + '"><label for="ws-code">You\'ll find it in the text or email from your coach</label>' +
        '<input class="code-input" id="ws-code" data-code="1" value="' + h(W.code) + '" placeholder="WS-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="14"' + (W.error ? ' aria-invalid="true" aria-describedby="ws-code-err"' : '') + '>' +
        (W.error ? '<span class="err" id="ws-code-err" role="alert">' + h(W.error) + '</span>' : '') + '</div>' +
        '<button class="btn btn-primary btn-block" type="submit"' + (W.busy ? ' disabled' : '') + '>' + (W.busy ? 'Checking…' : 'Continue') + '</button>' +
        '</form>' +
        '<p class="small muted">No code? Winter Select is invite only, but our group sessions are open to everyone. <a class="host-link" href="#book">Book a session</a></p>' +
        (API.mode === 'preview' ? '<p class="notice notice-info small">Preview: try the code <strong>WS-DEMO-2026</strong>, or make your own in the coach dashboard.</p>' : '');
    }
    return '<section class="winter-page"><div class="wrap">' +
      '<div><p class="kicker">Invite only</p><h1>' + SNOW + 'Winter Select</h1>' +
      '<p class="lede">' + h(S.cfg.winter.summary) + '</p>' +
      (host ? '<div class="host-card"><span>Tournaments hosted by</span><strong>' + h(host.name) + '</strong>' + hostLink() + '</div>' : '') +
      '<div class="winter-points">' +
      '<div><span class="num">1</span><p>I pick the players and send each family a personal code by text or email.</p></div>' +
      '<div><span class="num">2</span><p>Enter the code here to see what joining the team involves.</p></div>' +
      '<div><span class="num">3</span><p>Fill in your details and sign to accept. Each code can only be used once.</p></div>' +
      '</div></div>' +
      '<div class="winter-card">' + card + '</div>' +
      '</div></section>';
  }

  /* ---------- coach dashboard ---------- */
  function viewCoach() {
    var K = S.coach;
    if (!K.checked) return '<div class="wrap coach"><p class="boot">Checking sign-in…</p></div>';
    if (!K.authed) {
      return '<div class="wrap coach"><form class="panel coach-login" id="login-form" novalidate>' +
        '<h2>Coach sign-in</h2>' +
        '<div class="field' + (K.loginError ? ' has-error' : '') + '"><label for="coach-pass">Password</label><input class="input" id="coach-pass" type="password" autocomplete="current-password"></div>' +
        (K.loginError ? '<p class="notice notice-bad" role="alert">' + h(K.loginError) + '</p>' : '') +
        '<button class="btn btn-primary btn-block" type="submit"' + (K.busy ? ' disabled' : '') + '>' + (K.busy ? 'Signing in…' : 'Sign in') + '</button>' +
        (API.admin.hint ? '<p class="notice notice-info small">' + h(API.admin.hint) + '</p>' : '') +
        '</form></div>';
    }
    var tabs = [['sessions', 'Sessions'], ['winter', 'Winter Select'], ['closures', 'Days off']];
    var content = K.tab === 'winter' ? coachWinter() : K.tab === 'closures' ? coachClosures() : coachSessions();
    return '<div class="wrap coach">' +
      '<div class="page-head" style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:end;gap:12px">' +
      '<h1>Coach dashboard</h1>' +
      '<div class="row-actions"><button class="btn btn-secondary btn-sm" data-action="coach-refresh">Refresh</button><button class="btn btn-secondary btn-sm" data-action="logout">Sign out</button></div></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button role="tab" data-action="coach-tab" data-id="' + t[0] + '" aria-selected="' + (K.tab === t[0]) + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      (K.error ? '<p class="notice notice-bad" role="alert" style="margin-bottom:16px">' + h(K.error) + '</p>' : '') +
      content + '</div>';
  }

  function coachSessions() {
    var o = S.coach.overview;
    if (!o) return '<p class="boot">Loading sessions…</p>';
    var weeks = o.schedule.weeks;
    var thisWeek = 0, total = 0;
    weeks.forEach(function (w, i) {
      Object.keys(w.sessions).forEach(function (k) {
        w.sessions[k].forEach(function (s) { var n = (o.rosters[s.id] || []).length; total += n; if (i === 0) thisWeek += n; });
      });
    });
    var enrolled = S.coach.winter ? S.coach.winter.enrollments.length : null;
    var stats = '<div class="stats">' +
      stat(thisWeek, 'Players booked this week') +
      stat(total, 'Spots booked, next ' + weeks.length + ' weeks') +
      stat(C.money(o.revenue7d.cents), 'Paid in the last 7 days') +
      stat(enrolled == null ? '–' : enrolled, 'Winter Select players') + '</div>';

    var body = weeks.map(function (w) {
      var rows = [];
      w.days.forEach(function (d) {
        S.cfg.tracks.forEach(function (t) {
          var s = w.sessions[t.id].filter(function (x) { return x.date === d; })[0];
          if (s) rows.push(coachSessionRow(s, t, o.rosters[s.id] || []));
        });
      });
      return '<div class="c-week"><h3>Week of ' + h(w.label) + '</h3><div class="c-sessions">' + rows.join('') + '</div></div>';
    }).join('');
    return stats + body;
  }
  function stat(v, label) { return '<div class="stat"><span class="s-val">' + h(v) + '</span><span class="s-label">' + h(label) + '</span></div>'; }

  function coachSessionRow(s, t, roster) {
    var open = S.coach.open[s.id];
    var n = roster.length;
    var pct = Math.min(100, Math.round((n / t.capacity) * 100));
    var chip = s.status === 'closed' ? '<span class="chip chip-bad">Day off</span>' : s.status === 'past' ? '<span class="chip">Started</span>' : n >= t.capacity ? '<span class="chip chip-warn">Full</span>' : '';
    var html = '<div class="c-session">' +
      '<button data-action="coach-open" data-id="' + s.id + '" aria-expanded="' + Boolean(open) + '">' +
      '<span class="cs-day">' + C.fmtDay(s.date) + '</span>' +
      '<span class="cs-track">' + (t.kind === 'private' ? '1-on-1' : h(t.label)) + ' · ' + C.fmtTimeRange(t.start, t.end) + '</span>' +
      '<span class="fill" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' +
      '<span class="cs-chip">' + chip + '</span>' +
      '<span class="cs-count">' + n + '/' + t.capacity + '</span>' +
      '</button>';
    if (open) {
      html += '<div class="roster">' + (roster.length ? '<table class="table"><thead><tr><th>Player</th><th>Parent</th><th>Contact</th><th>Payment</th><th>Booking</th></tr></thead><tbody>' +
        roster.map(function (r) {
          var confirming = S.coach.confirm === 'b:' + r.bookingId;
          return '<tr><td><strong>' + h(r.playerName) + '</strong>, ' + h(r.playerAge) + (r.sample ? ' <span class="chip">Example</span>' : '') + (r.notes ? '<div class="small muted">' + h(r.notes) + '</div>' : '') + '</td>' +
            '<td>' + h(r.parentName) + '</td>' +
            '<td class="nowrap"><a href="tel:' + h(digits(r.phone)) + '">' + h(r.phone) + '</a><br><a href="mailto:' + h(r.email) + '">' + h(r.email) + '</a></td>' +
            '<td>' + (r.status === 'paid' ? '<span class="chip chip-ok">Paid</span>' : '<span class="chip chip-warn">Paying now</span>') + '</td>' +
            '<td class="nowrap"><span class="small">' + h(r.bookingId) + '</span><br>' +
            (confirming
              ? '<span class="inline-confirm">Cancel this booking? <button class="link link-danger" data-action="coach-cancel-yes" data-id="' + h(r.bookingId) + '">Yes, cancel</button><button class="link" data-action="coach-cancel-no">Keep</button></span>'
              : '<button class="link small link-danger" data-action="coach-cancel" data-id="' + h(r.bookingId) + '">Cancel booking</button>') +
            '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="empty">Nobody has booked this session yet.</p>') +
        (roster.length ? '<p class="empty" style="padding-top:0">Cancelling frees up the spots. Give refunds from your Stripe dashboard.</p>' : '') +
        '</div>';
    }
    return html + '</div>';
  }

  function inviteMessage(inv) {
    var url = API.siteUrl();
    var host = S.cfg.winter.host;
    var greet = inv.invitee_name ? 'Hi ' + first(inv.invitee_name) + '!' : 'Hi!';
    return greet + " You've been selected for " + S.cfg.businessName + ' Winter Select, our invite-only team for winter tournaments' + (host ? ' at ' + host.name : '') + '.\n\n' +
      'To accept your spot, go to ' + (url ? url + '/#winter' : 'the Winter Select page on our website') + ' and enter your code:\n\n' + inv.code +
      "\n\nThis code is just for you, so please don't share it." + (S.cfg.coachName ? '\n\n– Coach ' + S.cfg.coachName : '');
  }

  function coachWinter() {
    var K = S.coach, W = K.winter;
    if (!W) return '<p class="boot">Loading Winter Select…</p>';
    var f = K.inviteForm;
    var result = '';
    if (K.lastInvite) {
      var inv = K.lastInvite;
      var contact = inv.contact || '';
      var isEmail = contact.indexOf('@') !== -1;
      var isPhone = !isEmail && digits(contact).length >= 10;
      var msg = K.inviteMsg;
      result = '<div class="invite-result" aria-live="polite"><span class="small muted">New invite code' + (inv.invitee_name ? ' for ' + h(inv.invitee_name) : '') + '</span>' +
        '<span class="big-code">' + h(inv.code) + '</span>' +
        '<label class="small" for="invite-msg" style="font-weight:700">Message to send</label>' +
        '<textarea class="textarea invite-msg" id="invite-msg" data-invite-msg="1">' + h(msg) + '</textarea>' +
        '<div class="row-actions"><button class="btn btn-primary btn-sm" data-action="copy-invite">Copy message</button>' +
        (isEmail ? '<a class="btn btn-secondary btn-sm" href="mailto:' + h(contact) + '?subject=' + encodeURIComponent('Your Winter Select invite') + '&body=' + encodeURIComponent(msg) + '">Open in email</a>' : '') +
        (isPhone ? '<a class="btn btn-secondary btn-sm" href="sms:' + h(digits(contact)) + '?&body=' + encodeURIComponent(msg) + '">Open in Messages</a>' : '') +
        '</div><span class="small muted">Paste it into a text or email. Each code works once.</span></div>';
    }
    var form = '<form class="panel" id="invite-form" novalidate data-scope="invite">' +
      '<h2>Invite a player</h2>' +
      '<div class="field"><label for="i-name">Player\'s name</label><input class="input" id="i-name" data-bind="name" value="' + h(f.name) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="i-contact">Parent\'s email or mobile <span class="muted" style="font-weight:400">(optional)</span></label><input class="input" id="i-contact" data-bind="contact" value="' + h(f.contact) + '" autocomplete="off"><span class="hint">Lets you open the message straight in your email or texting app.</span></div>' +
      '<div class="field"><label for="i-note">Note for yourself <span class="muted" style="font-weight:400">(optional)</span></label><input class="input" id="i-note" data-bind="note" value="' + h(f.note) + '" autocomplete="off" placeholder="For example: left wing"></div>' +
      '<button class="btn btn-primary btn-block" type="submit"' + (K.busy ? ' disabled' : '') + '>' + (K.busy ? 'Creating…' : 'Create invite code') + '</button>' +
      result + '</form>';

    var invites = W.invites.length ? '<table class="table"><thead><tr><th>Code</th><th>Player</th><th>Sent to</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>' +
      W.invites.map(function (i) {
        var status = i.status === 'redeemed' ? '<span class="chip chip-ok">Accepted</span>' : i.status === 'revoked' ? '<span class="chip chip-bad">Cancelled</span>' : '<span class="chip chip-warn">Waiting</span>';
        var confirming = S.coach.confirm === 'i:' + i.code;
        var action = i.status !== 'active' ? '' : confirming
          ? '<span class="inline-confirm"><button class="link link-danger" data-action="revoke-yes" data-id="' + h(i.code) + '">Yes, cancel code</button><button class="link" data-action="coach-cancel-no">Keep</button></span>'
          : '<button class="link small" data-action="copy-code" data-id="' + h(i.code) + '">Copy message</button> · <button class="link small link-danger" data-action="revoke" data-id="' + h(i.code) + '">Cancel</button>';
        return '<tr><td class="nowrap"><strong>' + h(i.code) + '</strong></td><td>' + h(i.invitee_name || '—') + (i.sample ? ' <span class="chip">Example</span>' : '') + (i.note ? '<div class="small muted">' + h(i.note) + '</div>' : '') + '</td><td>' + h(i.contact || '—') + '</td><td>' + status + '</td><td class="nowrap small">' + when(i.created_at) + '</td><td class="nowrap">' + action + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="empty">No invite codes yet. Create one to get started.</p>';

    var enrolled = W.enrollments.length ? '<table class="table"><thead><tr><th>Player</th><th>Parent</th><th>Contact</th><th>Signed</th><th>Code</th></tr></thead><tbody>' +
      W.enrollments.map(function (e) {
        return '<tr><td><strong>' + h(e.player_name) + '</strong>, ' + h(e.player_age) + (e.sample ? ' <span class="chip">Example</span>' : '') + '</td><td>' + h(e.parent_name) + '</td>' +
          '<td class="nowrap"><a href="tel:' + h(digits(e.phone)) + '">' + h(e.phone) + '</a><br><a href="mailto:' + h(e.email) + '">' + h(e.email) + '</a></td>' +
          '<td class="small">' + h(e.signature) + '<br><span class="muted">' + when(e.created_at) + '</span></td><td class="small nowrap">' + h(e.code) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="empty">Nobody has accepted an invite yet.</p>';

    return '<div class="coach-grid">' + form +
      '<div style="display:grid;gap:24px;min-width:0">' +
      '<div style="display:grid;gap:10px"><h2 class="h3">Team: ' + W.enrollments.length + ' accepted</h2><div class="table-wrap">' + enrolled + '</div></div>' +
      '<div style="display:grid;gap:10px"><h2 class="h3">Invite codes</h2><div class="table-wrap">' + invites + '</div></div>' +
      '</div></div>';
  }

  function coachClosures() {
    var K = S.coach, o = K.overview;
    if (!o) return '<p class="boot">Loading…</p>';
    var f = K.closureForm;
    var today = o.schedule.today;
    var list = o.closures.length ? '<table class="table"><thead><tr><th>Date</th><th>Session</th><th>Reason</th><th></th></tr></thead><tbody>' +
      o.closures.map(function (c) {
        var tr = T(c.track) || {};
        var t = c.track === 'all' ? 'All sessions' : (tr.kind === 'private' ? '1-on-1' : tr.label);
        return '<tr><td class="nowrap"><strong>' + C.fmtDayLong(c.date) + '</strong></td><td>' + h(t) + '</td><td>' + h(c.reason || '—') + '</td>' +
          '<td><button class="link small" data-action="reopen" data-id="' + h(c.date + '|' + c.track) + '">Reopen</button></td></tr>';
      }).join('') + '</tbody></table>' : '<p class="empty">No days off coming up. Every Wednesday, Thursday and Friday is open for booking.</p>';
    return '<div style="display:grid;gap:24px">' +
      '<form class="panel" id="closure-form" novalidate data-scope="closure">' +
      '<div><h2>Take a day off</h2><p class="muted small" style="margin-top:6px">Families can\'t book a day you close. Anyone already booked stays on the list, so let them know and refund them in Stripe if needed.</p></div>' +
      '<div class="closure-form">' +
      '<div class="field"><label for="c-date">Date</label><input class="input" type="date" id="c-date" data-bind="date" min="' + today + '" value="' + h(f.date) + '"></div>' +
      '<div class="field"><label for="c-track">Session</label><select class="select" id="c-track" data-bind="track"><option value="all"' + (f.track === 'all' ? ' selected' : '') + '>All sessions</option>' +
      S.cfg.tracks.map(function (t) { return '<option value="' + t.id + '"' + (f.track === t.id ? ' selected' : '') + '>' + h(t.kind === 'private' ? '1-on-1' : t.label) + ' (' + C.fmtTime(t.start) + ')</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="c-reason">Reason families will see</label><input class="input" id="c-reason" data-bind="reason" maxlength="40" value="' + h(f.reason) + '" placeholder="For example: Thanksgiving"></div>' +
      '<button class="btn btn-primary" type="submit">Close this day</button>' +
      '</div>' +
      (K.closureError ? '<p class="notice notice-bad" role="alert">' + h(K.closureError) + '</p>' : '') +
      '</form>' +
      '<div style="display:grid;gap:10px"><h2 class="h3">Upcoming days off</h2><div class="table-wrap">' + list + '</div></div>' +
      '</div>';
  }

  /* ---------- data loading ---------- */
  function loadSchedule(force) {
    if (!force && S.sched && Date.now() - S.schedAt < 30000) return Promise.resolve();
    return API.schedule().then(function (sched) {
      S.sched = sched; S.schedAt = Date.now(); S.schedError = '';
      if (S.step === 'dates') pruneCart();
    }).catch(function (e) { S.schedError = e.message; }).then(render);
  }
  function pruneCart() {
    var idx = C.indexSchedule(S.sched);
    var before = S.cart.length;
    S.cart = S.cart.filter(function (id) { return idx[id] && idx[id].status === 'open'; });
    if (S.cart.length < before) {
      saveCart();
      S.notice = { kind: 'warn', text: 'Some sessions in your booking are no longer available, so we removed them.' };
    }
  }

  function loadCoach() {
    var K = S.coach;
    var p1 = API.admin.overview().then(function (o) { K.overview = o; });
    var p2 = API.admin.winter().then(function (w) { K.winter = w; });
    return Promise.all([p1, p2]).then(function () { K.error = ''; }).catch(function (e) {
      if (e.status === 401) { K.authed = false; K.loginError = ''; }
      else K.error = e.message;
    }).then(render);
  }

  function onRoute() {
    S.route = routeFromHash();
    if (S.route === 'book') { loadSchedule(); }
    if (S.route === 'coach' && !S.coach.checked) {
      API.admin.me().then(function (r) { S.coach.authed = r.authed; }).catch(function () { S.coach.authed = false; }).then(function () {
        S.coach.checked = true;
        if (S.coach.authed) loadCoach(); else render();
      });
    } else if (S.route === 'coach' && S.coach.authed) loadCoach();
    render();
    window.scrollTo(0, 0);
  }

  /* Remove group sessions that don't match the player's age group. */
  function dropOtherGroups() {
    var t = currentTrack();
    var before = S.cart.length;
    S.cart = S.cart.filter(function (id) {
      var p = C.parseSessionId(id), tr = p && T(p.trackId);
      return !tr || tr.kind !== 'group' || (t && tr.id === t.id);
    });
    if (S.cart.length < before) {
      saveCart();
      S.notice = { kind: 'info', text: 'We removed the dates you picked for the other age group.' };
    }
  }

  /* ---------- actions ---------- */
  var actions = {
    'pick': function (el) {
      var t = T(el.dataset.id);
      if (!t) return;
      S.kind = t.kind; ls.set('kind', S.kind);
      if (t.kind === 'group' && !(S.age >= t.minAge && S.age <= t.maxAge)) { S.age = null; ls.set('age', null); }
      if (S.step !== 'pay') S.step = 'dates';
    },
    'kind': function (el) {
      S.kind = el.dataset.id; ls.set('kind', S.kind); S.notice = null; render();
    },
    'age': function (el) {
      S.age = Number(el.dataset.id); ls.set('age', S.age);
      S.form.playerAge = String(S.age);
      S.notice = null; dropOtherGroups(); render();
    },
    'slot': function (el) {
      var id = el.dataset.id, i = S.cart.indexOf(id);
      if (i >= 0) S.cart.splice(i, 1); else S.cart.push(id);
      S.notice = null; saveCart(); render();
    },
    'week': function (el) {
      var t = currentTrack();
      var w = S.sched.weeks.filter(function (x) { return x.key === el.dataset.id; })[0];
      if (!w || !t) return;
      var ss = w.sessions[t.id];
      var all = ss.every(function (s) { return S.cart.indexOf(s.id) !== -1; });
      if (all) S.cart = S.cart.filter(function (id) { return !ss.some(function (s) { return s.id === id; }); });
      else ss.forEach(function (s) { if (s.status === 'open' && S.cart.indexOf(s.id) === -1) S.cart.push(s.id); });
      S.notice = null; saveCart(); render();
    },
    'remove-line': function (el) {
      var ids = el.dataset.id.split(',');
      S.cart = S.cart.filter(function (id) { return ids.indexOf(id) === -1; });
      saveCart(); render();
    },
    'clear-cart': function () { S.cart = []; saveCart(); render(); },
    'to-details': function () {
      if (!S.cart.length) return;
      S.step = 'details'; S.notice = null; S.bookingError = ''; render(); window.scrollTo(0, 0);
      var el = document.getElementById('f-player'); if (el && !S.form.playerName) el.focus();
    },
    'back-dates': function () { S.step = 'dates'; S.errors = {}; S.bookingError = ''; render(); window.scrollTo(0, 0); },
    'reload-schedule': function () { S.schedError = ''; render(); loadSchedule(true); },
    'test-pay': function () {
      S.busy = true; S.payError = ''; render();
      API.testPay(S.pending.bookingId, S.pending.token).then(function (b) { finishBooking(b, S.pending.token); }).catch(function (e) {
        S.busy = false;
        if (e.status === 410) { S.pending = null; S.step = 'dates'; S.notice = { kind: 'bad', text: e.message }; loadSchedule(true); }
        else { S.payError = e.message; render(); }
      });
    },
    'cancel-pending': function () {
      var p = S.pending;
      S.pending = null; S.step = 'details'; render();
      API.cancelPending(p.bookingId, p.token).catch(function () {}).then(function () { loadSchedule(true); });
    },
    'winter-reset': function () { S.winter = { stage: 'code', code: '', invite: null, error: '', form: blankWinterForm(), errors: {}, done: null, busy: false }; render(); },
    'logout': function () {
      API.admin.logout().catch(function () {}).then(function () { S.coach.authed = false; S.coach.overview = null; S.coach.winter = null; render(); });
    },
    'coach-refresh': function () { loadCoach().then(function () { toast('Up to date'); }); },
    'coach-tab': function (el) { S.coach.tab = el.dataset.id; S.coach.confirm = null; render(); },
    'coach-open': function (el) { S.coach.open[el.dataset.id] = !S.coach.open[el.dataset.id]; render(); },
    'coach-cancel': function (el) { S.coach.confirm = 'b:' + el.dataset.id; render(); },
    'coach-cancel-no': function () { S.coach.confirm = null; render(); },
    'coach-cancel-yes': function (el) {
      S.coach.confirm = null;
      API.admin.cancelBooking(el.dataset.id).then(function () { toast('Booking cancelled'); return loadCoach(); }).catch(function (e) { S.coach.error = e.message; render(); });
    },
    'revoke': function (el) { S.coach.confirm = 'i:' + el.dataset.id; render(); },
    'revoke-yes': function (el) {
      S.coach.confirm = null;
      API.admin.revokeInvite(el.dataset.id).then(function () { toast('Code cancelled'); return loadCoach(); }).catch(function (e) { S.coach.error = e.message; render(); });
    },
    'copy-invite': function () {
      var ta = document.getElementById('invite-msg');
      copyText(ta.value, ta);
    },
    'copy-code': function (el) {
      var inv = S.coach.winter.invites.filter(function (i) { return i.code === el.dataset.id; })[0];
      if (inv) copyText(inviteMessage(inv));
    },
    'reopen': function (el) {
      var parts = el.dataset.id.split('|');
      API.admin.removeClosure(parts[0], parts[1]).then(function (r) { S.coach.overview.closures = r.closures; toast('Day reopened'); return loadCoach(); }).catch(function (e) { S.coach.error = e.message; render(); });
    },
    'reset-preview': function () {
      if (API.reset) API.reset();
      S.cart = []; saveCart(); S.sched = null; S.step = 'dates'; S.pending = null; S.confirmation = null;
      S.kind = null; S.age = null; ls.set('kind', null); ls.set('age', null);
      S.coach.overview = null; S.coach.winter = null; S.coach.lastInvite = null; S.coach.checked = false; S.coach.authed = false;
      S.winter = { stage: 'code', code: '', invite: null, error: '', form: blankWinterForm(), errors: {}, done: null, busy: false };
      toast('Preview reset');
      onRoute();
    }
  };

  function copyText(text, fallbackEl) {
    var done = function () { toast('Copied. Paste it into a text or email.'); };
    var fallback = function () {
      if (fallbackEl) { fallbackEl.focus(); fallbackEl.select(); toast('Press Ctrl+C or ⌘C to copy'); }
      else toast("Couldn't copy here. Select the text and copy it.");
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  function finishBooking(b, token) {
    S.confirmation = b; S.confirmationToken = token;
    S.cart = []; saveCart();
    S.pending = null; S.step = 'dates'; S.busy = false; S.form.consent = false; S.sched = null;
    go('booked');
  }

  /* ---------- forms ---------- */
  function submitDetails() {
    var f = S.form;
    var payload = {
      items: S.cart.slice(),
      player: { name: f.playerName, age: f.playerAge },
      parent: { name: f.parentName, email: f.email, phone: f.phone },
      notes: f.notes, consent: f.consent
    };
    var v = C.validateBooking(S.cfg, payload);
    if (v.errors) {
      S.errors = v.errors; S.bookingError = v.errors.items || ''; render(); focusFirstError(); return;
    }
    S.errors = {}; S.bookingError = ''; S.busy = true; render();
    API.createBooking(payload).then(function (r) {
      if (r.checkoutUrl) { S.busy = 'redirect'; render(); location.href = r.checkoutUrl; return; }
      S.pending = { bookingId: r.bookingId, token: r.token, totalCents: r.totalCents, holdExpiresAt: Date.now() + S.cfg.holdMinutes * 60000 };
      S.busy = false; S.payError = ''; S.step = 'pay'; render(); window.scrollTo(0, 0);
    }).catch(function (e) {
      S.busy = false;
      if (e.status === 409 && e.data && e.data.unavailable) {
        S.cart = S.cart.filter(function (id) { return e.data.unavailable.indexOf(id) === -1; });
        saveCart(); S.step = 'dates'; S.notice = { kind: 'bad', text: e.message };
        render(); loadSchedule(true); return;
      }
      if (e.data && e.data.fields) S.errors = e.data.fields;
      S.bookingError = e.message; render(); focusFirstError();
    });
  }

  function submitCode() {
    var W = S.winter;
    var code = C.normalizeCode(W.code);
    if (!code) { W.error = 'Codes look like WS-4F7K-Q2MX: the letters WS followed by eight letters or numbers.'; render(); focusFirstError(); return; }
    W.busy = true; W.error = ''; render();
    API.winterCheck(code).then(function (r) {
      W.invite = r; W.stage = 'form'; W.errors = {};
      if (r.inviteeName && !W.form.playerName) W.form.playerName = r.inviteeName;
    }).catch(function (e) { W.error = e.message; }).then(function () {
      W.busy = false; render();
      if (W.stage === 'form') { var el = document.getElementById(W.form.playerName ? 'w-age' : 'w-player'); if (el) el.focus(); }
      else focusFirstError();
    });
  }

  function submitEnroll() {
    var W = S.winter, f = W.form;
    var payload = {
      code: W.invite.code,
      player: { name: f.playerName, age: f.playerAge },
      parent: { name: f.parentName, email: f.email, phone: f.phone },
      signature: f.signature, agree: f.agree
    };
    var v = C.validateEnrollment(payload);
    if (v.errors) { W.errors = v.errors; W.error = ''; render(); focusFirstError(); return; }
    W.errors = {}; W.error = ''; W.busy = true; render();
    API.winterEnroll(payload).then(function (r) {
      W.done = { id: r.enrollmentId, playerName: r.playerName, email: f.email.trim() };
      W.stage = 'done';
    }).catch(function (e) {
      if (e.data && e.data.fields) W.errors = e.data.fields;
      W.error = e.message;
    }).then(function () { W.busy = false; render(); window.scrollTo(0, 0); });
  }

  function submitLogin() {
    var K = S.coach;
    var pw = document.getElementById('coach-pass').value;
    if (!pw) { K.loginError = 'Enter your password.'; render(); return; }
    K.busy = true; K.loginError = ''; render();
    API.admin.login(pw).then(function () { K.authed = true; K.busy = false; render(); return loadCoach(); })
      .catch(function (e) { K.busy = false; K.loginError = e.message; render(); var el = document.getElementById('coach-pass'); if (el) el.focus(); });
  }

  function submitInvite() {
    var K = S.coach;
    K.busy = true; render();
    API.admin.createInvite(K.inviteForm).then(function (r) {
      K.lastInvite = r.invite; K.inviteMsg = inviteMessage(r.invite);
      K.inviteForm = { name: '', contact: '', note: '' };
      toast('Invite code created');
      return API.admin.winter().then(function (w) { K.winter = w; });
    }).catch(function (e) { K.error = e.message; }).then(function () { K.busy = false; render(); });
  }

  function submitClosure() {
    var K = S.coach, f = K.closureForm;
    if (!f.date) { K.closureError = 'Pick a date.'; render(); return; }
    API.admin.addClosure(f).then(function (r) {
      K.overview.closures = r.closures; K.closureError = ''; K.closureForm = { date: '', track: 'all', reason: '' };
      toast('Day closed');
      return loadCoach();
    }).catch(function (e) { K.closureError = e.message; render(); });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el || !$app.contains(el)) return;
    var fn = actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'BUTTON') ev.preventDefault();
    fn(el, ev);
  });

  document.addEventListener('submit', function (ev) {
    var id = ev.target.id;
    ev.preventDefault();
    if (id === 'details-form') submitDetails();
    else if (id === 'code-form') submitCode();
    else if (id === 'enroll-form') submitEnroll();
    else if (id === 'login-form') submitLogin();
    else if (id === 'invite-form') submitInvite();
    else if (id === 'closure-form') submitClosure();
  });

  function bindTarget(el) {
    var scope = el.closest('[data-scope]');
    if (!scope) return null;
    var s = scope.dataset.scope;
    return s === 'form' ? S.form : s === 'winter' ? S.winter.form : s === 'invite' ? S.coach.inviteForm : s === 'closure' ? S.coach.closureForm : null;
  }
  function onField(ev) {
    var el = ev.target;
    if (el.dataset.code) {
      var formatted = formatCode(el.value);
      if (formatted !== el.value) el.value = formatted;
      S.winter.code = formatted;
      return;
    }
    if (el.dataset.inviteMsg) { S.coach.inviteMsg = el.value; return; }
    var key = el.dataset.bind;
    if (!key) return;
    var target = bindTarget(el);
    if (!target) return;
    target[key] = el.type === 'checkbox' ? el.checked : el.value;
  }
  document.addEventListener('input', onField);
  document.addEventListener('change', onField);

  window.addEventListener('hashchange', onRoute);

  /* ---------- boot ---------- */
  function cleanUrl() {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* sandboxed */ }
  }

  function pollBooking(id, t, sessionId, tries) {
    return API.getBooking(id, t, sessionId).then(function (b) {
      S.confirmation = b; render();
      if (b.status === 'pending' && tries > 0) {
        return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return pollBooking(id, t, sessionId, tries - 1); });
      }
    });
  }

  API.config().then(function (cfg) {
    S.cfg = cfg;
    if (S.kind !== 'group' && S.kind !== 'private') S.kind = null;
    if (S.age && !groupForAge(S.age)) S.age = null;
    var params = new URLSearchParams(location.search);
    var bid = params.get('booking'), cid = params.get('cancelled'), t = params.get('t');
    var start = Promise.resolve();
    if (bid && t) {
      S.confirmationToken = t;
      S.cart = []; saveCart();
      start = pollBooking(bid, t, params.get('session_id'), 6).catch(function () { S.confirmation = null; });
      cleanUrl();
    } else if (cid && t) {
      start = API.cancelPending(cid, t).catch(function () {}).then(function () {
        S.notice = { kind: 'info', text: 'Payment was cancelled and nothing was charged. Your sessions are still in your booking.' };
      });
      cleanUrl();
    }
    return start.then(onRoute);
  }).catch(function (e) {
    $app.innerHTML = '<p class="boot">The site couldn\'t load. ' + h(e.message) + '</p>';
  });
})();
