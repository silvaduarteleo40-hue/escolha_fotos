// Foco & Escolha — Lógica Principal (File System Access API + PWA)

const SESSION_FILENAME = '.selecao_ensaio.json';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const state = {
  dirHandle: null,
  folderName: '',
  essayName: '',
  packageLimit: 20,
  extraPrice: 0,
  hideExtraPrice: false,
  photos: [], // [{ name, handle, status: 'none'|'selected'|'maybe', url, index }]
  currentFilter: 'all', // 'all' | 'selected' | 'maybe' | 'unmarked'
  currentView: 'grid', // 'grid' | 'loupe' | 'compare'
  activePhotoName: null,
  compareLeftName: null,
  compareRightName: null,
  isZoomed: false,
  deferredPwaPrompt: null
};

// ==========================================
// INICIALIZAÇÃO E PWA
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  registerServiceWorker();
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPwaPrompt = e;
    const btn = document.getElementById('installPwaBtn');
    btn.classList.remove('hidden');
  });
}

// ==========================================
// EVENTOS DA INTERFACE
// ==========================================
function bindEvents() {
  // Botões de abrir pasta
  document.getElementById('openFolderBtn').addEventListener('click', openPhotoFolder);
  document.getElementById('welcomeOpenFolderBtn').addEventListener('click', openPhotoFolder);

  // Instalar PWA
  document.getElementById('installPwaBtn').addEventListener('click', async () => {
    if (!state.deferredPwaPrompt) return;
    state.deferredPwaPrompt.prompt();
    await state.deferredPwaPrompt.userChoice;
    state.deferredPwaPrompt = null;
    document.getElementById('installPwaBtn').classList.add('hidden');
  });

  // Configurar Ensaio / Pacote
  document.getElementById('configSessionBtn').addEventListener('click', () => openSetupModal(false));
  document.getElementById('closeSetupModalBtn').addEventListener('click', closeSetupModal);
  document.getElementById('cancelSetupBtn').addEventListener('click', () => {
    saveNumberSettingsFromModal();
    closeSetupModal();
    renderAll();
  });
  document.getElementById('applySetupBtn').addEventListener('click', handleApplySetup);

  const essayInput = document.getElementById('essayNameInput');
  essayInput.addEventListener('input', updateRenamePreview);

  // Mostrar/Ocultar preço de extras
  document.getElementById('togglePriceBtn').addEventListener('click', () => {
    state.hideExtraPrice = !state.hideExtraPrice;
    updatePackageWidget();
  });

  // Abas de Filtro (1ª Passada vs 2ª Passada)
  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      setFilter(tab.dataset.filter);
    });
  });

  document.getElementById('resetFilterBtn').addEventListener('click', () => setFilter('all'));

  // Modos de Visualização (Grade / Tela Grande / Comparar)
  document.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
    });
  });

  // Controle de tamanho da grade
  document.getElementById('gridSizeRange').addEventListener('input', (e) => {
    document.getElementById('gridView').style.setProperty('--card-min', `${e.target.value}px`);
  });

  // Ações da Tela Grande (Loupe)
  document.getElementById('loupePrevBtn').addEventListener('click', () => navigatePhoto(-1));
  document.getElementById('loupeNextBtn').addEventListener('click', () => navigatePhoto(1));
  document.getElementById('loupeSelectBtn').addEventListener('click', () => toggleActiveStatus('selected'));
  document.getElementById('loupeMaybeBtn').addEventListener('click', () => toggleActiveStatus('maybe'));
  document.getElementById('loupeCompareBtn').addEventListener('click', startCompareWithActive);
  document.getElementById('loupeZoomBtn').addEventListener('click', toggleLoupeZoom);
  document.getElementById('loupeImage').addEventListener('click', toggleLoupeZoom);
  document.getElementById('loupeBackGridBtn').addEventListener('click', () => setView('grid'));

  // Ações do Modo Comparação Lado a Lado
  document.getElementById('exitCompareBtn').addEventListener('click', () => setView('loupe'));
  document.getElementById('swapLeftBtn').addEventListener('click', () => {
    if (state.compareRightName) {
      state.compareLeftName = state.compareRightName;
      renderCompareView();
    }
  });
  document.getElementById('compareLeftHeartBtn').addEventListener('click', () => {
    if (state.compareLeftName) togglePhotoStatus(state.compareLeftName, 'selected');
  });
  document.getElementById('compareLeftMaybeBtn').addEventListener('click', () => {
    if (state.compareLeftName) togglePhotoStatus(state.compareLeftName, 'maybe');
  });
  document.getElementById('compareRightHeartBtn').addEventListener('click', () => {
    if (state.compareRightName) togglePhotoStatus(state.compareRightName, 'selected');
  });
  document.getElementById('compareRightMaybeBtn').addEventListener('click', () => {
    if (state.compareRightName) togglePhotoStatus(state.compareRightName, 'maybe');
  });

  // Modal Finalizar e Separar
  document.getElementById('finishSelectionBtn').addEventListener('click', openFinishModal);
  document.getElementById('closeFinishModalBtn').addEventListener('click', closeFinishModal);
  document.getElementById('reviewBeforeFinishBtn').addEventListener('click', () => {
    closeFinishModal();
    setFilter('selected');
  });
  document.getElementById('confirmExportBtn').addEventListener('click', executeExportChosenPhotos);

  // Atalhos de Teclado
  window.addEventListener('keydown', handleKeyboardShortcuts);
}

// ==========================================
// ABRIR PASTA E LER IMAGENS
// ==========================================
async function openPhotoFolder() {
  if (!('showDirectoryPicker' in window)) {
    alert(
      'Este navegador não suporta acesso direto a pastas locais.\n\nPor favor, abra no Google Chrome ou Microsoft Edge.'
    );
    return;
  }

  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    state.dirHandle = dirHandle;
    state.folderName = dirHandle.name;

    await loadFolderContents();
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('Não foi possível abrir a pasta selecionada.');
    }
  }
}

