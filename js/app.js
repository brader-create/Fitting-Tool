/* ===== Brad's Handy Dandy Fitting Tool ===== */

(function () {
  'use strict';

  // ===== State =====
  let allModels    = [];
  let filteredModels = [];
  let selectedMain = null;
  let selectedSub  = null;

  // ===== Appliance type hierarchy =====
  const TYPE_HIERARCHY = {
    'Cooktop':   ['Electric', 'Gas', 'Induction'],
    'Rangetop':  ['Electric', 'Gas', 'Induction'],
    'Wall Oven': ['Single', 'Double', 'Combination'],
    'Microwave': ['Built-in', 'Trim Kit'],
  };

  // Fit colour thresholds
  // Green = diff ≤ tolerance (fits within user's slider)
  // Orange = diff ≤ tolerance + 0.1" (borderline — very close)
  const ORANGE_BUFFER   = 0.1;
  const STORAGE_THEME   = 'fittingTool_theme';

  // ===== CSV column → model field mapping =====
  // Exact column names from the Google Sheet (normalised = lowercase, strip non-alphanumeric).
  // Fallback variants kept for resilience.
  const COL_MAP = {
    id:              ['model','modelnumber','modelno','id','sku'],
    brand:           ['brand','manufacturer','make'],
    category:        ['category','type','appliancetype','producttype'],
    subcategory:     ['subcategory','subcat','subtype','style','appliancestyle','subcategory'],
    active:          ['active','status','isactive','available'],
    confirmed:       ['confirmed','verified','checked'],
    nominalSize:     ['size','nominalsize','nominal'],
    width:           ['appwidth','appliancewidth','unitwidth','width'],
    height:          ['appheight','applianceheight','unitheight','height'],
    depth:           ['appdepth','appliancedepth','unitdepth','depth'],
    install:         ['install','installtype','installation'],
    cutoutWidthMin:  ['minwidth','cutoutwidthmin','minimumwidth','minw','cowidthmin','minwidthcutout'],
    cutoutWidthMax:  ['maxwidth','cutoutwidthmax','maximumwidth','maxw','cowidthmax','maxwidthcutout'],
    cutoutHeightMin: ['minheight','cutoutheightmin','minimumheight','minh','coheightmin'],
    cutoutHeightMax: ['maxheight','cutoutheightmax','maximumheight','maxh','coheightmax'],
    cutoutDepthMin:  ['mindepth','cutoutdepthmin','minimumdepth','mind','codepthmin'],
    cutoutDepthMax:  ['maxdepth','cutoutdepthmax','maximumdepth','maxd','codepthmax'],
    installNote:     ['note','notes','installnote','installationnote','comments'],
    trim:            ['trim','trimtype','trimstyle'],
    color:           ['color','colour','finish'],
  };

  // ===== Helpers =====

  function parseInches(str) {
    if (!str || typeof str !== 'string') return null;
    let s = str.replace(/"/g, '').replace(/\(.*?\)/g, '').trim();
    if (s.includes(' - ') || (s.includes('-') && !s.match(/^\d+-\d+\/\d+$/))) {
      s = s.split(/\s*-\s*/)[0].trim();
    }
    s = s.replace(/[±\u00b1].*/, '').trim();
    const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
    const frac  = s.match(/^(\d+)\/(\d+)$/);
    if (frac)  return parseInt(frac[1]) / parseInt(frac[2]);
    const num   = s.match(/^[\d.]+$/);
    if (num)   return parseFloat(s);
    return null;
  }

  function norm(s) {
    return (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /** Build a display string from a min/max pair. */
  function fmtRange(min, max) {
    if (!min && !max) return '';
    if (!min) return max;
    if (!max || min === max) return min;
    return min + ' – ' + max;
  }

  /**
   * Given a model's cutout range [minVal, maxVal] and a target,
   * return how far outside the acceptable range the target falls.
   * 0 = within range (perfect fit).
   */
  function rangeDiff(minStr, maxStr, target) {
    const lo = parseInches(minStr);
    const hi = parseInches(maxStr);
    if (lo === null && hi === null) return null; // no spec data
    const lower = lo !== null ? lo : hi;
    const upper = hi !== null ? hi : lo;
    if (target < lower) return lower - target;
    if (target > upper) return target - upper;
    return 0;
  }

  function isTruthy(val) {
    if (!val) return false;
    const s = val.toString().trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === '1' || s === 'y';
  }

  // ===== CSV Parsing =====

  function parseCSVRow(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (line[i] === ',' && !inQ) {
        result.push(cur); cur = '';
      } else {
        cur += line[i];
      }
    }
    result.push(cur);
    return result;
  }

  function parseCSV(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
    if (lines.length < 2) return [];

    const rawHeaders = parseCSVRow(lines[0]);
    const normHeaders = rawHeaders.map(h => norm(h));

    // Build index: for each model field, which CSV column index to use
    const fieldIndex = {};
    for (const [field, candidates] of Object.entries(COL_MAP)) {
      for (const candidate of candidates) {
        const idx = normHeaders.indexOf(candidate);
        if (idx !== -1) { fieldIndex[field] = idx; break; }
      }
    }

    console.log('[FittingTool] CSV column mapping:', fieldIndex);
    console.log('[FittingTool] Raw CSV headers:', rawHeaders);

    const models = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const vals = parseCSVRow(line);

      const get = field => {
        const idx = fieldIndex[field];
        return idx !== undefined ? (vals[idx] || '').trim() : '';
      };

      const id = get('id');
      if (!id) continue; // skip rows with no model number

      const active      = get('active');
      const confirmed   = get('confirmed');
      const category    = get('category');
      const subcategory = get('subcategory');

      // Cutout min/max — build display range strings
      const cwMin = get('cutoutWidthMin');
      const cwMax = get('cutoutWidthMax');
      const chMin = get('cutoutHeightMin');
      const chMax = get('cutoutHeightMax');
      const cdMin = get('cutoutDepthMin');
      const cdMax = get('cutoutDepthMax');

      models.push({
        id,
        brand:           get('brand'),
        category,                          // e.g. "Cooktop"
        subcategory,                       // e.g. "Induction" or "Induction - Downdraft"
        fullCategory:    subcategory ? category + ' - ' + subcategory : category,
        active:          active === '' ? true : !['false','no','discontinued','0','n'].includes(active.toLowerCase()),
        confirmed:       isTruthy(confirmed),
        nominalSize:     get('nominalSize'),
        width:           get('width'),
        height:          get('height'),
        depth:           get('depth'),
        builtIn:         true,
        install:         get('install'),
        // Raw min/max for fit calculation
        cutoutWidthMin:  cwMin,
        cutoutWidthMax:  cwMax,
        cutoutHeightMin: chMin,
        cutoutHeightMax: chMax,
        cutoutDepthMin:  cdMin,
        cutoutDepthMax:  cdMax,
        // Display strings (range if min ≠ max)
        cutoutWidth:     fmtRange(cwMin, cwMax),
        cutoutHeight:    fmtRange(chMin, chMax),
        cutoutDepth:     fmtRange(cdMin, cdMax),
        installNote:     get('installNote'),
        trim:            get('trim'),
        color:           get('color'),
      });
    }

    return models;
  }

  // ===== Data Loading =====

  async function loadData() {
    const notice  = document.getElementById('dataNotice');
    const loading = document.getElementById('loadingState');

    try {
      const manifest = await fetch('data/manifest.json').then(r => r.json());

      // Try Google Sheet CSV first
      if (manifest.sheetCsvUrl) {
        try {
          const csvText = await fetch(manifest.sheetCsvUrl).then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          });
          const models = parseCSV(csvText);
          if (models.length > 0) {
            allModels = dedup(models);
            console.log('[FittingTool] Loaded', allModels.length, 'models from Google Sheet');
            loading.style.display = 'none';
            initUI();
            return;
          }
          throw new Error('Sheet returned 0 models');
        } catch (sheetErr) {
          console.warn('[FittingTool] Sheet load failed, falling back to local JSON:', sheetErr.message);
          notice.textContent = '⚠ Could not load live data from Google Sheet — showing cached local data.';
          notice.style.display = 'block';
        }
      }

      // Fallback: local JSON
      let models = await fetch('data/' + manifest.basePack).then(r => r.json());
      for (const pack of (manifest.expansionPacks || [])) {
        try {
          const extra = await fetch('data/packs/' + pack).then(r => r.json());
          models = models.concat(extra);
        } catch (e) { console.warn('Pack failed:', pack); }
      }
      allModels = dedup(models);
      console.log('[FittingTool] Loaded', allModels.length, 'models from local JSON');

    } catch (e) {
      console.error('Data load failed:', e);
      document.getElementById('modelGrid').innerHTML =
        '<p style="padding:40px;text-align:center;color:var(--text-muted)">Failed to load data. Serve from a web server (not file://).</p>';
    }

    loading.style.display = 'none';
    initUI();
  }

  function dedup(models) {
    const seen = new Set();
    return models.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }

  // ===== Init =====

  function initUI() {
    buildTypePills();
    buildFilterChips();
    attachListeners();
    loadTheme();
    applyFilters();
  }

  // ===== Type Selector =====

  function buildTypePills() {
    const mainContainer = document.getElementById('mainTypePills');
    const subContainer  = document.getElementById('subTypePills');

    mainContainer.innerHTML = Object.keys(TYPE_HIERARCHY).map(t =>
      `<button class="type-pill" data-main="${escHtml(t)}">${escHtml(t)}</button>`
    ).join('');

    // Main pill clicks
    mainContainer.addEventListener('click', e => {
      const pill = e.target.closest('.type-pill');
      if (!pill) return;
      const type = pill.dataset.main;
      if (selectedMain === type) {
        selectedMain = null;
        selectedSub  = null;
      } else {
        selectedMain = type;
        selectedSub  = null;
      }
      syncTypePillUI();
      applyFilters();
    });

    // Sub pill clicks — listener set ONCE here, never re-added
    subContainer.addEventListener('click', e => {
      const pill = e.target.closest('.type-pill');
      if (!pill || !pill.dataset.sub) return;
      const sub = pill.dataset.sub;
      selectedSub = (selectedSub === sub) ? null : sub;
      subContainer.querySelectorAll('.type-pill').forEach(p =>
        p.classList.toggle('selected', p.dataset.sub === selectedSub));
      applyFilters();
    });
  }

  /** Update pill classes and sub-pill visibility without re-adding listeners. */
  function syncTypePillUI() {
    const mainContainer = document.getElementById('mainTypePills');
    const subContainer  = document.getElementById('subTypePills');

    mainContainer.querySelectorAll('.type-pill').forEach(p =>
      p.classList.toggle('selected', p.dataset.main === selectedMain));

    if (!selectedMain) {
      subContainer.style.display = 'none';
      subContainer.innerHTML = '';
      return;
    }

    const subs = TYPE_HIERARCHY[selectedMain] || [];
    subContainer.innerHTML = subs.map(s =>
      `<button class="type-pill" data-sub="${escHtml(s)}">${escHtml(s)}</button>`
    ).join('');
    subContainer.style.display = subs.length ? 'flex' : 'none';

    // Restore sub selection visual
    subContainer.querySelectorAll('.type-pill').forEach(p =>
      p.classList.toggle('selected', p.dataset.sub === selectedSub));
  }

  // ===== Filter Chips =====

  function buildFilterChips() {
    const brands = [...new Set(allModels.map(m => m.brand).filter(Boolean))].sort();
    document.getElementById('brandFilters').innerHTML = brands.map(b => {
      const n = allModels.filter(m => m.brand === b).length;
      return `<button class="filter-chip" data-filter="brand" data-value="${escHtml(b)}">${escHtml(b)} <span class="count">(${n})</span></button>`;
    }).join('');

    const sizes = [...new Set(allModels.map(m => m.nominalSize).filter(Boolean))]
      .sort((a, b) => parseInt(a) - parseInt(b));
    document.getElementById('nominalSizeFilters').innerHTML = sizes.map(s => {
      const n = allModels.filter(m => m.nominalSize === s).length;
      return `<button class="filter-chip" data-filter="nominalSize" data-value="${escHtml(s)}">${escHtml(s)}" <span class="count">(${n})</span></button>`;
    }).join('');

    const installs = [...new Set(allModels.map(m => m.install).filter(Boolean))].sort();
    document.getElementById('installFilters').innerHTML = installs.map(i => {
      const n = allModels.filter(m => m.install === i).length;
      return `<button class="filter-chip" data-filter="install" data-value="${escHtml(i)}">${escHtml(i)} <span class="count">(${n})</span></button>`;
    }).join('');

    ['brandFilters', 'nominalSizeFilters', 'installFilters'].forEach(id => {
      document.getElementById(id).addEventListener('click', e => {
        const chip = e.target.closest('.filter-chip');
        if (chip) { chip.classList.toggle('selected'); applyFilters(); }
      });
    });
  }

  // ===== Listeners =====

  function attachListeners() {
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('searchInput').addEventListener('input', applyFilters);

    ['filterWidth', 'filterHeight', 'filterDepth'].forEach(id =>
      document.getElementById(id).addEventListener('input', applyFilters));

    const tolSlider = document.getElementById('fitTolerance');
    const tolVal    = document.getElementById('fitToleranceVal');
    tolSlider.addEventListener('input', () => {
      tolVal.textContent = '± ' + tolSlider.value + '"';
      applyFilters();
    });

    document.getElementById('filterActive').addEventListener('change', applyFilters);
    document.getElementById('sortBy').addEventListener('change', applyFilters);

    // Filters panel toggle
    document.getElementById('filtersToggleBtn').addEventListener('click', () => {
      const panel   = document.getElementById('filtersPanel');
      const btn     = document.getElementById('filtersToggleBtn');
      const opening = panel.style.display === 'none';
      panel.style.display = opening ? 'block' : 'none';
      btn.classList.toggle('btn-primary',   opening);
      btn.classList.toggle('btn-secondary', !opening);
    });

    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
      document.querySelectorAll('.filter-chip.selected').forEach(c => c.classList.remove('selected'));
      document.getElementById('searchInput').value  = '';
      document.getElementById('filterWidth').value  = '';
      document.getElementById('filterHeight').value = '';
      document.getElementById('filterDepth').value  = '';
      selectedMain = null;
      selectedSub  = null;
      syncTypePillUI();
      applyFilters();
    });

    // Fraction converter
    const panel   = document.getElementById('converterPanel');
    const overlay = document.getElementById('converterOverlay');
    const open    = () => { panel.classList.add('open'); overlay.classList.add('open'); };
    const close   = () => { panel.classList.remove('open'); overlay.classList.remove('open'); };
    document.getElementById('converterBtn').addEventListener('click', open);
    document.getElementById('converterClose').addEventListener('click', close);
    overlay.addEventListener('click', close);

    // Live fraction → decimal converter
    document.getElementById('converterInput').addEventListener('input', function () {
      const result = document.getElementById('converterResult');
      const val = parseInches(this.value);
      if (val !== null) {
        result.className = 'converter-result';
        result.textContent = val.toFixed(4).replace(/\.?0+$/, '') + '"  =  ' + val + '"';
      } else {
        result.className = 'converter-result empty';
        result.textContent = this.value ? 'Cannot parse — try e.g. 34 3/4' : '';
      }
    });
  }

  // ===== Theme =====

  function loadTheme() {
    const saved = localStorage.getItem(STORAGE_THEME) || 'light';
    document.documentElement.setAttribute('data-theme', saved);
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_THEME, next);
  }

  // ===== Fit Classification =====

  function classifyFit(model, fw, fh, fd, tolerance) {
    const hasTarget = !isNaN(fw) || !isNaN(fh) || !isNaN(fd);
    if (!hasTarget) return 'none';

    let maxDiff = 0, compared = 0;

    if (!isNaN(fw)) {
      // Prefer min/max range fields (CSV); fall back to single value (JSON)
      const d = (model.cutoutWidthMin || model.cutoutWidthMax)
        ? rangeDiff(model.cutoutWidthMin, model.cutoutWidthMax, fw)
        : (() => { const w = parseInches(model.cutoutWidth) ?? parseInches(model.width); return w !== null ? Math.abs(w - fw) : null; })();
      if (d !== null) { maxDiff = Math.max(maxDiff, d); compared++; }
    }
    if (!isNaN(fh)) {
      const d = (model.cutoutHeightMin || model.cutoutHeightMax)
        ? rangeDiff(model.cutoutHeightMin, model.cutoutHeightMax, fh)
        : (() => { const h = parseInches(model.cutoutHeight) ?? parseInches(model.height); return h !== null ? Math.abs(h - fh) : null; })();
      if (d !== null) { maxDiff = Math.max(maxDiff, d); compared++; }
    }
    if (!isNaN(fd)) {
      const d = (model.cutoutDepthMin || model.cutoutDepthMax)
        ? rangeDiff(model.cutoutDepthMin, model.cutoutDepthMax, fd)
        : (() => { const dep = parseInches(model.cutoutDepth) ?? parseInches(model.depth); return dep !== null ? Math.abs(dep - fd) : null; })();
      if (d !== null) { maxDiff = Math.max(maxDiff, d); compared++; }
    }

    if (compared === 0) return 'none';
    if (maxDiff > tolerance + ORANGE_BUFFER) return null;  // hide
    if (maxDiff <= tolerance)                return 'exact'; // green
    return 'close';                                          // orange
  }

  // ===== Filters =====

  function getSelected(filterType) {
    return [...document.querySelectorAll(`.filter-chip[data-filter="${filterType}"].selected`)]
      .map(el => el.dataset.value);
  }

  function applyFilters() {
    let models = [...allModels];

    // Appliance type
    if (selectedMain) {
      const mainNorm = norm(selectedMain);
      models = models.filter(m => {
        // CSV models: category field is just the main type (e.g. "Cooktop")
        // JSON fallback: category is combined (e.g. "Cooktop - Induction")
        const cat = norm(m.category || '');
        const mainMatch = m.subcategory !== undefined
          ? cat === mainNorm                          // CSV: exact match
          : cat === mainNorm || cat.startsWith(mainNorm + '-') || cat.startsWith(mainNorm + ' ');
        if (!mainMatch) return false;

        if (selectedSub) {
          const subNorm = norm(selectedSub);
          // CSV: model.subcategory e.g. "Induction" or "Induction - Downdraft"
          if (m.subcategory !== undefined) {
            return norm(m.subcategory).startsWith(subNorm);
          }
          // JSON fallback: check part after " - "
          const parts = (m.category || '').split(' - ');
          const modelSub = parts.slice(1).join(' - ');
          return norm(modelSub).startsWith(subNorm);
        }
        return true;
      });
    }

    // Search
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    if (q) {
      models = models.filter(m =>
        m.id.toLowerCase().includes(q) ||
        (m.brand || '').toLowerCase().includes(q) ||
        (m.category || '').toLowerCase().includes(q)
      );
    }

    // Additive filter chips
    const brands   = getSelected('brand');
    const sizes    = getSelected('nominalSize');
    const installs = getSelected('install');
    if (brands.length)   models = models.filter(m => brands.includes(m.brand));
    if (sizes.length)    models = models.filter(m => sizes.includes(m.nominalSize));
    if (installs.length) models = models.filter(m => installs.includes(m.install));

    // Active only
    if (document.getElementById('filterActive').checked) {
      models = models.filter(m => m.active !== false);
    }

    // Dimension targets
    const fw = parseFloat(document.getElementById('filterWidth').value);
    const fh = parseFloat(document.getElementById('filterHeight').value);
    const fd = parseFloat(document.getElementById('filterDepth').value);
    const tolerance = parseFloat(document.getElementById('fitTolerance').value) || 0.5;
    const hasTarget = !isNaN(fw) || !isNaN(fh) || !isNaN(fd);

    // Exact search match (gold)
    const exactSearch = q.length > 0;

    models = models.map(m => ({
      ...m,
      _fit:         classifyFit(m, fw, fh, fd, tolerance),
      _searchExact: exactSearch && m.id.toLowerCase() === q,
    }));

    // If dimensions entered, hide models beyond tolerance+buffer
    if (hasTarget) {
      models = models.filter(m => m._fit !== null);
    }

    // Sort
    const sortBy = document.getElementById('sortBy').value;
    const fitOrder = { exact: 1, close: 2, none: 3 };

    models.sort((a, b) => {
      // Gold (exact search match) always first
      if (a._searchExact !== b._searchExact) return a._searchExact ? -1 : 1;
      // Then by fit when dimensions provided
      if (hasTarget && sortBy === 'fit') {
        const diff = (fitOrder[a._fit] ?? 3) - (fitOrder[b._fit] ?? 3);
        if (diff !== 0) return diff;
      }
      // Then by chosen sort field
      switch (sortBy) {
        case 'brand':       return (a.brand || '').toLowerCase() < (b.brand || '').toLowerCase() ? -1 : 1;
        case 'model':       return a.id.toLowerCase() < b.id.toLowerCase() ? -1 : 1;
        case 'nominalSize': return (parseInt(a.nominalSize) || 0) - (parseInt(b.nominalSize) || 0);
        case 'width':       return (parseInches(a.cutoutWidth) || 0) - (parseInches(b.cutoutWidth) || 0);
        default: {
          if (hasTarget) {
            const diff = (fitOrder[a._fit] ?? 3) - (fitOrder[b._fit] ?? 3);
            if (diff !== 0) return diff;
          }
          return (a.brand || '').toLowerCase() < (b.brand || '').toLowerCase() ? -1 : 1;
        }
      }
    });

    filteredModels = models;
    renderModels(fw, fh, fd, hasTarget, exactSearch);
  }

  // ===== Render =====

  function renderModels(fw, fh, fd, hasTarget, hasSearch) {
    const grid        = document.getElementById('modelGrid');
    const noResults   = document.getElementById('noResults');
    const resultsMeta = document.getElementById('resultsMeta');
    const fitLegend   = document.getElementById('fitLegend');

    if (filteredModels.length === 0) {
      grid.innerHTML = '';
      noResults.style.display  = 'flex';
      resultsMeta.style.display = 'none';
      return;
    }

    noResults.style.display   = 'none';
    resultsMeta.style.display = 'flex';
    fitLegend.style.display   = (hasTarget || hasSearch) ? 'flex' : 'none';

    document.getElementById('showingModels').textContent = filteredModels.length;
    document.getElementById('totalModels').textContent   = allModels.length;

    const confirmedCount = filteredModels.filter(m => m.confirmed).length;
    const pct = filteredModels.length > 0
      ? Math.round((confirmedCount / filteredModels.length) * 100) : 0;
    document.getElementById('confirmedBar').style.setProperty('--pct', pct + '%');
    document.getElementById('confirmedLabel').textContent =
      confirmedCount + ' of ' + filteredModels.length + ' confirmed (' + pct + '%)';

    const wMatch = hasTarget && !isNaN(fw);
    const hMatch = hasTarget && !isNaN(fh);
    const dMatch = hasTarget && !isNaN(fd);

    grid.innerHTML = filteredModels.map(m => {
      const fitClass = m._searchExact      ? 'fit-search'
                     : m._fit === 'exact'  ? 'fit-exact'
                     : m._fit === 'close'  ? 'fit-close'
                     : '';
      const fitLabel = m._searchExact      ? '★ Exact Match'
                     : m._fit === 'exact'  ? '✓ Fits'
                     : m._fit === 'close'  ? '≈ Very Close'
                     : '';
      const sizeLabel = m.nominalSize ? m.nominalSize + '"' : '';
      const trailUrl  = 'https://www.trailappliances.com/search.html?query=' + encodeURIComponent(m.id);

      return `
        <div class="model-card ${fitClass}">
          ${fitLabel ? `<div class="fit-strip">${fitLabel}</div>` : ''}
          <div class="card-top">
            <div>
              <div class="card-model">${escHtml(m.id)}</div>
              <div class="card-info">${escHtml(m.brand || '')}${(m.fullCategory || m.category) ? ' · ' + escHtml(m.fullCategory || m.category) : ''}</div>
            </div>
            <div class="card-badges">
              ${sizeLabel ? `<span class="badge badge-size">${sizeLabel}</span>` : ''}
              ${m.confirmed
                ? '<span class="badge badge-confirmed">✓ Confirmed</span>'
                : '<span class="badge badge-unconfirmed">Unconfirmed</span>'}
              ${m.active === false ? '<span class="badge badge-discontinued">Discontinued</span>' : ''}
            </div>
          </div>
          <div class="card-cutout">
            <div class="cutout-dim">
              <span class="cutout-dim-label">W</span>
              <span class="cutout-dim-val ${!m.cutoutWidth ? 'empty' : ''} ${wMatch && fitClass ? 'match' : ''}">${escHtml(m.cutoutWidth || '---')}</span>
            </div>
            <div class="cutout-dim">
              <span class="cutout-dim-label">H</span>
              <span class="cutout-dim-val ${!m.cutoutHeight ? 'empty' : ''} ${hMatch && fitClass ? 'match' : ''}">${escHtml(m.cutoutHeight || '---')}</span>
            </div>
            <div class="cutout-dim">
              <span class="cutout-dim-label">D</span>
              <span class="cutout-dim-val ${!m.cutoutDepth ? 'empty' : ''} ${dMatch && fitClass ? 'match' : ''}">${escHtml(m.cutoutDepth || '---')}</span>
            </div>
          </div>
          ${m.installNote ? `<div class="card-note">${escHtml(m.installNote)}</div>` : ''}
          <a href="${trailUrl}" target="_blank" rel="noopener" class="btn-trail">
            Trail
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
          </a>
        </div>
      `;
    }).join('');
  }

  // ===== Boot =====
  loadData();

})();
