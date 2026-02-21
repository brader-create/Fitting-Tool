/* ===== Brad's Handy Dandy Fitting Tool ===== */

(function () {
  'use strict';

  // ===== State =====
  let allModels = [];
  let filteredModels = [];
  let selectedType = null; // currently selected appliance type (category)

  const STORAGE_KEYS = {
    theme: 'fittingTool_theme',
  };

  // Fit thresholds (inches) — tight
  const FIT_EXACT  = 0.25;  // green  — essentially a match
  const FIT_CLOSE  = 0.75;  // orange — very close, likely fits with minor adjustment

  // ===== Helpers =====

  function parseInches(str) {
    if (!str || typeof str !== 'string') return null;
    let s = str.replace(/"/g, '').replace(/\(.*?\)/g, '').trim();
    if (s.includes('-')) s = s.split('-')[0].trim();
    s = s.replace(/[±\u00b1].*/, '').trim();
    const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
    const frac = s.match(/^(\d+)\/(\d+)$/);
    if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
    const num = s.match(/^[\d.]+$/);
    if (num) return parseFloat(s);
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
      const manifestRes = await fetch('data/manifest.json');
      const manifest = await manifestRes.json();

      const baseRes = await fetch('data/' + manifest.basePack);
      let models = await baseRes.json();

      for (const pack of (manifest.expansionPacks || [])) {
        try {
          const packRes = await fetch('data/packs/' + pack);
          models = models.concat(await packRes.json());
        } catch (e) {
          console.warn('Failed to load pack:', pack, e);
        }
      }

      // Deduplicate
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

  // ===== UI Init =====

  function initUI() {
    buildTypePills();
    buildFilterChips();
    attachEventListeners();
    loadTheme();
    applyFilters();
  }

  /** Build the appliance-type pill row from unique categories in the data. */
  function buildTypePills() {
    const types = [...new Set(allModels.map(m => m.category).filter(Boolean))].sort();
    const container = document.getElementById('typePills');
    container.innerHTML = types.map(t =>
      `<button class="type-pill" data-type="${escHtml(t)}">${escHtml(t)}</button>`
    ).join('');

    container.addEventListener('click', e => {
      const pill = e.target.closest('.type-pill');
      if (!pill) return;
      const type = pill.dataset.type;
      if (selectedType === type) {
        // Clicking the same pill deselects it → show all
        selectedType = null;
        pill.classList.remove('selected');
      } else {
        selectedType = type;
        container.querySelectorAll('.type-pill').forEach(p => p.classList.remove('selected'));
        pill.classList.add('selected');
      }
      applyFilters();
    });
  }

  /**
   * Filter chips — additive behaviour:
   *   none selected → no filter applied (show all)
   *   one or more selected → show only those values
   * Chips start with no 'selected' class.
   */
  function buildFilterChips() {
    const brands = [...new Set(allModels.map(m => m.brand))].sort();
    document.getElementById('brandFilters').innerHTML = brands.map(b => {
      const count = allModels.filter(m => m.brand === b).length;
      return `<button class="filter-chip" data-filter="brand" data-value="${escHtml(b)}">${escHtml(b)} <span class="count">(${count})</span></button>`;
    }).join('');

    const sizes = [...new Set(allModels.map(m => m.nominalSize).filter(Boolean))]
      .sort((a, b) => parseInt(a) - parseInt(b));
    document.getElementById('nominalSizeFilters').innerHTML = sizes.map(s => {
      const count = allModels.filter(m => m.nominalSize === s).length;
      return `<button class="filter-chip" data-filter="nominalSize" data-value="${escHtml(s)}">${escHtml(s)}" <span class="count">(${count})</span></button>`;
    }).join('');

    const installs = [...new Set(allModels.map(m => m.install))].sort();
    document.getElementById('installFilters').innerHTML = installs.map(i => {
      const count = allModels.filter(m => m.install === i).length;
      return `<button class="filter-chip" data-filter="install" data-value="${escHtml(i)}">${escHtml(i)} <span class="count">(${count})</span></button>`;
    }).join('');

    // Delegate chip clicks
    ['brandFilters', 'nominalSizeFilters', 'installFilters'].forEach(id => {
      document.getElementById(id).addEventListener('click', e => {
        const chip = e.target.closest('.filter-chip');
        if (!chip) return;
        chip.classList.toggle('selected');
        applyFilters();
      });
    });
  }

  // ===== Event Listeners =====

  function attachEventListeners() {
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    document.getElementById('searchInput').addEventListener('input', applyFilters);

    ['filterWidth', 'filterHeight', 'filterDepth'].forEach(id => {
      document.getElementById(id).addEventListener('input', applyFilters);
    });

    const tolSlider = document.getElementById('fitTolerance');
    const tolVal = document.getElementById('fitToleranceVal');
    tolSlider.addEventListener('input', () => {
      tolVal.textContent = '± ' + tolSlider.value + '"';
      applyFilters();
    });

    document.getElementById('filterActive').addEventListener('change', applyFilters);

    document.getElementById('sortBy').addEventListener('change', applyFilters);

    // Filters panel toggle
    document.getElementById('filtersToggleBtn').addEventListener('click', () => {
      const panel = document.getElementById('filtersPanel');
      const btn = document.getElementById('filtersToggleBtn');
      const opening = panel.style.display === 'none';
      panel.style.display = opening ? 'block' : 'none';
      btn.classList.toggle('btn-primary', opening);
      btn.classList.toggle('btn-secondary', !opening);
    });

    // Clear all filters
    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
      document.querySelectorAll('.filter-chip.selected').forEach(c => c.classList.remove('selected'));
      document.getElementById('searchInput').value = '';
      document.getElementById('filterWidth').value = '';
      document.getElementById('filterHeight').value = '';
      document.getElementById('filterDepth').value = '';
      selectedType = null;
      document.querySelectorAll('.type-pill.selected').forEach(p => p.classList.remove('selected'));
      applyFilters();
    });
  }

  // ===== Theme =====

  function loadTheme() {
    const saved = localStorage.getItem(STORAGE_KEYS.theme) || 'light';
    document.documentElement.setAttribute('data-theme', saved);
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_KEYS.theme, next);
  }

  // ===== Fit Classification =====

  /**
   * Given a model and target dimensions (may be NaN if not entered),
   * returns 'exact' | 'close' | 'near' | null.
   * null means the model is outside the user's chosen tolerance.
   */
  function classifyFit(model, targetW, targetH, targetD, tolerance) {
    const hasTarget = !isNaN(targetW) || !isNaN(targetH) || !isNaN(targetD);
    if (!hasTarget) return 'none'; // no dimensions entered — no colour classification

    let maxDiff = 0;
    let compared = 0;

    if (!isNaN(targetW)) {
      const w = parseInches(model.cutoutWidth) ?? parseInches(model.width);
      if (w !== null) { maxDiff = Math.max(maxDiff, Math.abs(w - targetW)); compared++; }
    }
    if (!isNaN(targetH)) {
      const h = parseInches(model.cutoutHeight) ?? parseInches(model.height);
      if (h !== null) { maxDiff = Math.max(maxDiff, Math.abs(h - targetH)); compared++; }
    }
    if (!isNaN(targetD)) {
      const d = parseInches(model.cutoutDepth) ?? parseInches(model.depth);
      if (d !== null) { maxDiff = Math.max(maxDiff, Math.abs(d - targetD)); compared++; }
    }

    if (compared === 0) return 'none';            // no parseable spec data
    if (maxDiff > tolerance) return null;          // beyond tolerance → exclude
    if (maxDiff <= FIT_EXACT) return 'exact';
    if (maxDiff <= FIT_CLOSE) return 'close';
    return 'near';
  }

  // ===== Filtering =====

  function getSelectedChips(filterType) {
    return [...document.querySelectorAll(`.filter-chip[data-filter="${filterType}"].selected`)]
      .map(el => el.dataset.value);
  }

  function applyFilters() {
    let models = [...allModels];

    // Appliance type (single-select)
    if (selectedType) {
      models = models.filter(m => m.category === selectedType);
    }

    // Search
    const search = document.getElementById('searchInput').value.trim().toLowerCase();
    if (search) {
      models = models.filter(m =>
        m.id.toLowerCase().includes(search) ||
        m.brand.toLowerCase().includes(search) ||
        (m.category || '').toLowerCase().includes(search)
      );
    }

    // Additive filter chips — only filter if at least one chip selected
    const brands = getSelectedChips('brand');
    if (brands.length) models = models.filter(m => brands.includes(m.brand));

    const sizes = getSelectedChips('nominalSize');
    if (sizes.length) models = models.filter(m => sizes.includes(m.nominalSize));

    const installs = getSelectedChips('install');
    if (installs.length) models = models.filter(m => installs.includes(m.install));

    // Active only
    if (document.getElementById('filterActive').checked) {
      models = models.filter(m => m.active !== false);
    }

    // Dimension inputs
    const fw = parseFloat(document.getElementById('filterWidth').value);
    const fh = parseFloat(document.getElementById('filterHeight').value);
    const fd = parseFloat(document.getElementById('filterDepth').value);
    const tolerance = parseFloat(document.getElementById('fitTolerance').value) || 0.5;
    const hasTarget = !isNaN(fw) || !isNaN(fh) || !isNaN(fd);

    // Classify fit and filter out models beyond tolerance when dimensions are entered
    models = models.map(m => ({
      ...m,
      _fitClass: classifyFit(m, fw, fh, fd, tolerance),
    }));

    if (hasTarget) {
      models = models.filter(m => m._fitClass !== null);
    }

    // Sort
    const sortBy = document.getElementById('sortBy').value;
    if (sortBy === 'fit' && hasTarget) {
      const order = { exact: 0, close: 1, near: 2, none: 3 };
      models.sort((a, b) => {
        const diff = (order[a._fitClass] ?? 3) - (order[b._fitClass] ?? 3);
        if (diff !== 0) return diff;
        return a.brand.toLowerCase() < b.brand.toLowerCase() ? -1 : 1;
      });
    } else {
      models.sort((a, b) => {
        switch (sortBy) {
          case 'brand':      return a.brand.toLowerCase() < b.brand.toLowerCase() ? -1 : 1;
          case 'model':      return a.id.toLowerCase() < b.id.toLowerCase() ? -1 : 1;
          case 'nominalSize':return (parseInt(a.nominalSize) || 0) - (parseInt(b.nominalSize) || 0);
          case 'width':      return (parseInches(a.cutoutWidth) || 0) - (parseInches(b.cutoutWidth) || 0);
          default:           return 0;
        }
      });
    }

    filteredModels = models;
    renderModels(fw, fh, fd, hasTarget);
  }

  // ===== Render =====

  function renderModels(fw, fh, fd, hasTarget) {
    const grid       = document.getElementById('modelGrid');
    const noResults  = document.getElementById('noResults');
    const resultsMeta= document.getElementById('resultsMeta');
    const fitLegend  = document.getElementById('fitLegend');

    if (filteredModels.length === 0) {
      grid.innerHTML = '';
      noResults.style.display = 'flex';
      resultsMeta.style.display = 'none';
      return;
    }

    noResults.style.display = 'none';
    resultsMeta.style.display = 'flex';
    fitLegend.style.display = hasTarget ? 'flex' : 'none';
    document.getElementById('showingModels').textContent = filteredModels.length;
    document.getElementById('totalModels').textContent = allModels.length;

    const wMatch = hasTarget && !isNaN(fw);
    const hMatch = hasTarget && !isNaN(fh);
    const dMatch = hasTarget && !isNaN(fd);

    grid.innerHTML = filteredModels.map(m => {
      const fitClass  = m._fitClass && m._fitClass !== 'none' ? 'fit-' + m._fitClass : '';
      const fitLabel  = m._fitClass === 'exact' ? '✓ Fits'
                      : m._fitClass === 'close' ? '≈ Very Close'
                      : '';
      const sizeLabel = m.nominalSize ? m.nominalSize + '"' : '';

      return `
        <div class="model-card ${fitClass}" data-id="${escHtml(m.id)}">
          ${fitLabel ? `<div class="fit-strip">${fitLabel}</div>` : ''}
          <div class="card-header">
            <div>
              <div class="card-model-number">${escHtml(m.id)}</div>
              <div class="card-brand">${escHtml(m.brand)}</div>
              <div class="card-category">${escHtml(m.category)}</div>
            </div>
            <div class="card-badges">
              ${sizeLabel ? `<span class="badge badge-size">${sizeLabel}</span>` : ''}
              ${m.confirmed ? '<span class="badge badge-confirmed">✓ Confirmed</span>' : '<span class="badge badge-unconfirmed">Unconfirmed</span>'}
              ${m.active === false ? '<span class="badge badge-discontinued">Discontinued</span>' : ''}
            </div>
          </div>
          <div class="card-install-type ${m.install === 'Proud' ? 'install-proud' : 'install-flush'}">
            ${m.install === 'Proud' ? '▲' : '▬'} ${escHtml(m.install || '')} Install
          </div>
          ${(m.trim || m.color) ? `
            <div class="card-trim-color">
              ${m.trim  ? `<span class="trim-tag">Trim: ${escHtml(m.trim)}</span>`   : ''}
              ${m.color ? `<span class="color-tag">Color: ${escHtml(m.color)}</span>` : ''}
            </div>
          ` : ''}
          <div class="card-specs">
            <div class="spec-group">
              <div class="spec-group-title">Appliance Size</div>
              <div class="spec-row"><span class="spec-label">W</span><span class="spec-value ${!m.width ? 'empty' : ''}">${m.width || '---'}</span></div>
              <div class="spec-row"><span class="spec-label">H</span><span class="spec-value ${!m.height ? 'empty' : ''}">${m.height || '---'}</span></div>
              <div class="spec-row"><span class="spec-label">D</span><span class="spec-value ${!m.depth ? 'empty' : ''}">${m.depth || '---'}</span></div>
            </div>
            <div class="spec-group">
              <div class="spec-group-title">Cutout Required</div>
              <div class="spec-row">
                <span class="spec-label">W</span>
                <span class="spec-value ${!m.cutoutWidth ? 'empty' : ''} ${wMatch && fitClass ? 'cutout-match' : ''}">${m.cutoutWidth || '---'}</span>
              </div>
              <div class="spec-row">
                <span class="spec-label">H</span>
                <span class="spec-value ${!m.cutoutHeight ? 'empty' : ''} ${hMatch && fitClass ? 'cutout-match' : ''}">${m.cutoutHeight || '---'}</span>
              </div>
              <div class="spec-row">
                <span class="spec-label">D</span>
                <span class="spec-value ${!m.cutoutDepth ? 'empty' : ''} ${dMatch && fitClass ? 'cutout-match' : ''}">${m.cutoutDepth || '---'}</span>
              </div>
            </div>
          </div>
          ${m.installNote ? `<div class="card-note">${escHtml(m.installNote)}</div>` : ''}
          <div class="card-actions">
            <button class="btn btn-sm btn-trail" onclick="window.open('https://www.trailappliances.com/search?q=${encodeURIComponent(m.id)}','_blank')">
              Trail
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // ===== Boot =====
  loadData();

})();