async function loadFolderContents() {
  revokeAllUrls();
  const entries = [];

  for await (const entry of state.dirHandle.values()) {
    if (entry.kind === 'file') {
      const ext = getExtension(entry.name);
      if (IMAGE_EXTENSIONS.has(ext)) {
        entries.push(entry);
      }
    }
  }

  entries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );

  state.photos = entries.map((handle, idx) => ({
    name: handle.name,
    handle,
    status: 'none',
    url: null,
    index: idx + 1
  }));

  if (state.photos.length === 0) {
    showToast('Nenhuma imagem JPG ou PNG encontrada nesta pasta.');
    return;
  }

  state.activePhotoName = state.photos[0].name;

  // Tenta carregar sessão salva anteriormente na pasta
  const hadSavedSession = await loadSavedSessionFromFolder();

  // Mostra barras e esconde tela de boas-vindas
  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('packageWidget').classList.remove('hidden');
  document.getElementById('subToolbar').classList.remove('hidden');
  document.getElementById('packageProgressBarWrap').classList.remove('hidden');
  document.getElementById('configSessionBtn').classList.remove('hidden');
  document.getElementById('finishSelectionBtn').classList.remove('hidden');

  renderAll();
  warmUpPhotoUrls();

  // Se for a primeira vez abrindo a pasta, abre o modal para renomear e definir o pacote
  if (!hadSavedSession) {
    openSetupModal(true);
  } else {
    showToast(`Sessão restaurada: ${state.photos.length} fotos carregadas.`);
  }
}

