const STORAGE_KEY = 'manyfold_connection';
const cubeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;

let accessToken = null;
let serverUrl = '';
let displayMode = 'grid';
let currentPage = 1;
let searchTimer = null;

// ── Credentials ──────────────────────────────────────────────────────────────

function saveCredentials() {
  const data = {
    url: document.getElementById('server-url').value,
    clientId: document.getElementById('client-id').value,
    clientSecret: document.getElementById('client-secret').value
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadCredentials() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;
    const data = JSON.parse(saved);
    if (data.url) document.getElementById('server-url').value = data.url;
    if (data.clientId) document.getElementById('client-id').value = data.clientId;
    if (data.clientSecret) document.getElementById('client-secret').value = data.clientSecret;
    return !!(data.url && data.clientId && data.clientSecret);
  } catch(e) { return false; }
}

function clearCredentials() {
  localStorage.removeItem(STORAGE_KEY);
  document.getElementById('server-url').value = '';
  document.getElementById('client-id').value = '';
  document.getElementById('client-secret').value = '';
  accessToken = null;
  setStatus('Credentials cleared', 'idle');
}

// ── Connection ────────────────────────────────────────────────────────────────

function setStatus(msg, type) {
  const el = document.getElementById('connect-status');
  el.textContent = msg;
  el.className = `connect-status status-${type}`;
}

async function connect() {
  const url = document.getElementById('server-url').value.replace(/\/$/, '');
  const clientId = document.getElementById('client-id').value.trim();
  const clientSecret = document.getElementById('client-secret').value.trim();

  if (!url || !clientId || !clientSecret) {
    setStatus('Fill in all fields', 'err');
    return;
  }

  serverUrl = url;
  setStatus('Connecting...', 'loading');

  try {
    const resp = await fetch(`${url}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'read public'
      })
    });

    if (!resp.ok) throw new Error(`Auth failed: ${resp.status}`);
    const data = await resp.json();
    accessToken = data.access_token;

    saveCredentials();
    setStatus('Connected', 'ok');
    fetchModels(1);
    fetchCollections();
    fetchCreators();
  } catch(e) {
    setStatus('Connection failed — check credentials', 'err');
    console.error(e);
  }
}

// ── API ───────────────────────────────────────────────────────────────────────

async function apiFetch(path) {
  const resp = await fetch(`${serverUrl}${path}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.manyfold.v0+json'
    }
  });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

async function fetchModels(page = 1) {
  if (!accessToken) return;
  currentPage = page;
  showLoading();

  const q = document.getElementById('search-input').value.trim();
  const order = document.getElementById('sort-select').value;
  let path = `/models?page=${page}&order=${order}`;
  if (q) path += `&search=${encodeURIComponent(q)}`;

  try {
    const data = await apiFetch(path);
    const total = data.totalItems || 0;
    document.getElementById('stat-total').textContent = total.toLocaleString();
    document.getElementById('count-models').textContent = total.toLocaleString();
    renderModels(data.member || []);
    renderPagination(data.view, page);
  } catch(e) {
    showError('Failed to load models — API may still be scanning');
    console.error(e);
  }
}

async function fetchCollections() {
  if (!accessToken) return;
  try {
    const data = await apiFetch('/collections');
    document.getElementById('count-collections').textContent = (data.totalItems || 0).toLocaleString();
  } catch(e) {}
}

