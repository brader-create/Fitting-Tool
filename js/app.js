/* ===== Brad's Handy Dandy Fitting Tool ===== */

(function () {
  'use strict';

  // ===== State =====
  let allModels    = [];
  let filteredModels = [];
  let selectedMain = null; // e.g. 'Cooktop'
  let selectedSub  = null; // e.g. 'Induction'

  // ===== Appliance type hierarchy =====
  // Keys are display names for main categories.
  // Values are subcategory labels — these are joined with ' - ' to match
  // the category strings in the data (e.g. 'Cooktop - Induction').
  const TYPE_HIERARCHY = {
    'Cooktop':    ['Electric', 'Gas', 'Induction'],
    'Rangetop':   ['Electric', 'Gas', 'Induction'],
    'Wall Oven':  ['Single', 'Double', 'Combination'],
    'Microwave':  ['Built-in', 'Trim Kit'],
  };

  // Colour thresholds (inches)
  // Green = within the user's tolerance slider (fits)
  // Orange = within 0.1" BEYOND the tolerance (very close, borderline)
  const ORANGE_BUFFER = 0.1;

  const STORAGE_KEY_THEME = 'fittingTool_theme';

  // ===== Helpers =====

  function parseInches(str) {
    if (!str || typeof str !== 'string') return null;
    let s = str.replace(/"/g, '').replace(/\(.*?\)/g, '').trim();
    if (s.includes('-')) s = s.split('-')[0].trim();
    s = s.replace(/[±\u00b1].*/, '').trim();
    const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
    const frac  = s.match(/^(\d+)\/(\d+)$/);
    if (frac)  return parseInt(frac[1]) / parseInt(frac[2]);
    const num   = s.match(/^[\d.]+$/);
    if (num)   return parseFloat(s);
    return null;
  }

  function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ===== Data Loading =====

  async function loadData() {
    try {
      const manifest = await fetch('data/manifest.json').then(r => r.json());
      let models = await fetch('data/' + manifest.basePack).then(r => r.json());

      for (const pack of (manifest.expansionPacks || [])) {
        try {
          const extra = await fetch('data/packs/' + pack).then(r => r.json());
          models = models.concat(extra);
        } catch (e) { console.warn('Pack load failed:', pack); }
      }

      // Deduplicate by id
      const seen = new Set();
      allModels = models.filter(m => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });

      initUI();
    } catch (e) {
      console.error('Failed to load data:', e);
      document.getElementById('modelGrid').innerHTML =
        '<p style="padding:40px;text-align:center;color:var(--text-muted)">Failed to load data. Serve from a web server (not file://).</p>';
    }
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
    mainContainer.innerHTML = Object.keys(TYPE_HIERARCHY).map(t =>
      `<button class="type-pill" data-main="${escHtml(t)}">${escHtml(t)}</button>`
    ).join('');

    mainContainer.addEventListener('click', e => {
      const pill = e.target.closest('.type-pill');
      if (!pill) return;
      const type = pill.dataset.main;
      if (selectedMain === type) {
        // Deselect → show all
        selectedMain = null;
        selectedSub  = null;
      } else {
        selectedMain = type;
        selectedSub  = null;
      }
      renderSubPills();
      applyFilters();
    });
  }

  function renderSubPills() {
    const mainContainer = document.getElementById('mainTypePills');
    const subContainer  = document.getElementById('subTypePills');

    // Update main pill states
    mainContainer.querySelectorAll('.type-pill').forEach(p => {
      p.classList.toggle('selected', p.dataset.main === selectedMain);
    });

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

    // Restore selected sub
    subContainer.querySelectorAll('.type-pill').forEach(p => {
      p.classList.toggle('selected', p.dataset.sub === selectedSub);
    });

    // Sub-pill click
    subContainer.onclick = null;
    subContainer.addEventListener('click', e => {
      const pill = e.target.closest('.type-pill');
      if (!pill) return;
      const sub = pill.dataset.sub;
      selectedSub = (selectedSub === sub) ? null : sub; // toggle
      subContainer.querySelectorAll('.type-pill').forEach(p => {
        p.classList.toggle('selected', p.dataset.sub === selectedSub);
      });
      applyFilters();
    });
  }

  // ===== Filter Chips =====

  function buildFilterChips() {
    const brands = [...new Set(allModels.map(m => m.brand))].sort();
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

    const installs = [...new Set(allModels.map(m => m.install))].sort();
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
      renderSubPills();
      applyFilters();
    });
  }

  // ===== Theme =====

  function loadTheme() {
    const saved = localStorage.getItem(STORAGE_KEY_THEME) || 'light';
    document.documentElement.setAttribute('data-theme', saved);
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_KEY_THEME, next);
  }

  // ===== Fit Classification =====
  // Green = diff ≤ tolerance            → fits
  // Orange = diff ≤ tolerance + 0.1"    → very close (borderline)
  // null  = diff > tolerance + 0.1"     → exclude from results

  function classifyFit(model, fw, fh, fd, tolerance) {
    const hasTarget = !isNaN(fw) || !isNaN(fh) || !isNaN(fd);
    if (!hasTarget) return 'none'; // no dims entered → no colour

    let maxDiff  = 0;
    let compared = 0;

    if (!isNaN(fw)) {
      const w = parseInches(model.cutoutWidth) ?? parseInches(model.width);
      if (w !== null) { maxDiff = Math.max(maxDiff, Math.abs(w - fw)); compared++; }
    }
    if (!isNaN(fh)) {
      const h = parseInches(model.cutoutHeight) ?? parseInches(model.height);
      if (h !== null) { maxDiff = Math.max(maxDiff, Math.abs(h - fh)); compared++; }
    }
    if (!isNaN(fd)) {
      const d = parseInches(model.cutoutDepth) ?? parseInches(model.depth);
      if (d !== null) { maxDiff = Math.max(maxDiff, Math.abs(d - fd)); compared++; }
    }

    if (compared === 0) return 'none';
    if (maxDiff > tolerance + ORANGE_BUFFER) return null;  // beyond orange band → hide
    if (maxDiff <= tolerance) return 'exact';               // green
    return 'close';                                         // orange (within 0.1" past tolerance)
  }

  // ===== Filter helpers =====

  function getSelectedChips(filterType) {
    return [...document.querySelectorAll(`.filter-chip[data-filter="${filterType}"].selected`)]
      .map(el => el.dataset.value);
  }

  // ===== Apply Filters =====

  function applyFilters() {
    let models = [...allModels];

    // Appliance type (main + optional sub)
    if (selectedMain) {
      if (selectedSub) {
        const target = (selectedMain + ' - ' + selectedSub).toLowerCase();
        models = models.filter(m => (m.category || '').toLowerCase() === target);
      } else {
        const prefix = selectedMain.toLowerCase();
        models = models.filter(m => (m.category || '').toLowerCase().startsWith(prefix));
      }
    }

    // Search
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    if (q) {
      models = models.filter(m =>
        m.id.toLowerCase().includes(q) ||
        m.brand.toLowerCase().includes(q) ||
        (m.category || '').toLowerCase().includes(q)
      );
    }

    // Additive filter chips
    const brands    = getSelectedChips('brand');
    const sizes     = getSelectedChips('nominalSize');
    const installs  = getSelectedChips('install');
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
    const tolerance  = parseFloat(document.getElementById('fitTolerance').value) || 0.5;
    const hasTarget  = !isNaN(fw) || !isNaN(fh) || !isNaN(fd);

    models = models.map(m => ({
      ...m,
      _fit: classifyFit(m, fw, fh, fd, tolerance),
    }));

    if (hasTarget) {
      models = models.filter(m => m._fit !== null);
    }

    // Sort
    const sortBy = document.getElementById('sortBy').value;
    if (sortBy === 'fit' && hasTarget) {
      const order = { exact: 0, close: 1, none: 2 };
      models.sort((a, b) => {
        const d = (order[a._fit] ?? 2) - (order[b._fit] ?? 2);
        return d !== 0 ? d : a.brand.toLowerCase() < b.brand.toLowerCase() ? -1 : 1;
      });
    } else {
      models.sort((a, b) => {
        switch (sortBy) {
          case 'brand':       return a.brand.toLowerCase() < b.brand.toLowerCase() ? -1 : 1;
          case 'model':       return a.id.toLowerCase() < b.id.toLowerCase() ? -1 : 1;
          case 'nominalSize': return (parseInt(a.nominalSize) || 0) - (parseInt(b.nominalSize) || 0);
          case 'width':       return (parseInches(a.cutoutWidth) || 0) - (parseInches(b.cutoutWidth) || 0);
          default:            return 0;
        }
      });
    }

    filteredModels = models;
    renderModels(fw, fh, fd, hasTarget);
  }

  // ===== Render =====

  function renderModels(fw, fh, fd, hasTarget) {
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
    fitLegend.style.display   = hasTarget ? 'flex' : 'none';

    // Stats
    document.getElementById('showingModels').textContent = filteredModels.length;
    document.getElementById('totalModels').textContent   = allModels.length;

    const confirmedCount = filteredModels.filter(m => m.confirmed).length;
    const pct = filteredModels.length > 0
      ? Math.round((confirmedCount / filteredModels.length) * 100)
      : 0;
    document.getElementById('confirmedBar').style.setProperty('--pct', pct + '%');
    document.getElementById('confirmedLabel').textContent =
      confirmedCount + ' of ' + filteredModels.length + ' confirmed (' + pct + '%)';

    const wMatch = hasTarget && !isNaN(fw);
    const hMatch = hasTarget && !isNaN(fh);
    const dMatch = hasTarget && !isNaN(fd);

    grid.innerHTML = filteredModels.map(m => {
      const fitClass  = m._fit === 'exact' ? 'fit-exact'
                      : m._fit === 'close' ? 'fit-close'
                      : '';
      const fitLabel  = m._fit === 'exact' ? '✓ Fits'
                      : m._fit === 'close' ? '≈ Very Close'
                      : '';
      const sizeLabel = m.nominalSize ? m.nominalSize + '"' : '';
      const trailUrl  = 'https://www.trailappliances.com/search.html?query=' + encodeURIComponent(m.id);

      const wVal = m.cutoutWidth  || '---';
      const hVal = m.cutoutHeight || '---';
      const dVal = m.cutoutDepth  || '---';

      return `
        <div class="model-card ${fitClass}">
          ${fitLabel ? `<div class="fit-strip">${fitLabel}</div>` : ''}
          <div class="card-top">
            <div>
              <div class="card-model">${escHtml(m.id)}</div>
              <div class="card-info">${escHtml(m.brand)}${m.category ? ' · ' + escHtml(m.category) : ''}</div>
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
              <span class="cutout-dim-val ${!m.cutoutWidth ? 'empty' : ''} ${wMatch && fitClass ? 'match' : ''}">${escHtml(wVal)}</span>
            </div>
            <div class="cutout-dim">
              <span class="cutout-dim-label">H</span>
              <span class="cutout-dim-val ${!m.cutoutHeight ? 'empty' : ''} ${hMatch && fitClass ? 'match' : ''}">${escHtml(hVal)}</span>
            </div>
            <div class="cutout-dim">
              <span class="cutout-dim-label">D</span>
              <span class="cutout-dim-val ${!m.cutoutDepth ? 'empty' : ''} ${dMatch && fitClass ? 'match' : ''}">${escHtml(dVal)}</span>
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