function getExtension(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function sanitizeEssayName(raw) {
  return raw
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_');
}

const decodedImageCache = new Map();

function revokeAllUrls() {
  decodedImageCache.clear();
  for (const p of state.photos) {
    if (p.url) URL.revokeObjectURL(p.url);
  }
}

async function getPhotoUrl(photo) {
  if (photo.url) return photo.url;
  const file = await photo.handle.getFile();
  photo.url = URL.createObjectURL(file);
  return photo.url;
}

// Pré-carrega os ObjectURLs em segundo plano para troca instantânea
async function warmUpPhotoUrls() {
  const snapshot = [...state.photos];
  for (const photo of snapshot) {
    if (!state.dirHandle) break;
    if (!photo.url) {
      try {
        await getPhotoUrl(photo);
      } catch {}
    }
  }
}

// Pré-decodifica as fotos vizinhas na memória da placa de vídeo (0ms de atraso ao passar)
function preloadNeighborImages(filtered, activeIdx) {
  if (filtered.length <= 1) return;
  const offsets = [1, 2, 3, 4, -1, -2];
  const keepNames = new Set([filtered[activeIdx].name]);

  for (const delta of offsets) {
    const idx = (activeIdx + delta + filtered.length) % filtered.length;
    const neighbor = filtered[idx];
    keepNames.add(neighbor.name);

    if (!decodedImageCache.has(neighbor.name)) {
      getPhotoUrl(neighbor).then((url) => {
        const preImg = new Image();
        preImg.decoding = 'async';
        preImg.src = url;
        if (preImg.decode) {
          preImg.decode().catch(() => {});
        }
        decodedImageCache.set(neighbor.name, preImg);
      }).catch(() => {});
    }
  }

  // Limpa fotos distantes do cache de decodificação para não ocupar memória demais
  for (const key of decodedImageCache.keys()) {
    if (!keepNames.has(key)) {
      decodedImageCache.delete(key);
    }
  }
}

// ==========================================
// SALVAR E CARREGAR SESSÃO (.selecao_ensaio.json)
// ==========================================
async function loadSavedSessionFromFolder() {
  try {
    const fileHandle = await state.dirHandle.getFileHandle(SESSION_FILENAME);
    const file = await fileHandle.getFile();
    const data = JSON.parse(await file.text());

    if (data.essayName) state.essayName = data.essayName;
    if (data.packageLimit) state.packageLimit = Number(data.packageLimit) || 20;
    if (data.extraPrice !== undefined) state.extraPrice = Number(data.extraPrice) || 0;

    if (data.statuses && typeof data.statuses === 'object') {
      for (const photo of state.photos) {
        if (data.statuses[photo.name]) {
          photo.status = data.statuses[photo.name];
        }
      }
    }
    return true;
  } catch {
    state.essayName = sanitizeEssayName(state.folderName);
    return false;
  }
}

async function saveSessionToFolder() {
  if (!state.dirHandle) return;
  try {
    const statuses = {};
    for (const p of state.photos) {
      if (p.status !== 'none') {
        statuses[p.name] = p.status;
      }
    }
    const payload = {
      essayName: state.essayName || state.folderName,
      packageLimit: state.packageLimit,
      extraPrice: state.extraPrice,
      updatedAt: new Date().toISOString(),
      statuses
    };
    const fileHandle = await state.dirHandle.getFileHandle(SESSION_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
  } catch {
    // Silencioso caso o sistema bloqueie gravação temporariamente
  }
}

// ==========================================
// MODAL 1: CONFIGURAR ENSAIO E RENOMEAR FOTOS
// ==========================================
function openSetupModal(isFirstOpen = false) {
  const modal = document.getElementById('setupModal');
  document.getElementById('modalFolderName').textContent = state.folderName;
  document.getElementById('modalPhotoCount').textContent = state.photos.length;

  const defaultName = state.essayName || sanitizeEssayName(state.folderName) || 'Ensaio';
  const essayInput = document.getElementById('essayNameInput');
  essayInput.value = defaultName;

  document.getElementById('packageLimitInput').value = state.packageLimit;
  document.getElementById('extraPhotoPriceInput').value = state.extraPrice || '';

  // Verifica se as fotos já começam com esse prefixo
  const cleanPrefix = sanitizeEssayName(defaultName);
  const alreadyRenamed =
    state.photos.length > 0 &&
    state.photos.every((p) => p.name.toLowerCase().startsWith(cleanPrefix.toLowerCase() + '_'));

  const checkbox = document.getElementById('doRenameCheckbox');
  const notice = document.getElementById('alreadyRenamedNotice');

  if (alreadyRenamed || !isFirstOpen) {
    checkbox.checked = false;
  } else {
    checkbox.checked = true;
  }

  notice.classList.toggle('hidden', !alreadyRenamed);
  updateRenamePreview();
  modal.classList.remove('hidden');
}

function closeSetupModal() {
  document.getElementById('setupModal').classList.add('hidden');
}

function updateRenamePreview() {
  const raw = document.getElementById('essayNameInput').value;
  const clean = sanitizeEssayName(raw) || 'Ensaio';
  const ext = state.photos[0] ? getExtension(state.photos[0].name) : '.jpg';
  const pad = Math.max(3, String(state.photos.length).length);
  const ex1 = `${clean}_${String(1).padStart(pad, '0')}${ext}`;
  const ex2 = `${clean}_${String(2).padStart(pad, '0')}${ext}`;
  document.getElementById('renamePreviewText').textContent = `${ex1}, ${ex2}...`;
}

function saveNumberSettingsFromModal() {
  const rawEssay = document.getElementById('essayNameInput').value;
  state.essayName = sanitizeEssayName(rawEssay) || state.folderName;
  state.packageLimit = Math.max(1, parseInt(document.getElementById('packageLimitInput').value, 10) || 20);
  state.extraPrice = Math.max(0, parseFloat(document.getElementById('extraPhotoPriceInput').value) || 0);
}

async function handleApplySetup() {
  saveNumberSettingsFromModal();
  const shouldRename = document.getElementById('doRenameCheckbox').checked;

  const btn = document.getElementById('applySetupBtn');
  btn.disabled = true;
  btn.textContent = 'Processando...';

  try {
    if (shouldRename && state.photos.length > 0) {
      await renamePhotosInFolder(state.essayName);
    }
    await saveSessionToFolder();
    closeSetupModal();
    renderAll();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar e Começar Escolha';
  }
}

async function renamePhotosInFolder(prefix) {
  const pad = Math.max(3, String(state.photos.length).length);
  const existingNames = new Set(state.photos.map((p) => p.name));
  let renamedCount = 0;

  for (let i = 0; i < state.photos.length; i++) {
    const photo = state.photos[i];
    const ext = getExtension(photo.name);
    const targetName = `${prefix}_${String(i + 1).padStart(pad, '0')}${ext}`;

    if (photo.name === targetName) continue;
    if (existingNames.has(targetName)) continue; // Evita colisão

    try {
      const oldName = photo.name;
      if (typeof photo.handle.move === 'function') {
        await photo.handle.move(targetName);
      } else {
        // Fallback seguro: copia para o novo nome e remove o antigo
        const srcFile = await photo.handle.getFile();
        const newHandle = await state.dirHandle.getFileHandle(targetName, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(await srcFile.arrayBuffer());
        await writable.close();
        await state.dirHandle.removeEntry(oldName);
        photo.handle = newHandle;
      }

      existingNames.delete(oldName);
      existingNames.add(targetName);

      if (state.activePhotoName === oldName) state.activePhotoName = targetName;
      if (state.compareLeftName === oldName) state.compareLeftName = targetName;
      if (state.compareRightName === oldName) state.compareRightName = targetName;

      photo.name = targetName;
      renamedCount++;
    } catch (err) {
      console.error('Erro ao renomear:', photo.name, err);
    }
  }

  if (renamedCount > 0) {
    showToast(`✨ ${renamedCount} fotos renomeadas para ${prefix}!`);
  }
}

// ==========================================
// CONTROLE DE ESCOLHA, PACOTE E FILTROS
// ==========================================
function getFilteredPhotos() {
  return state.photos.filter((p) => {
    if (state.currentFilter === 'selected') return p.status === 'selected';
    if (state.currentFilter === 'maybe') return p.status === 'maybe';
    if (state.currentFilter === 'unmarked') return p.status === 'none';
    return true;
  });
}

function setFilter(filter) {
  state.currentFilter = filter;
  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.filter === filter);
  });

  const list = getFilteredPhotos();
  if (list.length > 0 && !list.some((p) => p.name === state.activePhotoName)) {
    state.activePhotoName = list[0].name;
  }

  renderAll();
}

