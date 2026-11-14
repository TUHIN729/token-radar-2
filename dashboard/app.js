// Token Radar's plain dashboard. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table,
// a per-protocol detail drawer with the model's own inputs, and the
// already-live contrast set. No network: every byte it shows is in data.js.
//
// Deep links, for screenshots and sharing: #detail=<slug> opens a
// protocol's drawer, #filter=<category> filters the board, #q=<text>
// fills the search box.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  var drawer = document.getElementById('drawer');
  if (!DATA || !app) return;

  var rows = DATA.rows || [];
  var live = DATA.live || [];
  var model = DATA.model || {};
  var categories = [];
  rows.forEach(function (r) {
    if (categories.indexOf(r.category) === -1) categories.push(r.category);
  });
  categories.sort();

  var state = {
    q: '',
    category: 'all',
    watchlistOnly: false,
    tab: 'pre-token',
    sortKey: 'rank',
    sortDir: 1,
    selected: null,
  };

  // ------------------------------------------------------------ formatting

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function moneyFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function factorText(n) {
    return 'x' + n.toFixed(2);
  }

  // -------------------------------------------------------------- DOM bits

  function h(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function section(title, body) {
    var wrap = h('section');
    wrap.appendChild(h('h3', null, title));
    wrap.appendChild(body);
    return wrap;
  }

  // ------------------------------------------------------------- filtering

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.watchlistOnly && !r.on_watchlist) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sortKey;
    var dir = state.sortDir;
    out.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return dir * (av < bv ? -1 : av > bv ? 1 : 0);
      return dir * (av - bv);
    });
    return out;
  }

  // -------------------------------------------------------------- the board

  function renderStats() {
    var total = rows.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
    var stats = h('div', 'stats');
    var cells = [
      [money(total), 'total implied value on the board'],
      [String(rows.length), 'pre-token protocols ranked'],
      [String(DATA.counts.watchlist), 'on the snapshot watchlist'],
      [DATA.as_of, 'snapshot date (UTC)'],
    ];
    cells.forEach(function (cell) {
      var box = h('div', 'stat');
      box.appendChild(h('span', 'num', cell[0]));
      box.appendChild(h('span', 'lbl', cell[1]));
      stats.appendChild(box);
    });
    return stats;
  }

  function renderModelNote() {
    var note = h('p', 'model-note');
    var strong = h('strong', null, 'How the number is built: ');
    note.appendChild(strong);
    note.appendChild(document.createTextNode(
      'implied value = TVL x category multiple x growth x maturity x breadth. ' +
      'The multiple is the median market-cap-per-TVL of the protocols in the same category whose token already trades' +
      ' (' + model.global_multiple.toFixed(2) + ' across all of them when a category has fewer than ' + model.min_category_sample + ' traded tokens), ' +
      'and no multiple runs past the 90th percentile of all of them (' + model.multiple_cap.toFixed(2) + '), so one outlier cannot set the board. ' +
      'Growth moves the value by half the 7-day TVL change, maturity rewards a long run with no token, ' +
      'breadth rewards running on more chains. No name is special-cased: the same arithmetic scores every row.',
    ));
    var code = h('code', null, 'implied = tvl * multiple * growth * maturity * breadth');
    note.appendChild(code);
    return note;
  }

  function renderControls(onChange) {
    var bar = h('div', 'controls');
    var search = h('input');
    search.type = 'search';
    search.placeholder = 'Search name or slug…';
    search.value = state.q;
    search.setAttribute('aria-label', 'Search protocols');
    search.addEventListener('input', function () { state.q = search.value; onChange(); });
    bar.appendChild(search);

    var catLabel = h('label', null, 'Category');
    bar.appendChild(catLabel);
    var cat = h('select');
    cat.setAttribute('aria-label', 'Filter by category');
    var all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'All categories';
    cat.appendChild(all);
    categories.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c + ' (' + rows.filter(function (r) { return r.category === c; }).length + ')';
      cat.appendChild(opt);
    });
    cat.value = state.category;
    cat.addEventListener('change', function () { state.category = cat.value; onChange(); });
    bar.appendChild(cat);

    var watchLabel = h('label', null, '');
    var watch = h('input');
    watch.type = 'checkbox';
    watch.checked = state.watchlistOnly;
    watch.addEventListener('change', function () { state.watchlistOnly = watch.checked; onChange(); });
    watchLabel.appendChild(watch);
    watchLabel.appendChild(document.createTextNode(' Watchlist only'));
    bar.appendChild(watchLabel);

    var count = h('span', 'count', '');
    count.id = 'row-count';
    bar.appendChild(count);
    return bar;
  }

  function renderTabs(onChange) {
    var tabs = h('div', 'tabs');
    var pre = h('button', 'tab', 'Pre-token board (' + rows.length + ')');
    pre.setAttribute('aria-pressed', state.tab === 'pre-token' ? 'true' : 'false');
    pre.addEventListener('click', function () { state.tab = 'pre-token'; onChange(); });
    var liveTab = h('button', 'tab', 'Already live (' + live.length + ')');
    liveTab.setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
    liveTab.addEventListener('click', function () { state.tab = 'live'; onChange(); });
    tabs.appendChild(pre);
    tabs.appendChild(liveTab);
    return tabs;
  }

  var SORTABLE = [
    ['rank', 'Rank'],
    ['name', 'Protocol'],
    ['category', 'Category'],
    ['tvl_usd', 'TVL'],
    ['change_7d', '7d'],
    ['age_days', 'Age'],
    ['implied_value_usd', 'Implied value'],
  ];

  function renderTable(list) {
    var table = h('table', 'board');
    var head = h('thead');
    var headRow = h('tr');
    SORTABLE.forEach(function (pair) {
      var th = h('th', pair[0] === 'tvl_usd' || pair[0] === 'change_7d' || pair[0] === 'age_days' || pair[0] === 'implied_value_usd' ? 'num' : '', pair[1]);
      if (state.sortKey === pair[0]) th.textContent += state.sortDir === 1 ? ' ▲' : ' ▼';
      th.addEventListener('click', function () {
        if (state.sortKey === pair[0]) state.sortDir = -state.sortDir;
        else { state.sortKey = pair[0]; state.sortDir = pair[0] === 'name' || pair[0] === 'category' ? 1 : -1; }
        render();
      });
      headRow.appendChild(th);
    });
    headRow.appendChild(h('th', null, 'Chains'));
    head.appendChild(headRow);
    table.appendChild(head);

    var body = h('tbody');
    if (list.length === 0) {
      var empty = h('tr');
      var cell = h('td', 'empty', 'Nothing matches this filter. Clear the search or pick another category.');
      cell.colSpan = 8;
      empty.appendChild(cell);
      body.appendChild(empty);
    }
    list.forEach(function (r) {
      var tr = h('tr');
      if (state.selected === r.slug) tr.className = 'selected';
      tr.addEventListener('click', function () { openDetail(r.slug); });
      var rankCell = h('td');
      rankCell.appendChild(h('span', 'rank-badge', '#' + r.rank));
      tr.appendChild(rankCell);
      var nameCell = h('td');
      nameCell.appendChild(document.createTextNode(r.name));
      if (r.on_watchlist) nameCell.appendChild(h('span', 'watch-tag', 'WATCHLIST'));
      tr.appendChild(nameCell);
      tr.appendChild(h('td', null, r.category));
      tr.appendChild(h('td', 'num', money(r.tvl_usd)));
      var changeCell = h('td', 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), pct(r.change_7d));
      tr.appendChild(changeCell);
      tr.appendChild(h('td', 'num', ageText(r.age_days)));
      tr.appendChild(h('td', 'num implied', money(r.implied_value_usd)));
      tr.appendChild(h('td', 'chain-list', r.chains.slice(0, 3).join(', ')));
      body.appendChild(tr);
    });
    table.appendChild(body);
    return table;
  }

  function renderLiveStrip() {
    var strip = h('div', 'live-strip');
    strip.appendChild(h('h2', null, 'Already live — the contrast set'));
    strip.appendChild(h('p', null, 'The twelve largest tokens by market cap in the same snapshot. They are not ranked and never enter the board: they show what a launched token is worth per dollar of TVL, which is where the board\u2019s multiples come from.'));
    var table = h('table');
    var head = h('tr');
    ['Protocol', 'Category', 'Market cap', 'TVL', 'Mcap / TVL'].forEach(function (label, i) {
      head.appendChild(h('th', i >= 2 ? 'num' : '', label));
    });
    table.appendChild(head);
    live.forEach(function (r) {
      var tr = h('tr');
      tr.appendChild(h('td', null, r.name));
      tr.appendChild(h('td', null, r.category));
      tr.appendChild(h('td', 'num', money(r.mcap_usd)));
      tr.appendChild(h('td', 'num', money(r.tvl_usd)));
      tr.appendChild(h('td', 'num', 'x' + r.multiple.toFixed(2)));
      table.appendChild(tr);
    });
    strip.appendChild(table);
    return strip;
  }

  function renderFootnote() {
    var note = h('p', 'footnote',
      'Source: DefiLlama protocols snapshot of ' + DATA.as_of + ' (' + DATA.source + '). ' +
      '“Records no token” means the snapshot lists no token for the protocol; it is not proof the protocol has none. ' +
      'Implied values are this radar\u2019s own claim from the snapshot\u2019s figures, not a prediction that a token launches or what it would trade at. ' +
      'Farm plans state costs and times as ranges; check the protocol\u2019s own app before moving funds.');
    return note;
  }

  // ------------------------------------------------------------ the drawer

  function openDetail(slug) {
    var row = null;
    rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    drawer.hidden = false;
    drawer.innerHTML = '';

    var close = h('button', 'close', '← Back to the board');
    close.addEventListener('click', closeDetail);
    drawer.appendChild(close);
    drawer.appendChild(h('h2', null, row.name));
    drawer.appendChild(h('p', 'sub', '#' + row.rank + ' · ' + row.category + ' · ' + row.chains.join(', ') + (row.on_watchlist ? ' · on the snapshot watchlist' : '')));

    var factors = h('table', 'factors');
    var factorRows = [
      ['Implied launch value', moneyFull(row.implied_value_usd)],
      ['TVL', moneyFull(row.tvl_usd)],
      ['TVL change, 7 days', pct(row.change_7d)],
      ['Age with no token', ageText(row.age_days) + (row.listed_at ? ' (listed ' + row.listed_at + ')' : '')],
      ['Category multiple', 'x' + row.multiple.toFixed(3)],
      ['Growth factor', factorText(row.growth_factor)],
      ['Maturity factor', factorText(row.maturity_factor)],
      ['Breadth factor', factorText(row.breadth_factor)],
    ];
    factorRows.forEach(function (pair) {
      var tr = h('tr');
      tr.appendChild(h('td', null, pair[0]));
      tr.appendChild(h('td', null, pair[1]));
      factors.appendChild(tr);
    });
    drawer.appendChild(section('How the number is built', factors));

    var plan = h('ol', 'plan');
    row.farm_steps.forEach(function (step) {
      plan.appendChild(h('li', null, step));
    });
    drawer.appendChild(section('Farm plan — costs and times included', plan));

    var warn = h('p', 'warn', 'This protocol records no token, which is not proof it has none — and not a promise it ever launches one. The plan above is sized for a small position; never move money you cannot afford to lose, and never approve an unlimited allowance.');
    drawer.appendChild(warn);
    drawer.scrollTop = 0;
    render();
  }

  function closeDetail() {
    state.selected = null;
    drawer.hidden = true;
    drawer.innerHTML = '';
    render();
  }

  // -------------------------------------------------------------- the page

  function render() {
    app.innerHTML = '';
    app.setAttribute('aria-busy', 'false');
    app.appendChild(renderStats());
    app.appendChild(renderModelNote());
    var refresh = function () { render(); };
    app.appendChild(renderControls(refresh));
    app.appendChild(renderTabs(refresh));
    if (state.tab === 'live') {
      app.appendChild(renderLiveStrip());
    } else {
      var list = visibleRows();
      app.appendChild(renderTable(list));
      var count = document.getElementById('row-count');
      if (count) count.textContent = list.length + ' of ' + rows.length + ' protocols';
    }
    app.appendChild(renderFootnote());
  }

  // Deep links: #detail=<slug>, #filter=<category>, #q=<text>, #tab=<live|pre-token>.
  function applyHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    hash.split('&').forEach(function (part) {
      var eq = part.indexOf('=');
      if (eq === -1) return;
      var key = part.slice(0, eq);
      var value = decodeURIComponent(part.slice(eq + 1));
      if (key === 'detail') state.selected = value;
      if (key === 'filter' && categories.indexOf(value) !== -1) state.category = value;
      if (key === 'q') state.q = value;
      if (key === 'tab' && (value === 'live' || value === 'pre-token')) state.tab = value;
    });
  }

  applyHash();
  render();
  if (state.selected) openDetail(state.selected);
})();
