/* ===== Brad's Handy Dandy Fitting Tool - Main App ===== */

(function () {
  'use strict';

  // ===== State =====
  let allModels = [];
  let filteredModels = [];
  let devMode = false;

  // localStorage keys
  const STORAGE_KEYS = {
    confirmed: 'fittingTool_confirmed',
    overrides: 'fittingTool_overrides',
    related: 'fittingTool_relatedGroups',
    addedModels: 'fittingTool_addedModels',
    theme: 'fittingTool_theme',
  };

  // ===== Helpers =====

  /** Parse fractional inch strings like '36 15/16"' to a decimal number. */
  function parseInches(str) {
    if (!str || typeof str !== 'string') return null;
    // Remove quotes, trim, remove parenthetical notes
    let s = str.replace(/"/g, '').replace(/\(.*?\)/g, '').trim();
    // Handle range: take first value (e.g. "34 3/4 - 34 7/8" -> 34.75)
    if (s.includes('-')) {
      s = s.split('-')[0].trim();
    }
    // Handle ± notation
    s = s.replace(/[±\u00b1].*/, '').trim();
    // Match patterns: "36", "36 15/16", "15/16", "36.5"
    const mixedMatch = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixedMatch) {
      return parseInt(mixedMatch[1]) + parseInt(mixedMatch[2]) / parseInt(mixedMatch[3]);
    }
    const fracMatch = s.match(/^(\d+)\/(\d+)$/);
    if (fracMatch) {
      return parseInt(fracMatch[1]) / parseInt(fracMatch[2]);
    }
    const numMatch = s.match(/^[\d.]+$/);
    if (numMatch) {
      return parseFloat(s);
    }
    return null;
  }

  /** Get a stored JSON object or default. */
  function getStorage(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }

  /** Set a stored JSON object. */
  function setStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* quota exceeded - silently fail */ }
  }

  /** Merge base model data with any localStorage overrides. */
  function getModelData(model) {
    const overrides = getStorage(STORAGE_KEYS.overrides, {});
    const confirmed = getStorage(STORAGE_KEYS.confirmed, {});
    const merged = { ...model };
    if (overrides[model.id]) {
      Object.assign(merged, overrides[model.id]);
    }
    merged.confirmed = !!confirmed[model.id];
    return merged;
  }

  /** Get all related models for a given model ID. */
  function getRelatedModels(modelId) {
    const groups = getStorage(STORAGE_KEYS.related, {});
    // Find the group this model belongs to
    for (const groupId of Object.keys(groups)) {
      const members = groups[groupId];
      if (members.includes(modelId)) {
        return members.filter(id => id !== modelId);
      }
    }
    return [];
  }

  // ===== Data Loading =====

  async function loadData() {
    try {
      // Load manifest
      const manifestRes = await fetch('data/manifest.json');
      const manifest = await manifestRes.json();

      // Load base pack
      const baseRes = await fetch('data/' + manifest.basePack);
      let models = await baseRes.json();

      // Load expansion packs
      for (const pack of (manifest.expansionPacks || [])) {
        try {
          const packRes = await fetch('data/packs/' + pack);
          const packData = await packRes.json();
          models = models.concat(packData);
        } catch (e) {
          console.warn('Failed to load expansion pack:', pack, e);
        }
      }

      // Load user-added models from localStorage
      const addedModels = getStorage(STORAGE_KEYS.addedModels, []);
      models = models.concat(addedModels);

      // Merge overrides
      allModels = models.map(m => getModelData(m));

      // Deduplicate by id
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
        '<p style="padding:40px;text-align:center;color:var(--text-muted);">Failed to load data. Make sure you are serving this from a web server (not file://).</p>';
    }
  }

  // ===== UI Init =====

  function initUI() {
    buildFilterChips();
    attachEventListeners();
    applyFilters();
    updateStats();
    loadTheme();
  }

  function buildFilterChips() {
    // Brands
    const brands = [...new Set(allModels.map(m => m.brand))].sort();
    const brandContainer = document.getElementById('brandFilters');
    brandContainer.innerHTML = brands.map(b => {
      const count = allModels.filter(m => m.brand === b).length;
      return `<button class="filter-chip active" data-filter="brand" data-value="${b}">${b} <span class="count">(${count})</span></button>`;
    }).join('');

    // Categories
    const categories = [...new Set(allModels.map(m => m.category))].sort();
    const catContainer = document.getElementById('categoryFilters');
    catContainer.innerHTML = categories.map(c => {
      const count = allModels.filter(m => m.category === c).length;
      return `<button class="filter-chip active" data-filter="category" data-value="${c}">${c} <span class="count">(${count})</span></button>`;
    }).join('');

    // Nominal sizes
    const sizes = [...new Set(allModels.map(m => m.nominalSize).filter(Boolean))].sort((a, b) => parseInt(a) - parseInt(b));
    const sizeContainer = document.getElementById('nominalSizeFilters');
    sizeContainer.innerHTML = sizes.map(s => {
      const count = allModels.filter(m => m.nominalSize === s).length;
      return `<button class="filter-chip active" data-filter="nominalSize" data-value="${s}">${s}" <span class="count">(${count})</span></button>`;
    }).join('');

    // Install types
    const installs = [...new Set(allModels.map(m => m.install))].sort();
    const installContainer = document.getElementById('installFilters');
    installContainer.innerHTML = installs.map(i => {
      const count = allModels.filter(m => m.install === i).length;
      return `<button class="filter-chip active" data-filter="install" data-value="${i}">${i} <span class="count">(${count})</span></button>`;
    }).join('');
  }

  // ===== Event Listeners =====

  function attachEventListeners() {
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    // Filter chips
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        applyFilters();
      });
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', applyFilters);

    // Size filters
    ['filterWidth', 'filterHeight', 'filterDepth'].forEach(id => {
      document.getElementById(id).addEventListener('input', applyFilters);
    });

    // Closest fit toggle
    document.getElementById('closestFit').addEventListener('change', function () {
      document.getElementById('closestFitOptions').style.display = this.checked ? 'block' : 'none';
      applyFilters();
    });
    document.querySelectorAll('input[name="closestPriority"]').forEach(r => {
      r.addEventListener('change', applyFilters);
    });
    document.getElementById('closestTolerance').addEventListener('input', applyFilters);

    // Active / Confirmed toggles
    document.getElementById('filterActive').addEventListener('change', applyFilters);
    document.getElementById('filterConfirmed').addEventListener('change', applyFilters);

    // Sort
    document.getElementById('sortBy').addEventListener('change', applyFilters);
    document.querySelectorAll('input[name="sortDir"]').forEach(r => {
      r.addEventListener('change', applyFilters);
    });

    // Sidebar toggle (mobile)
    document.getElementById('sidebarToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    // Dev mode
    document.getElementById('devModeBtn').addEventListener('click', handleDevModeClick);
    document.getElementById('devCancel').addEventListener('click', () => {
      document.getElementById('devModal').style.display = 'none';
    });
    document.getElementById('devSubmit').addEventListener('click', handleDevModeSubmit);
    document.getElementById('devPassword').addEventListener('keydown', (e) => {
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
    const saved = localStorage.getItem(STORAGE_KEYS.theme);
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    } else {
      // Default to light
      document.documentElement.setAttribute('data-theme', 'light');
    }
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
    const pw = document.getElementById('devPassword').value;
    if (pw === 'TrailerAdmin77') {
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

  // ===== Filtering & Sorting =====

  function applyFilters() {
    // Refresh confirmed/overrides from storage
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

    // Brand filter
    const activeBrands = getActiveFilterValues('brand');
    if (activeBrands.length > 0 && activeBrands.length < allBrandsCount()) {
      models = models.filter(m => activeBrands.includes(m.brand));
    }

    // Category filter
    const activeCats = getActiveFilterValues('category');
    if (activeCats.length > 0 && activeCats.length < allCatsCount()) {
      models = models.filter(m => activeCats.includes(m.category));
    }

    // Nominal size filter
    const activeSizes = getActiveFilterValues('nominalSize');
    const totalSizes = document.querySelectorAll('.filter-chip[data-filter="nominalSize"]').length;
    if (activeSizes.length > 0 && activeSizes.length < totalSizes) {
      models = models.filter(m => activeSizes.includes(m.nominalSize));
    }

    // Install type filter
    const activeInstalls = getActiveFilterValues('install');
    const totalInstalls = document.querySelectorAll('.filter-chip[data-filter="install"]').length;
    if (activeInstalls.length > 0 && activeInstalls.length < totalInstalls) {
      models = models.filter(m => activeInstalls.includes(m.install));
    }

    // Active only
    if (document.getElementById('filterActive').checked) {
      models = models.filter(m => m.active);
    }

    // Confirmed only
    if (document.getElementById('filterConfirmed').checked) {
      models = models.filter(m => m.confirmed);
    }

    // Size filter
    const fw = parseFloat(document.getElementById('filterWidth').value);
    const fh = parseFloat(document.getElementById('filterHeight').value);
    const fd = parseFloat(document.getElementById('filterDepth').value);
    const closestFit = document.getElementById('closestFit').checked;

    if (!closestFit) {
      // Exact filter: show models whose cutout dimensions contain the entered size
      if (!isNaN(fw)) {
        models = models.filter(m => {
          const w = parseInches(m.cutoutWidth);
          if (w === null) return true; // keep models without data
          return Math.abs(w - fw) < 0.5;
        });
      }
      if (!isNaN(fh)) {
        models = models.filter(m => {
          const h = parseInches(m.cutoutHeight);
          if (h === null) return true;
          return Math.abs(h - fh) < 0.5;
        });
      }
      if (!isNaN(fd)) {
        models = models.filter(m => {
          const d = parseInches(m.cutoutDepth);
          if (d === null) return true;
          return Math.abs(d - fd) < 0.5;
        });
      }
    } else {
      // Closest fit mode
      const priority = document.querySelector('input[name="closestPriority"]:checked').value;
      const tolerance = parseFloat(document.getElementById('closestTolerance').value) || 2;
      const targetVal = priority === 'width' ? fw : fh;

      if (!isNaN(targetVal)) {
        models = models.map(m => {
          const val = priority === 'width' ? parseInches(m.cutoutWidth) : parseInches(m.cutoutHeight);
          return { ...m, _closestDiff: val !== null ? Math.abs(val - targetVal) : Infinity };
        }).filter(m => m._closestDiff <= tolerance);
      }
    }

    // Sort
    const sortBy = document.getElementById('sortBy').value;
    const sortDir = document.querySelector('input[name="sortDir"]:checked').value;
    const dir = sortDir === 'asc' ? 1 : -1;

    models.sort((a, b) => {
      let va, vb;
      switch (sortBy) {
        case 'brand':
          va = a.brand.toLowerCase();
          vb = b.brand.toLowerCase();
          return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
        case 'model':
          va = a.id.toLowerCase();
          vb = b.id.toLowerCase();
          return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
        case 'nominalSize':
          va = parseInt(a.nominalSize) || 0;
          vb = parseInt(b.nominalSize) || 0;
          return (va - vb) * dir;
        case 'category':
          va = a.category.toLowerCase();
          vb = b.category.toLowerCase();
          return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
        case 'width':
          va = parseInches(a.cutoutWidth) || parseInches(a.width) || 0;
          vb = parseInches(b.cutoutWidth) || parseInches(b.width) || 0;
          return (va - vb) * dir;
        default:
          return 0;
      }
    });

    // In closest fit mode, also sort by distance
    if (closestFit && models.length > 0 && models[0]._closestDiff !== undefined) {
      models.sort((a, b) => (a._closestDiff || 0) - (b._closestDiff || 0));
    }

    filteredModels = models;
    renderModels();
    updateStats();
  }

  function getActiveFilterValues(filterType) {
    return [...document.querySelectorAll(`.filter-chip[data-filter="${filterType}"].active`)]
      .map(el => el.dataset.value);
  }

  function allBrandsCount() {
    return document.querySelectorAll('.filter-chip[data-filter="brand"]').length;
  }

  function allCatsCount() {
    return document.querySelectorAll('.filter-chip[data-filter="category"]').length;
  }

  // ===== Render =====

  function renderModels() {
    const grid = document.getElementById('modelGrid');
    const noResults = document.getElementById('noResults');

    if (filteredModels.length === 0) {
      grid.innerHTML = '';
      noResults.style.display = 'block';
      return;
    }

    noResults.style.display = 'none';

    grid.innerHTML = filteredModels.map(m => {
      const related = getRelatedModels(m.id);
      const hasSpecs = m.width || m.cutoutWidth;
      const sizeLabel = m.nominalSize ? m.nominalSize + '"' : '';

      return `
        <div class="model-card ${m.confirmed ? 'confirmed' : ''}" data-id="${m.id}">
          <div class="card-header">
            <div>
              <div class="card-model-number">${escHtml(m.id)}</div>
              <div class="card-brand">${escHtml(m.brand)}</div>
              <div class="card-category">${escHtml(m.category)}</div>
            </div>
            <div class="card-badges">
              ${sizeLabel ? `<span class="badge badge-size">${sizeLabel}</span>` : ''}
              ${m.confirmed
                ? '<span class="badge badge-confirmed">&#10003; Confirmed</span>'
                : '<span class="badge badge-unconfirmed">Unconfirmed</span>'
              }
            </div>
          </div>
          <div class="card-install-type ${m.install === 'Proud' ? 'install-proud' : 'install-flush'}">
            ${m.install === 'Proud' ? '&#9650;' : '&#9644;'} ${escHtml(m.install)} Install
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
              <div class="spec-row"><span class="spec-label">W</span><span class="spec-value ${!m.cutoutWidth ? 'empty' : ''}">${m.cutoutWidth || '---'}</span></div>
              <div class="spec-row"><span class="spec-label">H</span><span class="spec-value ${!m.cutoutHeight ? 'empty' : ''}">${m.cutoutHeight || '---'}</span></div>
              <div class="spec-row"><span class="spec-label">D</span><span class="spec-value ${!m.cutoutDepth ? 'empty' : ''}">${m.cutoutDepth || '---'}</span></div>
            </div>
          </div>
          ${m.installNote ? `<div class="card-note">${escHtml(m.installNote)}</div>` : ''}
          ${related.length > 0 ? `<div class="card-related"><strong>Related:</strong> ${related.map(r => escHtml(r)).join(', ')}</div>` : ''}
          <div class="card-actions">
            <button class="btn btn-sm btn-trail" onclick="window.open('https://www.trailappliances.com/search?q=${encodeURIComponent(m.id)}','_blank')">
              Trail
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
            </button>
            ${devMode ? `
              <button class="btn btn-sm btn-confirm" onclick="confirmModel('${m.id}')">${m.confirmed ? 'Unconfirm' : 'Confirm'}</button>
              <button class="btn btn-sm btn-icon" onclick="editModel('${m.id}')" title="Edit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn-sm btn-icon" onclick="relateModel('${m.id}')" title="Related Models">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Stats =====

  function updateStats() {
    const confirmed = getStorage(STORAGE_KEYS.confirmed, {});
    const confirmedCount = allModels.filter(m => confirmed[m.id]).length;
    const total = allModels.length;

    document.getElementById('totalModels').textContent = total;
    document.getElementById('showingModels').textContent = filteredModels.length;
    document.getElementById('confirmedCount').textContent = confirmedCount + ' / ' + total;

    const pct = total > 0 ? Math.round((confirmedCount / total) * 100) : 0;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressPercent').textContent = pct + '%';
  }

  // ===== Model Actions (Global Scope) =====

  window.confirmModel = function (id) {
    const confirmed = getStorage(STORAGE_KEYS.confirmed, {});
    if (confirmed[id]) {
      delete confirmed[id];
    } else {
      confirmed[id] = true;
    }
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

    // Update model in allModels
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
      <label class="relate-item" data-id="${m.id}">
        <input type="checkbox" ${related.includes(m.id) ? 'checked' : ''} value="${m.id}">
        <span><strong>${escHtml(m.id)}</strong> <span class="relate-item-brand">${escHtml(m.brand)} - ${escHtml(m.category)}</span></span>
      </label>
    `).join('');
  }

  function filterRelateList() {
    const search = document.getElementById('relateSearch').value.toLowerCase();
    document.querySelectorAll('.relate-item').forEach(item => {
      const id = item.dataset.id.toLowerCase();
      const text = item.textContent.toLowerCase();
      item.style.display = (id.includes(search) || text.includes(search)) ? 'flex' : 'none';
    });
  }

  function handleRelateSave() {
    const currentId = document.getElementById('relateModal').dataset.modelId;
    const checked = [...document.querySelectorAll('#relateList input:checked')].map(c => c.value);
    const groups = getStorage(STORAGE_KEYS.related, {});

    // Remove current model from any existing group
    for (const groupId of Object.keys(groups)) {
      groups[groupId] = groups[groupId].filter(id => id !== currentId);
      if (groups[groupId].length <= 1) delete groups[groupId];
    }

    // Create new group if any checked
    if (checked.length > 0) {
      const groupMembers = [currentId, ...checked];
      // Check if any checked models are already in a group
      let existingGroupId = null;
      for (const memberId of checked) {
        for (const gid of Object.keys(groups)) {
          if (groups[gid].includes(memberId)) {
            existingGroupId = gid;
            break;
          }
        }
        if (existingGroupId) break;
      }

      if (existingGroupId) {
        // Merge into existing group
        const merged = [...new Set([...groups[existingGroupId], ...groupMembers])];
        groups[existingGroupId] = merged;
      } else {
        // Create new group
        groups['group_' + Date.now()] = groupMembers;
      }
    }

    setStorage(STORAGE_KEYS.related, groups);
    document.getElementById('relateModal').style.display = 'none';
    applyFilters();
  }

  function handleAddModel() {
    const id = document.getElementById('addModelId').value.trim();
    if (!id) {
      alert('Model number is required.');
      return;
    }
    if (allModels.some(m => m.id === id)) {
      alert('A model with this number already exists.');
      return;
    }

    const newModel = {
      id: id,
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

    // Save to localStorage added models
    const addedModels = getStorage(STORAGE_KEYS.addedModels, []);
    addedModels.push(newModel);
    setStorage(STORAGE_KEYS.addedModels, addedModels);

    // Add to in-memory list
    allModels.push(newModel);

    // Rebuild filters and apply
    buildFilterChips();
    // Reattach filter chip listeners
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        applyFilters();
      });
    });
    applyFilters();

    // Clear form
    document.getElementById('addModal').style.display = 'none';
    ['addModelId', 'addBrand', 'addNominalSize', 'addWidth', 'addHeight', 'addDepth',
     'addCutoutWidth', 'addCutoutHeight', 'addCutoutDepth', 'addInstallNote', 'addTrim', 'addColor'
    ].forEach(id => document.getElementById(id).value = '');
  }

  // ===== Init =====
  loadData();

})();