function setView(view) {
  state.currentView = view;
  state.isZoomed = false;
  document.getElementById('loupeImageContainer').classList.remove('zoomed');

  document.querySelectorAll('.view-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  document.getElementById('gridSizeControl').classList.toggle('hidden', view !== 'grid');

  if (view === 'compare') {
    const list = getFilteredPhotos();
    if (!state.compareLeftName && state.activePhotoName) {
      state.compareLeftName = state.activePhotoName;
    }
    if (!state.compareRightName && list.length > 1) {
      const nextCandidate = list.find((p) => p.name !== state.compareLeftName) || list[0];
      state.compareRightName = nextCandidate.name;
    }
  }

  renderAll();
}

function togglePhotoStatus(photoName, targetStatus) {
  const photo = state.photos.find((p) => p.name === photoName);
  if (!photo) return;

  const previousStatus = photo.status;
  photo.status = photo.status === targetStatus ? 'none' : targetStatus;

  // Notificação discreta quando atinge ou ultrapassa o pacote
  const selectedCount = state.photos.filter((p) => p.status === 'selected').length;
  if (photo.status === 'selected' && previousStatus !== 'selected') {
    if (selectedCount === state.packageLimit) {
      showToast(`🎯 Limite do pacote atingido (${state.packageLimit} fotos)! As próximas serão Fotos Extras.`);
    } else if (selectedCount === state.packageLimit + 1) {
      showToast(`✨ +1 Foto Extra adicionada além do pacote!`);
    }
  }

  saveSessionToFolder();
  renderAll();
}

function toggleActiveStatus(targetStatus) {
  if (!state.activePhotoName) return;
  togglePhotoStatus(state.activePhotoName, targetStatus);
}

// ==========================================
// RENDERIZAÇÃO GERAL
// ==========================================
function renderAll() {
  if (!state.dirHandle) return;

  document.getElementById('sessionNameLabel').textContent =
    `${state.essayName || state.folderName} • ${state.photos.length} fotos`;

  updateCountsAndTabs();
  updatePackageWidget();

  const filtered = getFilteredPhotos();
  const isEmpty = filtered.length === 0;

  document.getElementById('emptyFilterState').classList.toggle('hidden', !isEmpty);
  document.getElementById('gridView').classList.toggle('hidden', isEmpty || state.currentView !== 'grid');
  document.getElementById('loupeView').classList.toggle('hidden', isEmpty || state.currentView !== 'loupe');
  document.getElementById('compareView').classList.toggle('hidden', isEmpty || state.currentView !== 'compare');

  if (isEmpty) return;

  if (state.currentView === 'grid') {
    renderGridView(filtered);
  } else if (state.currentView === 'loupe') {
    renderLoupeView(filtered);
  } else if (state.currentView === 'compare') {
    renderCompareView(filtered);
  }
}

function updateCountsAndTabs() {
  const total = state.photos.length;
  const selected = state.photos.filter((p) => p.status === 'selected').length;
  const maybe = state.photos.filter((p) => p.status === 'maybe').length;
  const unmarked = total - selected - maybe;

  document.getElementById('countAll').textContent = total;
  document.getElementById('countSelected').textContent = selected;
  document.getElementById('countMaybe').textContent = maybe;
  document.getElementById('countUnmarked').textContent = unmarked;
}

function updatePackageWidget() {
  const selected = state.photos.filter((p) => p.status === 'selected').length;
  const limit = state.packageLimit;
  const extras = Math.max(0, selected - limit);
  const remaining = Math.max(0, limit - selected);

  document.getElementById('pkgLimitValue').textContent = limit;
  document.getElementById('pkgSelectedValue').textContent = selected;

  const balanceLabel = document.getElementById('pkgBalanceLabel');
  const balanceValue = document.getElementById('pkgBalanceValue');

  if (extras > 0) {
    balanceLabel.textContent = 'Fotos Extras ✨';
    balanceValue.textContent = `+${extras}`;
    balanceValue.className = 'pkg-number highlight-extra';
  } else {
    balanceLabel.textContent = 'Restam no Pacote';
    balanceValue.textContent = remaining;
    balanceValue.className = 'pkg-number';
  }

  // Valor das fotos extras (se configurado)
  const priceBox = document.getElementById('pkgExtraPriceBox');
  if (state.extraPrice > 0) {
    priceBox.classList.remove('hidden');
    const totalExtraVal = extras * state.extraPrice;
    document.getElementById('pkgExtraPriceValue').textContent = state.hideExtraPrice
      ? 'R$ •••'
      : formatCurrency(totalExtraVal);
  } else {
    priceBox.classList.add('hidden');
  }

  // Barra de progresso visual
  const bar = document.getElementById('packageProgressBar');
  const pct = limit > 0 ? Math.min(100, Math.round((selected / limit) * 100)) : 0;
  bar.style.width = `${pct}%`;
  bar.classList.toggle('over-limit', extras > 0);
}

function formatCurrency(val) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ==========================================
// RENDERIZAR GRADE (GRID VIEW)
// ==========================================
function renderGridView(filtered) {
  const container = document.getElementById('gridView');
  container.innerHTML = '';

  for (const photo of filtered) {
    const card = document.createElement('div');
    card.className = `photo-card ${
      photo.status === 'selected' ? 'is-selected' : photo.status === 'maybe' ? 'is-maybe' : ''
    }`;

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'card-thumb-wrap';
    thumbWrap.title = 'Clique para abrir em Tela Grande';

    const img = document.createElement('img');
    img.alt = photo.name;
    img.loading = 'lazy';
    getPhotoUrl(photo).then((url) => {
      img.src = url;
    });

    const idxTag = document.createElement('span');
    idxTag.className = 'card-index-tag';
    idxTag.textContent = `#${String(photo.index).padStart(3, '0')}`;

    thumbWrap.appendChild(img);
    thumbWrap.appendChild(idxTag);

    if (photo.status === 'selected') {
      const pill = document.createElement('span');
      pill.className = 'card-status-pill pill-selected';
      pill.textContent = '❤️ Escolhida';
      thumbWrap.appendChild(pill);
    } else if (photo.status === 'maybe') {
      const pill = document.createElement('span');
      pill.className = 'card-status-pill pill-maybe';
      pill.textContent = '⭐ Dúvida';
      thumbWrap.appendChild(pill);
    }

    thumbWrap.addEventListener('click', () => {
      state.activePhotoName = photo.name;
      setView('loupe');
    });

    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'card-filename';
    nameSpan.textContent = photo.name;
    nameSpan.title = photo.name;

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    // Botão ❤️
    const heartBtn = document.createElement('button');
    heartBtn.className = `card-action-btn ${photo.status === 'selected' ? 'active-heart' : ''}`;
    heartBtn.title = 'Escolher foto (❤️)';
    heartBtn.textContent = '❤️';
    heartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePhotoStatus(photo.name, 'selected');
    });

    // Botão ⭐
    const maybeBtn = document.createElement('button');
    maybeBtn.className = `card-action-btn ${photo.status === 'maybe' ? 'active-maybe' : ''}`;
    maybeBtn.title = 'Marcar como Dúvida (⭐)';
    maybeBtn.textContent = '⭐';
    maybeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePhotoStatus(photo.name, 'maybe');
    });

    // Botão ⚖️ Comparar
    const cmpBtn = document.createElement('button');
    cmpBtn.className = 'card-action-btn';
    cmpBtn.title = 'Comparar lado a lado';
    cmpBtn.textContent = '⚖️';
    cmpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.compareLeftName = photo.name;
      state.activePhotoName = photo.name;
      setView('compare');
    });

    actions.appendChild(heartBtn);
    actions.appendChild(maybeBtn);
    actions.appendChild(cmpBtn);

    footer.appendChild(nameSpan);
    footer.appendChild(actions);

    card.appendChild(thumbWrap);
    card.appendChild(footer);
    container.appendChild(card);
  }
}

