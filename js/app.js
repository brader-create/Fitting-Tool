/* ===== Brad's Handy Dandy Fitting Tool ===== */

(function () {
  'use strict';

  // ===== State =====
  let allModels = [];
  let filteredModels = [];
  let devMode = false;

  const STORAGE_KEYS = {
    confirmed: 'fittingTool_confirmed',
    overrides: 'fittingTool_overrides',
    related: 'fittingTool_relatedGroups',
    addedModels: 'fittingTool_addedModels',
    theme: 'fittingTool_theme',
  };

  // Fit thresholds (inches)
  const FIT_EXACT_THRESHOLD = 0.5;   // green — fits
  const FIT_CLOSE_THRESHOLD = 1.5;   // orange — very close

  // ===== Helpers =====

  function parseInches(str) {
    if (!str || typeof str !== 'string') return null;
    let s = str.replace(/"/g, '').replace(/\(.*?\)/g, '').trim();
    if (s.includes('-')) s = s.split('-')[0].trim();
    s = s.replace(/[±\u00b1].*/, '').trim();
    const mixedMatch = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixedMatch) return parseInt(mixedMatch[1]) + parseInt(mixedMatch[2]) / parseInt(mixedMatch[3]);
    const fracMatch = s.match(/^(\d+)\/(\d+)$/);
    if (fracMatch) return parseInt(fracMatch[1]) / parseInt(fracMatch[2]);
    const numMatch = s.match(/^[\d.]+$/);
    if (numMatch) return parseFloat(s);
    return null;
  }

  function getStorage(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  }

  function setStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
  }

  function getModelData(model) {
    const overrides = getStorage(STORAGE_KEYS.overrides, {});
    const confirmed = getStorage(STORAGE_KEYS.confirmed, {});
    const merged = { ...model };
    if (overrides[model.id]) Object.assign(merged, overrides[model.id]);
    merged.confirmed = !!confirmed[model.id];
    return merged;
  }

  function getRelatedModels(modelId) {
    const groups = getStorage(STORAGE_KEYS.related, {});
    for (const groupId of Object.keys(groups)) {
      const members = groups[groupId];
      if (members.includes(modelId)) return members.filter(id => id !== modelId);
    }
    return [];
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
          const packData = await packRes.json();
          models = models.concat(packData);
        } catch (e) {
          console.warn('Failed to load expansion pack:', pack, e);
        }
      }

      const addedModels = getStorage(STORAGE_KEYS.addedModels, []);
      models = models.concat(addedModels);

      allModels = models.map(m => getModelData(m));

      // Deduplicate
      const seen = new Set();
      allModels = allModels.filter(m => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });

      initUI();
    } catch (e) {
      console.error('Failed to load appliance data:', e);
      document.getElementById('modelGrid').innerHTML =
        '<p style="padding:40px;text-align:center;color:var(--text-muted)">Failed to load data. Serve from a web server (not file://).</p>';
    }
  }

  // ===== UI Init =====

  function initUI() {
    buildFilterChips();
    attachEventListeners();
    loadTheme();
    // Show empty state on load - no results until user types
    showEmptyState();
  }

  function showEmptyState() {
    document.getElementById('emptyState').style.display = 'flex';
    document.getElementById('noResults').style.display = 'none';
    document.getElementById('modelGrid').innerHTML = '';
    document.getElementById('resultsMeta').style.display = 'none';
    document.getElementById('showingModels').textContent = '0';
    document.getElementById('totalModels').textContent = allModels.length;
  }

  function buildFilterChips() {
    const brands = [...new Set(allModels.map(m => m.brand))].sort();
    document.getElementById('brandFilters').innerHTML = brands.map(b => {
      const count = allModels.filter(m => m.brand === b).length;
      return `<button class="filter-chip active" data-filter="brand" data-value="${escHtml(b)}">${escHtml(b)} <span class="count">(${count})</span></button>`;
    }).join('');

    const categories = [...new Set(allModels.map(m => m.category))].sort();
    document.getElementById('categoryFilters').innerHTML = categories.map(c => {
      const count = allModels.filter(m => m.category === c).length;
      return `<button class="filter-chip active" data-filter="category" data-value="${escHtml(c)}">${escHtml(c)} <span class="count">(${count})</span></button>`;
    }).join('');

    const sizes = [...new Set(allModels.map(m => m.nominalSize).filter(Boolean))].sort((a, b) => parseInt(a) - parseInt(b));
    document.getElementById('nominalSizeFilters').innerHTML = sizes.map(s => {
      const count = allModels.filter(m => m.nominalSize === s).length;
      return `<button class="filter-chip active" data-filter="nominalSize" data-value="${escHtml(s)}">${escHtml(s)}" <span class="count">(${count})</span></button>`;
    }).join('');

    const installs = [...new Set(allModels.map(m => m.install))].sort();
    document.getElementById('installFilters').innerHTML = installs.map(i => {
      const count = allModels.filter(m => m.install === i).length;
      return `<button class="filter-chip active" data-filter="install" data-value="${escHtml(i)}">${escHtml(i)} <span class="count">(${count})</span></button>`;
    }).join('');
  }

  // ===== Event Listeners =====

  function attachEventListeners() {
    // Theme
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    // Filter chips (delegated)
    ['brandFilters', 'categoryFilters', 'nominalSizeFilters', 'installFilters'].forEach(id => {
      document.getElementById(id).addEventListener('click', e => {
        const chip = e.target.closest('.filter-chip');
        if (chip) { chip.classList.toggle('active'); applyFilters(); }
      });
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', applyFilters);

    // Dimension inputs
    ['filterWidth', 'filterHeight', 'filterDepth'].forEach(id => {
      document.getElementById(id).addEventListener('input', applyFilters);
    });

    // Tolerance slider
    const tolSlider = document.getElementById('fitTolerance');
    const tolVal = document.getElementById('fitToleranceVal');
    tolSlider.addEventListener('input', () => {
      tolVal.textContent = '± ' + tolSlider.value + '"';
      applyFilters();
    });

    // Active / Confirmed toggles
    document.getElementById('filterActive').addEventListener('change', applyFilters);
    document.getElementById('filterConfirmed').addEventListener('change', applyFilters);

    // Sort
    document.getElementById('sortBy').addEventListener('change', applyFilters);

    // Filters toggle
    document.getElementById('filtersToggleBtn').addEventListener('click', () => {
      const panel = document.getElementById('filtersPanel');
      const btn = document.getElementById('filtersToggleBtn');
      const open = panel.style.display === 'none';
      panel.style.display = open ? 'block' : 'none';
      btn.classList.toggle('btn-primary', open);
      btn.classList.toggle('btn-secondary', !open);
    });

    // Dev mode
    document.getElementById('devModeBtn').addEventListener('click', handleDevModeClick);
    document.getElementById('devCancel').addEventListener('click', () => {
      document.getElementById('devModal').style.display = 'none';
    });
    document.getElementById('devSubmit').addEventListener('click', handleDevModeSubmit);
    document.getElementById('devPassword').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleDevModeSubmit();
    });

    // Edit modal
    document.getElementById('editCancel').addEventListener('click', () => {
      document.getElementById('editModal').style.display = 'none';
    });
    document.getElementById('editSave').addEventListener('click', handleEditSave);

    // Relate modal
    document.getElementById('relateCancel').addEventListener('click', () => {
      document.getElementById('relateModal').style.display = 'none';
    });
    document.getElementById('relateSave').addEventListener('click', handleRelateSave);
    document.getElementById('relateSearch').addEventListener('input', filterRelateList);

    // Add model
    document.getElementById('addModelBtn').addEventListener('click', () => {
      document.getElementById('addModal').style.display = 'flex';
    });
    document.getElementById('addCancel').addEventListener('click', () => {
      document.getElementById('addModal').style.display = 'none';
    });
    document.getElementById('addSave').addEventListener('click', handleAddModel);
  }

  // ===== Theme =====

  function loadTheme() {
    const saved = localStorage.getItem(STORAGE_KEYS.theme) || 'light';
    document.documentElement.setAttribute('data-theme', saved);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_KEYS.theme, next);
  }

  // ===== Dev Mode =====

  function handleDevModeClick() {
    if (devMode) {
      devMode = false;
      document.body.classList.remove('dev-mode-active');
      document.getElementById('devModeBtn').classList.remove('active');
      document.querySelectorAll('.dev-only').forEach(el => el.style.display = 'none');
      applyFilters();
      return;
    }
    document.getElementById('devModal').style.display = 'flex';
    document.getElementById('devPassword').value = '';
    document.getElementById('devError').style.display = 'none';
    setTimeout(() => document.getElementById('devPassword').focus(), 100);
  }

  function handleDevModeSubmit() {
    if (document.getElementById('devPassword').value === 'TrailerAdmin77') {
      devMode = true;
      document.getElementById('devModal').style.display = 'none';
      document.body.classList.add('dev-mode-active');
      document.getElementById('devModeBtn').classList.add('active');
      document.querySelectorAll('.dev-only').forEach(el => el.style.display = 'block');
      applyFilters();
    } else {
      document.getElementById('devError').style.display = 'block';
    }
  }

  // ===== Fit Classification =====

  /**
   * Returns 'exact' (green), 'close' (orange), or null (no fit data / beyond tolerance).
   * Uses cutout width as primary dimension. Falls back to appliance width.
   */
  function classifyFit(model, targetW, targetH, targetD, tolerance) {
    const hasTarget = !isNaN(targetW) || !isNaN(targetH) || !isNaN(targetD);
    if (!hasTarget) return null;

    let maxDiff = 0;
    let compared = 0;

    if (!isNaN(targetW)) {
      const w = parseInches(model.cutoutWidth) || parseInches(model.width);
      if (w !== null) { maxDiff = Math.max(maxDiff, Math.abs(w - targetW)); compared++; }
    }
    if (!isNaN(targetH)) {
      const h = parseInches(model.cutoutHeight) || parseInches(model.height);
      if (h !== null) { maxDiff = Math.max(maxDiff, Math.abs(h - targetH)); compared++; }
    }
    if (!isNaN(targetD)) {
      const d = parseInches(model.cutoutDepth) || parseInches(model.depth);
      if (d !== null) { maxDiff = Math.max(maxDiff, Math.abs(d - targetD)); compared++; }
    }

    if (compared === 0) return null;
    if (maxDiff > tolerance) return null;          // outside tolerance — filtered out
    if (maxDiff <= FIT_EXACT_THRESHOLD) return 'exact';
    if (maxDiff <= FIT_CLOSE_THRESHOLD) return 'close';
    return 'near'; // within tolerance but beyond close threshold — shown but no color
  }

  // ===== Filtering & Sorting =====

  function applyFilters() {
    // Refresh overrides/confirmed from storage
    allModels = allModels.map(m => {
      const confirmed = getStorage(STORAGE_KEYS.confirmed, {});
      const overrides = getStorage(STORAGE_KEYS.overrides, {});
      const merged = { ...m };
      if (overrides[m.id]) Object.assign(merged, overrides[m.id]);
      merged.confirmed = !!confirmed[m.id];
      return merged;
    });

    let models = [...allModels];

    // Search
    const search = document.getElementById('searchInput').value.trim().toLowerCase();
    if (search) {
      models = models.filter(m =>
        m.id.toLowerCase().includes(search) ||
        m.brand.toLowerCase().includes(search) ||
        m.category.toLowerCase().includes(search)
      );
    }

    // Brand
    const activeBrands = getActiveChips('brand');
    const totalBrands = document.querySelectorAll('.filter-chip[data-filter="brand"]').length;
    if (activeBrands.length > 0 && activeBrands.length < totalBrands)
      models = models.filter(m => activeBrands.includes(m.brand));

    // Category
    const activeCats = getActiveChips('category');
    const totalCats = document.querySelectorAll('.filter-chip[data-filter="category"]').length;
    if (activeCats.length > 0 && activeCats.length < totalCats)
      models = models.filter(m => activeCats.includes(m.category));

    // Nominal size
    const activeSizes = getActiveChips('nominalSize');
    const totalSizes = document.querySelectorAll('.filter-chip[data-filter="nominalSize"]').length;
    if (activeSizes.length > 0 && activeSizes.length < totalSizes)
      models = models.filter(m => activeSizes.includes(m.nominalSize));

    // Install
    const activeInstalls = getActiveChips('install');
    const totalInstalls = document.querySelectorAll('.filter-chip[data-filter="install"]').length;
    if (activeInstalls.length > 0 && activeInstalls.length < totalInstalls)
      models = models.filter(m => activeInstalls.includes(m.install));

    // Active / Confirmed
    if (document.getElementById('filterActive').checked) models = models.filter(m => m.active);
    if (document.getElementById('filterConfirmed').checked) models = models.filter(m => m.confirmed);

    // Dimension targets
    const fw = parseFloat(document.getElementById('filterWidth').value);
    const fh = parseFloat(document.getElementById('filterHeight').value);
    const fd = parseFloat(document.getElementById('filterDepth').value);
    const tolerance = parseFloat(document.getElementById('fitTolerance').value) || 1;
    const hasTarget = !isNaN(fw) || !isNaN(fh) || !isNaN(fd);

    if (hasTarget) {
      // Classify each model and filter out those beyond tolerance
      models = models.map(m => ({
        ...m,
        _fitClass: classifyFit(m, fw, fh, fd, tolerance),
      })).filter(m => m._fitClass !== null);
    } else if (!search) {
      // No dimensions and no search — show empty state
      showEmptyState();
      return;
    }

    // Sort
    const sortBy = document.getElementById('sortBy').value;
    if (sortBy === 'fit' && hasTarget) {
      // Sort: exact first, then close, then near, within each group by width diff
      const order = { exact: 0, close: 1, near: 2, null: 3 };
      models.sort((a, b) => {
        const oa = order[a._fitClass] ?? 3;
        const ob = order[b._fitClass] ?? 3;
        if (oa !== ob) return oa - ob;
        // Secondary: brand
        return a.brand.toLowerCase() < b.brand.toLowerCase() ? -1 : 1;
      });
    } else {
      models.sort((a, b) => {
        switch (sortBy) {
          case 'brand':
            return a.brand.toLowerCase() < b.brand.toLowerCase() ? -1 : 1;
          case 'model':
            return a.id.toLowerCase() < b.id.toLowerCase() ? -1 : 1;
          case 'nominalSize':
            return (parseInt(a.nominalSize) || 0) - (parseInt(b.nominalSize) || 0);
          case 'width':
            return (parseInches(a.cutoutWidth) || 0) - (parseInches(b.cutoutWidth) || 0);
          default:
            return 0;
        }
      });
    }

    filteredModels = models;
    renderModels(fw, fh, fd, hasTarget);
  }

  function getActiveChips(filterType) {
    return [...document.querySelectorAll(`.filter-chip[data-filter="${filterType}"].active`)]
      .map(el => el.dataset.value);
  }

  // ===== Render =====

  function renderModels(fw, fh, fd, hasTarget) {
    const grid = document.getElementById('modelGrid');
    const noResults = document.getElementById('noResults');
    const emptyState = document.getElementById('emptyState');
    const resultsMeta = document.getElementById('resultsMeta');

    emptyState.style.display = 'none';

    if (filteredModels.length === 0) {
      grid.innerHTML = '';
      noResults.style.display = 'flex';
      resultsMeta.style.display = 'none';
      return;
    }

    noResults.style.display = 'none';
    resultsMeta.style.display = 'flex';
    document.getElementById('showingModels').textContent = filteredModels.length;
    document.getElementById('totalModels').textContent = allModels.length;

    grid.innerHTML = filteredModels.map(m => {
      const related = getRelatedModels(m.id);
      const sizeLabel = m.nominalSize ? m.nominalSize + '"' : '';
      const fitClass = m._fitClass || '';
      const fitLabel = fitClass === 'exact' ? '✓ Fits' : fitClass === 'close' ? '~ Very Close' : '';

      // Determine if cutout width matches to highlight it
      const wMatch = hasTarget && !isNaN(fw);
      const hMatch = hasTarget && !isNaN(fh);
      const dMatch = hasTarget && !isNaN(fd);

      return `
        <div class="model-card ${fitClass ? 'fit-' + fitClass : ''}" data-id="${escHtml(m.id)}">
          ${fitLabel ? `<div class="fit-strip">${fitLabel}</div>` : ''}
          <div class="card-header">
            <div>
              <div class="card-model-number">${escHtml(m.id)}</div>
              <div class="card-brand">${escHtml(m.brand)}</div>
              <div class="card-category">${escHtml(m.category)}</div>
            </div>
            <div class="card-badges">
              ${sizeLabel ? `<span class="badge badge-size">${sizeLabel}</span>` : ''}
              ${m.confirmed
                ? '<span class="badge badge-confirmed">✓ Confirmed</span>'
                : '<span class="badge badge-unconfirmed">Unconfirmed</span>'
              }
              ${!m.active ? '<span class="badge badge-discontinued">Discontinued</span>' : ''}
            </div>
          </div>
          <div class="card-install-type ${m.install === 'Proud' ? 'install-proud' : 'install-flush'}">
            ${m.install === 'Proud' ? '▲' : '▬'} ${escHtml(m.install)} Install
          </div>
          ${(m.trim || m.color) ? `
            <div class="card-trim-color">
              ${m.trim ? `<span class="trim-tag">Trim: ${escHtml(m.trim)}</span>` : ''}
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
          ${related.length > 0 ? `<div class="card-related"><strong>Related:</strong> ${related.map(r => escHtml(r)).join(', ')}</div>` : ''}
          <div class="card-actions">
            <button class="btn btn-sm btn-trail" onclick="window.open('https://www.trailappliances.com/search?q=${encodeURIComponent(m.id)}','_blank')">
              Trail
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
            </button>
            ${devMode ? `
              <button class="btn btn-sm btn-confirm" onclick="confirmModel('${escHtml(m.id)}')">${m.confirmed ? 'Unconfirm' : 'Confirm'}</button>
              <button class="btn btn-sm btn-icon" onclick="editModel('${escHtml(m.id)}')" title="Edit">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn-sm btn-icon" onclick="relateModel('${escHtml(m.id)}')" title="Related Models">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // ===== Dev Actions =====

  window.confirmModel = function (id) {
    const confirmed = getStorage(STORAGE_KEYS.confirmed, {});
    if (confirmed[id]) delete confirmed[id];
    else confirmed[id] = true;
    setStorage(STORAGE_KEYS.confirmed, confirmed);
    applyFilters();
  };

  window.editModel = function (id) {
    const model = allModels.find(m => m.id === id);
    if (!model) return;
    document.getElementById('editModelId').textContent = id;
    document.getElementById('editBrand').value = model.brand || '';
    document.getElementById('editCategory').value = model.category || '';
    document.getElementById('editActive').value = model.active ? 'true' : 'false';
    document.getElementById('editInstall').value = model.install || 'Proud';
    document.getElementById('editNominalSize').value = model.nominalSize || '';
    document.getElementById('editTrim').value = model.trim || '';
    document.getElementById('editColor').value = model.color || '';
    document.getElementById('editWidth').value = model.width || '';
    document.getElementById('editHeight').value = model.height || '';
    document.getElementById('editDepth').value = model.depth || '';
    document.getElementById('editCutoutWidth').value = model.cutoutWidth || '';
    document.getElementById('editCutoutHeight').value = model.cutoutHeight || '';
    document.getElementById('editCutoutDepth').value = model.cutoutDepth || '';
    document.getElementById('editInstallNote').value = model.installNote || '';
    document.getElementById('editModal').style.display = 'flex';
    document.getElementById('editModal').dataset.modelId = id;
  };

  function handleEditSave() {
    const id = document.getElementById('editModal').dataset.modelId;
    const overrides = getStorage(STORAGE_KEYS.overrides, {});
    overrides[id] = {
      brand: document.getElementById('editBrand').value,
      category: document.getElementById('editCategory').value,
      active: document.getElementById('editActive').value === 'true',
      install: document.getElementById('editInstall').value,
      nominalSize: document.getElementById('editNominalSize').value,
      trim: document.getElementById('editTrim').value,
      color: document.getElementById('editColor').value,
      width: document.getElementById('editWidth').value,
      height: document.getElementById('editHeight').value,
      depth: document.getElementById('editDepth').value,
      cutoutWidth: document.getElementById('editCutoutWidth').value,
      cutoutHeight: document.getElementById('editCutoutHeight').value,
      cutoutDepth: document.getElementById('editCutoutDepth').value,
      installNote: document.getElementById('editInstallNote').value,
    };
    setStorage(STORAGE_KEYS.overrides, overrides);
    document.getElementById('editModal').style.display = 'none';
    const idx = allModels.findIndex(m => m.id === id);
    if (idx >= 0) Object.assign(allModels[idx], overrides[id]);
    applyFilters();
  }

  window.relateModel = function (id) {
    document.getElementById('relateModelId').textContent = id;
    document.getElementById('relateModal').style.display = 'flex';
    document.getElementById('relateModal').dataset.modelId = id;
    document.getElementById('relateSearch').value = '';
    buildRelateList(id);
  };

  function buildRelateList(currentId) {
    const container = document.getElementById('relateList');
    const related = getRelatedModels(currentId);
    const models = allModels.filter(m => m.id !== currentId);
    container.innerHTML = models.map(m => `
      <label class="relate-item" data-id="${escHtml(m.id)}">
        <input type="checkbox" ${related.includes(m.id) ? 'checked' : ''} value="${escHtml(m.id)}">
        <span><strong>${escHtml(m.id)}</strong> <span class="relate-item-brand">${escHtml(m.brand)} — ${escHtml(m.category)}</span></span>
      </label>
    `).join('');
  }

  function filterRelateList() {
    const search = document.getElementById('relateSearch').value.toLowerCase();
    document.querySelectorAll('.relate-item').forEach(item => {
      const match = item.dataset.id.toLowerCase().includes(search) || item.textContent.toLowerCase().includes(search);
      item.style.display = match ? 'flex' : 'none';
    });
  }

  function handleRelateSave() {
    const currentId = document.getElementById('relateModal').dataset.modelId;
    const checked = [...document.querySelectorAll('#relateList input:checked')].map(c => c.value);
    const groups = getStorage(STORAGE_KEYS.related, {});

    for (const groupId of Object.keys(groups)) {
      groups[groupId] = groups[groupId].filter(id => id !== currentId);
      if (groups[groupId].length <= 1) delete groups[groupId];
    }

    if (checked.length > 0) {
      const groupMembers = [currentId, ...checked];
      let existingGroupId = null;
      for (const memberId of checked) {
        for (const gid of Object.keys(groups)) {
          if (groups[gid].includes(memberId)) { existingGroupId = gid; break; }
        }
        if (existingGroupId) break;
      }
      if (existingGroupId) {
        groups[existingGroupId] = [...new Set([...groups[existingGroupId], ...groupMembers])];
      } else {
        groups['group_' + Date.now()] = groupMembers;
      }
    }

    setStorage(STORAGE_KEYS.related, groups);
    document.getElementById('relateModal').style.display = 'none';
    applyFilters();
  }

  function handleAddModel() {
    const id = document.getElementById('addModelId').value.trim();
    if (!id) { alert('Model number is required.'); return; }
    if (allModels.some(m => m.id === id)) { alert('A model with this number already exists.'); return; }

    const newModel = {
      id,
      brand: document.getElementById('addBrand').value,
      category: document.getElementById('addCategory').value,
      active: true,
      confirmed: false,
      nominalSize: document.getElementById('addNominalSize').value,
      width: document.getElementById('addWidth').value,
      height: document.getElementById('addHeight').value,
      depth: document.getElementById('addDepth').value,
      builtIn: true,
      install: document.getElementById('addInstall').value,
      cutoutWidth: document.getElementById('addCutoutWidth').value,
      cutoutHeight: document.getElementById('addCutoutHeight').value,
      cutoutDepth: document.getElementById('addCutoutDepth').value,
      installNote: document.getElementById('addInstallNote').value,
      trim: document.getElementById('addTrim').value,
      color: document.getElementById('addColor').value,
    };

    const addedModels = getStorage(STORAGE_KEYS.addedModels, []);
    addedModels.push(newModel);
    setStorage(STORAGE_KEYS.addedModels, addedModels);
    allModels.push(newModel);

    buildFilterChips();
    // Re-delegate filter chips
    ['brandFilters', 'categoryFilters', 'nominalSizeFilters', 'installFilters'].forEach(filterId => {
      const el = document.getElementById(filterId);
      el.replaceWith(el.cloneNode(true));
      document.getElementById(filterId).addEventListener('click', e => {
        const chip = e.target.closest('.filter-chip');
        if (chip) { chip.classList.toggle('active'); applyFilters(); }
      });
    });

    document.getElementById('addModal').style.display = 'none';
    ['addModelId','addBrand','addNominalSize','addWidth','addHeight','addDepth',
     'addCutoutWidth','addCutoutHeight','addCutoutDepth','addInstallNote','addTrim','addColor']
      .forEach(fid => { document.getElementById(fid).value = ''; });

    applyFilters();
  }

  // ===== Boot =====
  loadData();

})();