async function fetchCreators() {
  if (!accessToken) return;
  try {
    const data = await apiFetch('/creators');
    document.getElementById('count-creators').textContent = (data.totalItems || 0).toLocaleString();
  } catch(e) {}
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function modelId(m) {
  if (typeof m['@id'] === 'string') {
    const parts = m['@id'].split('/');
    return parts[parts.length - 1];
  }
  return m.id || '';
}

function renderModels(models) {
  const content = document.getElementById('content');
  if (models.length === 0) {
    content.innerHTML = `<div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <div class="empty-title">No models found</div>
      <div class="empty-sub">Try a different search term</div>
    </div>`;
    return;
  }

  if (displayMode === 'grid') {
    const cards = models.map(m => {
      const id = modelId(m);
      return `<div class="card" onclick="openModel('${id}')">
        <div class="card-thumb">
          <img src="${serverUrl}/models/${id}/card_image"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
               style="display:block">
          <div style="display:none;width:100%;height:100%;align-items:center;justify-content:center">${cubeIcon}</div>
          <span class="format-badge">3D</span>
        </div>
        <div class="card-body">
          <div class="card-name" title="${(m.name||'').replace(/"/g,'&quot;')}">${m.name||'Unnamed'}</div>
          <div class="card-sub">ID ${id}</div>
        </div>
      </div>`;
    }).join('');
    content.innerHTML = `<div class="grid">${cards}</div>`;
  } else {
    const items = models.map(m => {
      const id = modelId(m);
      return `<div class="list-item" onclick="openModel('${id}')">
        <div class="list-icon">
          <img src="${serverUrl}/models/${id}/card_image"
               onerror="this.style.display='none';this.parentElement.innerHTML='${cubeIcon.replace(/'/g,"\\'").replace(/"/g,'&quot;')}'"
               style="display:block">
        </div>
        <div class="list-info">
          <div class="list-name">${m.name||'Unnamed'}</div>
          <div class="list-meta">ID: ${id}</div>
        </div>
      </div>`;
    }).join('');
    content.innerHTML = `<div class="list">${items}</div>`;
  }
}

function renderPagination(view, page) {
  const existing = document.querySelector('.pagination');
  if (existing) existing.remove();
  if (!view) return;

  const lastUrl = view.last || '';
  const lastMatch = lastUrl.match(/page=(\d+)/);
  const totalPages = lastMatch ? parseInt(lastMatch[1]) : 1;
  document.getElementById('stat-page').textContent = `${page} / ${totalPages}`;

  const pag = document.createElement('div');
  pag.className = 'pagination';

  let html = `<button class="page-btn" onclick="fetchModels(${page-1})" ${page<=1?'disabled':''}>← Prev</button>`;
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  if (start > 1) html += `<button class="page-btn" onclick="fetchModels(1)">1</button><span class="page-info">...</span>`;
  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn${i===page?' active':''}" onclick="fetchModels(${i})">${i}</button>`;
  }
  if (end < totalPages) html += `<span class="page-info">...</span><button class="page-btn" onclick="fetchModels(${totalPages})">${totalPages}</button>`;
  html += `<button class="page-btn" onclick="fetchModels(${page+1})" ${page>=totalPages?'disabled':''}>Next →</button>`;

  pag.innerHTML = html;
  document.querySelector('.content').after(pag);
}

// ── UI Actions ────────────────────────────────────────────────────────────────

function openModel(id) {
  window.open(`${serverUrl}/models/${id}`, '_blank');
}

function setView(v) {
  ['models','collections','creators'].forEach(n => {
    document.getElementById(`nav-${n}`).classList.toggle('active', n===v);
  });
  document.getElementById('toolbar-title').textContent =
    v === 'models' ? 'All Models' : v === 'collections' ? 'Collections' : 'Creators';
  if (v === 'models') fetchModels(1);
  else window.open(`${serverUrl}/${v}`, '_blank');
}

function setDisplayMode(m) {
  displayMode = m;
  document.getElementById('vbtn-grid').classList.toggle('active', m==='grid');
  document.getElementById('vbtn-list').classList.toggle('active', m==='list');
  if (accessToken) fetchModels(currentPage);
}

function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => fetchModels(1), 400);
}

function showLoading() {
  document.getElementById('content').innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const existing = document.querySelector('.pagination');
  if (existing) existing.remove();
}

function showError(msg) {
  document.getElementById('content').innerHTML = `<div class="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <div class="empty-title">Could not load models</div>
    <div class="empty-sub">${msg}</div>
  </div>`;
}

function openProfile() {
  if (serverUrl) window.open(`${serverUrl}/profile`, '_blank');
  else alert('Connect to Manyfold first!');
}

function openSettings() {
  if (serverUrl) window.open(`${serverUrl}/settings`, '_blank');
  else alert('Connect to Manyfold first!');
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  const hasCredentials = loadCredentials();
  if (hasCredentials) {
    setStatus('Saved credentials loaded', 'loading');
    connect();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement.classList.contains('config-input')) {
    connect();
  }
});