// ==========================================
// RENDERIZAR TELA GRANDE (LOUPE VIEW)
// ==========================================
function renderLoupeView(filtered) {
  let activeIdx = filtered.findIndex((p) => p.name === state.activePhotoName);
  if (activeIdx === -1) {
    activeIdx = 0;
    state.activePhotoName = filtered[0].name;
  }
  const photo = filtered[activeIdx];

  const mainImg = document.getElementById('loupeImage');
  if (photo.url) {
    if (mainImg.src !== photo.url) {
      mainImg.src = photo.url;
    }
  } else {
    getPhotoUrl(photo).then((url) => {
      if (state.activePhotoName === photo.name) {
        mainImg.src = url;
      }
    });
  }

  // Pré-carrega e decodifica as próximas fotos e as anteriores na memória
  preloadNeighborImages(filtered, activeIdx);

  document.getElementById('loupePositionText').textContent = `${activeIdx + 1} de ${filtered.length}`;
  document.getElementById('loupeFilenameText').textContent = photo.name;

  // Badge superior
  const badge = document.getElementById('loupeStatusBadge');
  if (photo.status === 'selected') {
    badge.textContent = '❤️ ESCOLHIDA';
    badge.className = 'loupe-status-badge pill-selected';
  } else if (photo.status === 'maybe') {
    badge.textContent = '⭐ EM DÚVIDA';
    badge.className = 'loupe-status-badge pill-maybe';
  } else {
    badge.className = 'loupe-status-badge hidden';
  }

  // Botões da barra inferior
  const selectBtn = document.getElementById('loupeSelectBtn');
  const selectText = document.getElementById('loupeSelectBtnText');
  selectBtn.classList.toggle('active-heart', photo.status === 'selected');
  selectText.textContent = photo.status === 'selected' ? 'Escolhida (Remover)' : 'Escolher Foto';

  const maybeBtn = document.getElementById('loupeMaybeBtn');
  maybeBtn.classList.toggle('active-maybe', photo.status === 'maybe');
}

function navigatePhoto(delta) {
  const filtered = getFilteredPhotos();
  if (filtered.length === 0) return;

  if (state.currentView === 'compare') {
    let idx = filtered.findIndex((p) => p.name === state.compareRightName);
    idx = (idx + delta + filtered.length) % filtered.length;
    state.compareRightName = filtered[idx].name;
    renderCompareView(filtered);
    return;
  }

  let idx = filtered.findIndex((p) => p.name === state.activePhotoName);
  idx = (idx + delta + filtered.length) % filtered.length;
  state.activePhotoName = filtered[idx].name;
  state.isZoomed = false;
  document.getElementById('loupeImageContainer').classList.remove('zoomed');
  renderLoupeView(filtered);
}

function toggleLoupeZoom() {
  state.isZoomed = !state.isZoomed;
  document.getElementById('loupeImageContainer').classList.toggle('zoomed', state.isZoomed);
}

function startCompareWithActive() {
  state.compareLeftName = state.activePhotoName;
  setView('compare');
}

// ==========================================
// RENDERIZAR COMPARAÇÃO LADO A LADO
// ==========================================
function renderCompareView(filtered = getFilteredPhotos()) {
  if (filtered.length === 0) return;

  let leftPhoto = state.photos.find((p) => p.name === state.compareLeftName) || filtered[0];
  state.compareLeftName = leftPhoto.name;

  let rightPhoto =
    state.photos.find((p) => p.name === state.compareRightName) ||
    filtered.find((p) => p.name !== leftPhoto.name) ||
    leftPhoto;
  state.compareRightName = rightPhoto.name;

  // Painel Esquerdo (Foto A)
  document.getElementById('compareLeftName').textContent = leftPhoto.name;
  const leftImg = document.getElementById('compareLeftImg');
  getPhotoUrl(leftPhoto).then((url) => (leftImg.src = url));
  updateComparePaneControls(leftPhoto, 'compareLeftBadge', 'compareLeftHeartBtn', 'compareLeftMaybeBtn');

  // Painel Direito (Foto B)
  document.getElementById('compareRightName').textContent = rightPhoto.name;
  const rightImg = document.getElementById('compareRightImg');
  getPhotoUrl(rightPhoto).then((url) => (rightImg.src = url));
  updateComparePaneControls(rightPhoto, 'compareRightBadge', 'compareRightHeartBtn', 'compareRightMaybeBtn');

  renderFilmstrip('compareFilmstrip', filtered, rightPhoto.name, (clickedPhoto) => {
    state.compareRightName = clickedPhoto.name;
    renderCompareView(filtered);
  });
}

