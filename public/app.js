

const STORAGE_KEY = 'webCollector.archive.v1';
const CLIENT_ID_KEY = 'webCollector.clientId';

const state = {
  ws: null,
  wsConnected: false,
  clientId: getOrCreateClientId(),
  activeJobId: null,
  activeUrl: null,
  selectedUrl: null,
};



const el = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),

  searchForm: document.getElementById('searchForm'),
  keywordInput: document.getElementById('keywordInput'),
  searchBtn: document.getElementById('searchBtn'),
  keywordSuggestions: document.getElementById('keywordSuggestions'),
  searchError: document.getElementById('searchError'),
  urlListWrap: document.getElementById('urlListWrap'),
  foundKeyword: document.getElementById('foundKeyword'),
  urlList: document.getElementById('urlList'),

  downloadEmpty: document.getElementById('downloadEmpty'),
  downloadActive: document.getElementById('downloadActive'),
  downloadUrl: document.getElementById('downloadUrl'),
  progressFill: document.getElementById('progressFill'),
  progressPercent: document.getElementById('progressPercent'),
  progressBytes: document.getElementById('progressBytes'),
  progressStatus: document.getElementById('progressStatus'),
  downloadError: document.getElementById('downloadError'),
  downloadDone: document.getElementById('downloadDone'),

  archiveEmpty: document.getElementById('archiveEmpty'),
  archiveList: document.getElementById('archiveList'),

  viewerSection: document.getElementById('viewerSection'),
  viewerTitle: document.getElementById('viewerTitle'),
  viewerMeta: document.getElementById('viewerMeta'),
  viewerFrame: document.getElementById('viewerFrame'),
  viewerRaw: document.getElementById('viewerRaw'),
  viewerDelete: document.getElementById('viewerDelete'),
  viewerClose: document.getElementById('viewerClose'),

  toastRoot: document.getElementById('toastRoot'),
};



function getOrCreateClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'client-' + Date.now() + '-' + Math.random());
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(2)} МБ`;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function showToast(message, kind = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  el.toastRoot.appendChild(node);
  setTimeout(() => node.remove(), 5000);
}

function showElement(node, show) {
  node.hidden = !show;
}



function loadArchive() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Архив повреждён, сбрасываю:', err.message);
    return [];
  }
}

function saveArchive(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch (err) {
    // Скорее всего переполнено хранилище браузера
    showToast('Не удалось сохранить в локальное хранилище: ' + err.message, 'error');
    return false;
  }
}

function addToArchive(entry) {
  const items = loadArchive();
  items.unshift(entry);
  saveArchive(items);
  renderArchive();
}

function removeFromArchive(id) {
  const items = loadArchive().filter((i) => i.id !== id);
  saveArchive(items);
  renderArchive();
}

function renderArchive() {
  const items = loadArchive();
  el.archiveList.innerHTML = '';

  showElement(el.archiveEmpty, items.length === 0);
  showElement(el.archiveList, items.length > 0);

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'archive-item';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.innerHTML = `
      <span class="archive-item-url">${escapeHtml(item.url)}</span>
      <span class="archive-item-meta">${formatDate(item.savedAt)} · ${formatBytes(item.size)} · ${escapeHtml(item.contentType || '')}</span>
    `;
    li.addEventListener('click', () => openViewer(item));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openViewer(item);
      }
    });
    el.archiveList.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}



function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws`;

  let socket;
  try {
    socket = new WebSocket(url);
  } catch (err) {
    setConnectionStatus(false, 'ошибка подключения');
    showToast('Не удалось создать WebSocket-соединение: ' + err.message, 'error');
    return;
  }

  state.ws = socket;

  socket.addEventListener('open', () => {
    setConnectionStatus(true, 'на связи');
    socket.send(JSON.stringify({ type: 'register', clientId: state.clientId }));
  });

  socket.addEventListener('close', () => {
    setConnectionStatus(false, 'соединение потеряно');

    setTimeout(connectWebSocket, 3000);
  });

  socket.addEventListener('error', () => {
    setConnectionStatus(false, 'ошибка соединения');
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      console.warn('Некорректное сообщение от сервера:', err.message);
      return;
    }
    handleServerMessage(msg);
  });
}