function updateComparePaneControls(photo, badgeId, heartBtnId, maybeBtnId) {
  const badge = document.getElementById(badgeId);
  if (photo.status === 'selected') {
    badge.textContent = '❤️ ESCOLHIDA';
    badge.className = 'loupe-status-badge pill-selected';
  } else if (photo.status === 'maybe') {
    badge.textContent = '⭐ EM DÚVIDA';
    badge.className = 'loupe-status-badge pill-maybe';
  } else {
    badge.className = 'loupe-status-badge hidden';
  }

  document.getElementById(heartBtnId).classList.toggle('active-heart', photo.status === 'selected');
  document.getElementById(maybeBtnId).classList.toggle('active-maybe', photo.status === 'maybe');
}

function renderFilmstrip(containerId, list, activeName, onSelect) {
  const strip = document.getElementById(containerId);
  strip.innerHTML = '';

  for (const photo of list) {
    const thumb = document.createElement('div');
    thumb.className = `strip-thumb ${photo.name === activeName ? 'active' : ''} ${
      photo.status === 'selected' ? 'is-selected' : ''
    }`;

    const img = document.createElement('img');
    img.loading = 'lazy';
    getPhotoUrl(photo).then((url) => (img.src = url));

    thumb.appendChild(img);

    if (photo.status !== 'none') {
      const dot = document.createElement('span');
      dot.className = 'strip-dot';
      dot.textContent = photo.status === 'selected' ? '❤️' : '⭐';
      thumb.appendChild(dot);
    }

    thumb.addEventListener('click', () => onSelect(photo));
    strip.appendChild(thumb);

    if (photo.name === activeName) {
      requestAnimationFrame(() => {
        thumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      });
    }
  }
}

// ==========================================
// MODAL 2: FINALIZAR E SEPARAR NA PASTA "ESCOLHIDAS"
// ==========================================
function openFinishModal() {
  const selected = state.photos.filter((p) => p.status === 'selected');
  if (selected.length === 0) {
    showToast('Marque pelo menos 1 foto com ❤️ antes de finalizar.');
    return;
  }

  const total = state.photos.length;
  const limit = state.packageLimit;
  const extras = Math.max(0, selected.length - limit);

  document.getElementById('finTotalCount').textContent = total;
  document.getElementById('finSelectedCount').textContent = selected.length;
  document.getElementById('finPackageLimit').textContent = limit;
  document.getElementById('finExtrasCount').textContent = extras > 0 ? `+${extras}` : '0';

  const valBanner = document.getElementById('finExtraValueBanner');
  if (extras > 0 && state.extraPrice > 0) {
    valBanner.classList.remove('hidden');
    document.getElementById('finExtraTotalValue').textContent = formatCurrency(extras * state.extraPrice);
  } else {
    valBanner.classList.add('hidden');
  }

  const underBanner = document.getElementById('finWarningUnderPackage');
  underBanner.classList.toggle('hidden', selected.length >= limit);
  if (selected.length < limit) {
    underBanner.textContent = `⚠️ O cliente escolheu ${selected.length} fotos (faltam ${
      limit - selected.length
    } para completar o pacote de ${limit}).`;
  }

  document.getElementById('exportProgressBox').classList.add('hidden');
  document.getElementById('finishModal').classList.remove('hidden');
}

function closeFinishModal() {
  document.getElementById('finishModal').classList.add('hidden');
}

async function executeExportChosenPhotos() {
  const selected = state.photos.filter((p) => p.status === 'selected');
  if (selected.length === 0) return;

  const mode = document.querySelector('input[name="exportMode"]:checked').value; // 'move' | 'copy'
  const createReport = document.getElementById('generateReportCheckbox').checked;

  const confirmBtn = document.getElementById('confirmExportBtn');
  const progressBox = document.getElementById('exportProgressBox');
  const progressText = document.getElementById('exportProgressText');
  const progressBar = document.getElementById('exportProgressBar');

  confirmBtn.disabled = true;
  progressBox.classList.remove('hidden');

  try {
    const escolhidasDir = await state.dirHandle.getDirectoryHandle('Escolhidas', { create: true });

    for (let i = 0; i < selected.length; i++) {
      const photo = selected[i];
      const pct = Math.round(((i + 1) / selected.length) * 100);
      progressText.textContent = `${mode === 'move' ? 'Movendo' : 'Copiando'} ${i + 1} de ${selected.length}: ${photo.name}`;
      progressBar.style.width = `${pct}%`;

      // Copia o arquivo para a subpasta Escolhidas
      const srcFile = await photo.handle.getFile();
      const destHandle = await escolhidasDir.getFileHandle(photo.name, { create: true });
      const writable = await destHandle.createWritable();
      await writable.write(await srcFile.arrayBuffer());
      await writable.close();

      // Se escolheu Mover, remove da pasta raiz após gravar com sucesso em Escolhidas
      if (mode === 'move') {
        await state.dirHandle.removeEntry(photo.name);
      }
    }

    if (createReport) {
      const pdfBytes = buildReportPdfBytes(selected);
      const reportName = `Resumo_${state.essayName || 'Escolha'}.pdf`;

      // Salva o PDF na pasta principal e dentro de Escolhidas
      for (const dir of [state.dirHandle, escolhidasDir]) {
        const repHandle = await dir.getFileHandle(reportName, { create: true });
        const w = await repHandle.createWritable();
        await w.write(pdfBytes);
        await w.close();
      }
    }

    showToast(`🎉 Sucesso! ${selected.length} fotos e o Resumo em PDF foram salvos na pasta "Escolhidas"!`);
    closeFinishModal();
    resetToWelcomeScreen();
  } catch (err) {
    console.error('Erro ao separar fotos:', err);
    showToast('Erro ao separar algumas fotos. Verifique se algum arquivo está aberto em outro programa.');
  } finally {
    confirmBtn.disabled = false;
  }
}

function resetToWelcomeScreen() {
  revokeAllUrls();
  state.dirHandle = null;
  state.folderName = '';
  state.essayName = '';
  state.photos = [];
  state.currentFilter = 'all';
  state.currentView = 'grid';
  state.activePhotoName = null;
  state.compareLeftName = null;
  state.compareRightName = null;
  state.isZoomed = false;

  document.getElementById('sessionNameLabel').textContent = 'Nenhum ensaio aberto';
  document.getElementById('gridView').innerHTML = '';
  document.getElementById('compareFilmstrip').innerHTML = '';

  document.getElementById('packageWidget').classList.add('hidden');
  document.getElementById('subToolbar').classList.add('hidden');
  document.getElementById('packageProgressBarWrap').classList.add('hidden');
  document.getElementById('configSessionBtn').classList.add('hidden');
  document.getElementById('finishSelectionBtn').classList.add('hidden');

  document.getElementById('emptyFilterState').classList.add('hidden');
  document.getElementById('gridView').classList.add('hidden');
  document.getElementById('loupeView').classList.add('hidden');
  document.getElementById('compareView').classList.add('hidden');

  document.getElementById('welcomeScreen').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// GERADOR DE PDF NATIVO (100% OFFLINE / A4)
// ==========================================
function pdfEscapeWinAnsi(str) {
  const win1252Extra = {
    0x20ac: 128, 0x201a: 130, 0x0192: 131, 0x201e: 132, 0x2026: 133,
    0x2020: 134, 0x2021: 135, 0x02c6: 136, 0x2030: 137, 0x0160: 138,
    0x2039: 139, 0x0152: 140, 0x017d: 142, 0x2018: 145, 0x2019: 146,
    0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151,
    0x02dc: 152, 0x2122: 153, 0x0161: 154, 0x203a: 155, 0x0153: 156,
    0x017e: 158, 0x0178: 159
  };

  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 40 || code === 41 || code === 92) {
      out += '\\' + str[i];
    } else if (code >= 32 && code <= 126) {
      out += str[i];
    } else if (code >= 160 && code <= 255) {
      out += '\\' + code.toString(8).padStart(3, '0');
    } else if (win1252Extra[code]) {
      out += '\\' + win1252Extra[code].toString(8).padStart(3, '0');
    } else {
      out += '?';
    }
  }
  return out;
}