function setConnectionStatus(online, text) {
  state.wsConnected = online;
  el.statusDot.classList.toggle('online', online);
  el.statusDot.classList.toggle('offline', !online);
  el.statusText.textContent = text;
}

function handleServerMessage(msg) {
  if (msg.jobId !== state.activeJobId) return; // сообщение не про текущую загрузку

  if (msg.type === 'progress') {
    updateProgressUI(msg);
  } else if (msg.type === 'done') {
    onDownloadComplete(msg);
  } else if (msg.type === 'error') {
    onDownloadError(msg);
  }
}



el.searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const keyword = el.keywordInput.value.trim();

  showElement(el.searchError, false);
  showElement(el.urlListWrap, false);

  if (!keyword) {
    showSearchError('Введите ключевое слово.');
    return;
  }

  el.searchBtn.disabled = true;
  el.searchBtn.textContent = 'Ищу…';

  try {
    const res = await fetch(`/api/keywords/${encodeURIComponent(keyword)}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showSearchError(data.error || `Сервер ответил с ошибкой (${res.status})`);
      return;
    }

    el.foundKeyword.textContent = data.keyword;
    renderUrlList(data.urls);
    showElement(el.urlListWrap, true);
  } catch (err) {
    showSearchError('Не удалось связаться с сервером: ' + err.message);
  } finally {
    el.searchBtn.disabled = false;
    el.searchBtn.textContent = 'Найти';
  }
});

function showSearchError(text) {
  el.searchError.textContent = text;
  showElement(el.searchError, true);
}

function renderUrlList(urls) {
  el.urlList.innerHTML = '';
  for (const url of urls) {
    const li = document.createElement('li');
    li.className = 'url-item';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.innerHTML = `
      <span class="url-item-text">${escapeHtml(url)}</span>
      <span class="url-item-go">скачать →</span>
    `;
    li.addEventListener('click', () => selectUrl(url, li));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectUrl(url, li);
      }
    });
    el.urlList.appendChild(li);
  }
}

function selectUrl(url, liNode) {
  document.querySelectorAll('.url-item.selected').forEach((n) => n.classList.remove('selected'));
  liNode.classList.add('selected');
  state.selectedUrl = url;
  startDownload(url);
}


async function loadKeywordSuggestions() {
  try {
    const res = await fetch('/api/keywords');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;

    el.keywordSuggestions.innerHTML = '';
    for (const kw of data.keywords || []) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'suggestion-chip';
      chip.textContent = kw;
      chip.addEventListener('click', () => {
        el.keywordInput.value = kw;
        el.searchForm.requestSubmit();
      });
      el.keywordSuggestions.appendChild(chip);
    }
  } catch (err) {
    // Подсказки необязательны — тихо игнорируем ошибку
    console.warn('Не удалось загрузить подсказки:', err.message);
  }
}



async function startDownload(url) {
  showElement(el.downloadEmpty, false);
  showElement(el.downloadError, false);
  showElement(el.downloadDone, false);
  showElement(el.downloadActive, true);

  el.downloadUrl.textContent = url;
  el.progressFill.style.width = '0%';
  el.progressPercent.textContent = '0%';
  el.progressBytes.textContent = '0 Б';
  el.progressStatus.textContent = 'отправка запроса…';

  if (!state.wsConnected) {
    onDownloadError({ error: 'Нет соединения с сервером по WebSocket. Дождитесь переподключения и попробуйте снова.' });
    return;
  }

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, clientId: state.clientId }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      onDownloadError({ error: data.error || `Сервер ответил с ошибкой (${res.status})` });
      return;
    }

    state.activeJobId = data.jobId;
    state.activeUrl = url;
    el.progressStatus.textContent = 'загрузка начата…';
  } catch (err) {
    onDownloadError({ error: 'Не удалось отправить запрос на загрузку: ' + err.message });
  }
}

function updateProgressUI(msg) {
  const { loaded, total, progress } = msg;

  if (progress !== null && progress !== undefined) {
    el.progressFill.style.width = `${progress}%`;
    el.progressPercent.textContent = `${progress}%`;
  } else {
    // Размер неизвестен заранее — показываем неопределённый прогресс
    el.progressFill.style.width = '100%';
    el.progressPercent.textContent = '…';
  }

  const bytesText = total
    ? `${formatBytes(loaded)} из ${formatBytes(total)}`
    : `${formatBytes(loaded)} (размер неизвестен)`;
  el.progressBytes.textContent = bytesText;

  el.progressStatus.textContent = msg.status === 'started' ? 'соединение установлено…' : 'идёт загрузка…';
}

function onDownloadComplete(msg) {
  el.progressFill.style.width = '100%';
  el.progressPercent.textContent = '100%';
  el.progressBytes.textContent = formatBytes(msg.size);
  el.progressStatus.textContent = 'готово';

  el.downloadDone.textContent = `Загружено: ${formatBytes(msg.size)}, тип: ${msg.contentType}`;
  showElement(el.downloadDone, true);

  const entry = {
    id: (crypto.randomUUID ? crypto.randomUUID() : 'item-' + Date.now()),
    url: msg.finalUrl || msg.url,
    contentType: msg.contentType,
    size: msg.size,
    content: msg.content,
    savedAt: new Date().toISOString(),
  };

  addToArchive(entry);
  showToast('Сохранено в архив для оффлайн-чтения', 'success');

  state.activeJobId = null;
}

function onDownloadError(msg) {
  showElement(el.downloadActive, true);
  el.progressStatus.textContent = 'ошибка';
  el.downloadError.textContent = msg.error || 'Неизвестная ошибка при загрузке.';
  showElement(el.downloadError, true);
  showToast(msg.error || 'Ошибка загрузки', 'error');
  state.activeJobId = null;
}



function openViewer(item) {
  el.viewerTitle.textContent = item.url;
  el.viewerMeta.textContent = `${formatDate(item.savedAt)} · ${formatBytes(item.size)} · ${item.contentType || 'неизвестный тип'}`;

  // Рендерим в песочнице: скрипты запрещены, чтобы безопасно показывать произвольный сторонний HTML
  const blob = new Blob([item.content], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  el.viewerFrame.src = blobUrl;
  el.viewerFrame.setAttribute('sandbox', 'allow-same-origin');

  el.viewerRaw.onclick = () => {
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(`<pre style="white-space:pre-wrap;word-break:break-word;padding:16px;font-family:monospace;">${escapeHtml(item.content)}</pre>`);
      w.document.title = item.url;
    } else {
      showToast('Браузер заблокировал всплывающее окно. Разрешите всплывающие окна для этой страницы.', 'error');
    }
  };

  el.viewerDelete.onclick = () => {
    removeFromArchive(item.id);
    closeViewer();
    showToast('Удалено из архива', 'success');
  };

  showElement(el.viewerSection, true);
}

function closeViewer() {
  showElement(el.viewerSection, false);
  el.viewerFrame.src = 'about:blank';
}

el.viewerClose.addEventListener('click', closeViewer);
el.viewerSection.addEventListener('click', (e) => {
  if (e.target === el.viewerSection) closeViewer();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.viewerSection.hidden) closeViewer();
});



window.addEventListener('error', (e) => {
  // Глобальный перехват непредвиденных ошибок клиента
  console.error('Необработанная ошибка:', e.error || e.message);
});

connectWebSocket();
loadKeywordSuggestions();
renderArchive();