function buildReportPdfBytes(selectedPhotos) {
  const limit = state.packageLimit;
  const extras = Math.max(0, selectedPhotos.length - limit);
  const essayTitle = state.essayName || state.folderName || 'Ensaio';
  const dateStr = new Date().toLocaleString('pt-BR');
  const hasPrice = state.extraPrice > 0;
  const totalExtraCurrency = formatCurrency(extras * state.extraPrice);
  const unitExtraCurrency = formatCurrency(state.extraPrice);

  // Paginação das fotos (Página 1 comporta 20 linhas; demais páginas comportam 30 linhas)
  const firstPageMax = hasPrice ? 19 : 21;
  const nextPageMax = 30;
  const pagesRows = [];

  if (selectedPhotos.length <= firstPageMax) {
    pagesRows.push(selectedPhotos.map((p, i) => ({ photo: p, num: i + 1 })));
  } else {
    pagesRows.push(
      selectedPhotos.slice(0, firstPageMax).map((p, i) => ({ photo: p, num: i + 1 }))
    );
    let offset = firstPageMax;
    while (offset < selectedPhotos.length) {
      const chunk = selectedPhotos
        .slice(offset, offset + nextPageMax)
        .map((p, idx) => ({ photo: p, num: offset + idx + 1 }));
      pagesRows.push(chunk);
      offset += nextPageMax;
    }
  }

  const totalPages = pagesRows.length;
  const pageContents = [];

  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const rows = pagesRows[pIdx];
    const ops = [];

    const drawRect = (x, y, w, h, r, g, b) => {
      ops.push(`${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f`);
    };
    const drawStrokeRect = (x, y, w, h, r, g, b) => {
      ops.push(`${r} ${g} ${b} RG 0.8 w ${x} ${y} ${w} ${h} re S`);
    };
    const drawText = (text, x, y, size = 10, bold = false, r = 0.1, g = 0.1, b = 0.12) => {
      const font = bold ? '/F2' : '/F1';
      ops.push(
        `BT ${font} ${size} Tf ${r} ${g} ${b} rg 1 0 0 1 ${x} ${y} Tm (${pdfEscapeWinAnsi(
          String(text)
        )}) Tj ET`
      );
    };

    // Cabeçalho Escuro (Topo da folha A4: 595 x 842)
    drawRect(0, 762, 595, 80, 0.09, 0.09, 0.11);
    drawText('FOCO & ESCOLHA — RESUMO DE SELEÇÃO DE FOTOS', 40, 808, 13, true, 1, 1, 1);
    drawText(`Ensaio: ${essayTitle}`, 40, 786, 11, false, 0.82, 0.82, 0.88);
    drawText(`Data: ${dateStr}`, 400, 786, 9.5, false, 0.75, 0.75, 0.8);

    let cursorY = 735;

    if (pIdx === 0) {
      // 4 Cartões de Resumo na Página 1
      const cards = [
        { label: 'TOTAL DO ENSAIO', val: `${state.photos.length} fotos`, accent: [0.2, 0.2, 0.25] },
        { label: 'PACOTE CONTRATADO', val: `${limit} fotos`, accent: [0.25, 0.28, 0.75] },
        { label: 'TOTAL ESCOLHIDAS', val: `${selectedPhotos.length} fotos`, accent: [0.88, 0.18, 0.35] },
        {
          label: 'FOTOS EXTRAS',
          val: extras > 0 ? `+${extras} extras` : '0 extras',
          accent: extras > 0 ? [0.85, 0.48, 0.05] : [0.08, 0.6, 0.4]
        }
      ];

      cards.forEach((c, i) => {
        const cx = 40 + i * 131;
        const cy = 678;
        drawRect(cx, cy, 122, 52, 0.96, 0.96, 0.98);
        drawStrokeRect(cx, cy, 122, 52, 0.85, 0.85, 0.9);
        drawText(c.label, cx + 10, cy + 34, 7.5, true, 0.45, 0.45, 0.5);
        drawText(c.val, cx + 10, cy + 14, 13, true, c.accent[0], c.accent[1], c.accent[2]);
      });

      cursorY = 656;

      // Faixa de Valor de Fotos Extras (se configurado)
      if (hasPrice) {
        drawRect(40, cursorY - 30, 515, 28, 1.0, 0.96, 0.88);
        drawStrokeRect(40, cursorY - 30, 515, 28, 0.95, 0.75, 0.35);
        drawText(
          `Valor por Foto Extra: ${unitExtraCurrency}   |   Total em Fotos Extras (${extras}): ${totalExtraCurrency}`,
          52,
          cursorY - 19,
          10,
          true,
          0.55,
          0.32,
          0.04
        );
        cursorY -= 44;
      } else {
        cursorY -= 8;
      }
    }

    // Cabeçalho da Tabela de Fotos
    drawRect(40, cursorY - 22, 515, 22, 0.16, 0.16, 0.2);
    drawText('Nº', 52, cursorY - 15, 9, true, 1, 1, 1);
    drawText('ARQUIVO DA FOTO ESCOLHIDA', 100, cursorY - 15, 9, true, 1, 1, 1);
    drawText('SITUAÇÃO NO PACOTE', 415, cursorY - 15, 9, true, 1, 1, 1);
    cursorY -= 22;

    // Linhas das Fotos
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const item = rows[rIdx];
      const rowY = cursorY - 20;
      const isExtra = item.num > limit;

      if (rIdx % 2 === 0) {
        drawRect(40, rowY, 515, 20, 0.97, 0.97, 0.99);
      } else {
        drawRect(40, rowY, 515, 20, 1, 1, 1);
      }

      drawText(String(item.num).padStart(3, '0'), 52, rowY + 6, 9.5, true, 0.25, 0.25, 0.3);
      drawText(item.photo.name, 100, rowY + 6, 9.5, false, 0.1, 0.1, 0.14);

      if (isExtra) {
        drawText('FOTO EXTRA', 415, rowY + 6, 8.5, true, 0.85, 0.38, 0.05);
      } else {
        drawText('Inclusa no Pacote', 415, rowY + 6, 8.5, false, 0.08, 0.55, 0.38);
      }

      cursorY = rowY;
    }

    // Linha de Assinatura na última página
    if (pIdx === totalPages - 1 && cursorY > 95) {
      const sigY = Math.min(cursorY - 38, 95);
      ops.push(`0.7 0.7 0.75 RG 0.8 w 40 ${sigY} m 260 ${sigY} l S`);
      ops.push(`0.7 0.7 0.75 RG 0.8 w 335 ${sigY} m 555 ${sigY} l S`);
      drawText('Confirmação do(a) Cliente', 95, sigY - 13, 8.5, false, 0.45, 0.45, 0.5);
      drawText('Responsável pelo Estúdio', 392, sigY - 13, 8.5, false, 0.45, 0.45, 0.5);
    }

    // Rodapé da Página
    drawText(
      `Gerado pelo sistema Foco & Escolha • Página ${pIdx + 1} de ${totalPages}`,
      40,
      28,
      8.5,
      false,
      0.5,
      0.5,
      0.55
    );

    pageContents.push(ops.join('\n'));
  }

  // Montagem da estrutura PDF 1.4
  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length;
  };

  const fontRegularId = addObj(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  const fontBoldId = addObj(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  );

  const pagesRootId = addObj(''); // Placeholder para /Pages
  const pageIds = [];

  for (const stream of pageContents) {
    const contentId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[pagesRootId - 1] = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(' ')}] /Count ${pageIds.length} >>`;

  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesRootId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

// ==========================================
// ATALHOS DE TECLADO
// ==========================================
function handleKeyboardShortcuts(e) {
  // Não intercepta teclas se estiver digitando em um input ou com modal aberto
  if (
    e.target.tagName === 'INPUT' ||
    e.target.tagName === 'TEXTAREA' ||
    !document.getElementById('setupModal').classList.contains('hidden') ||
    !document.getElementById('finishModal').classList.contains('hidden') ||
    !state.dirHandle
  ) {
    return;
  }

  const key = e.key.toLowerCase();

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (state.currentView === 'grid') setView('loupe');
    else navigatePhoto(1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (state.currentView === 'grid') setView('loupe');
    else navigatePhoto(-1);
  } else if (e.key === ' ' || key === 'f') {
    e.preventDefault();
    if (state.currentView === 'compare' && state.compareRightName) {
      togglePhotoStatus(state.compareRightName, 'selected');
    } else {
      toggleActiveStatus('selected');
    }
  } else if (key === 'd') {
    e.preventDefault();
    if (state.currentView === 'compare' && state.compareRightName) {
      togglePhotoStatus(state.compareRightName, 'maybe');
    } else {
      toggleActiveStatus('maybe');
    }
  } else if (key === 'g' || e.key === 'Escape') {
    e.preventDefault();
    setView('grid');
  } else if (key === '1' || e.key === 'Enter') {
    e.preventDefault();
    setView('loupe');
  } else if (key === 'c') {
    e.preventDefault();
    startCompareWithActive();
  } else if (key === 'z' && state.currentView === 'loupe') {
    e.preventDefault();
    toggleLoupeZoom();
  }
}

// ==========================================
// NOTIFICAÇÕES TOAST
// ==========================================
function showToast(message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3800);
}

