/**
 * Main Application Entry Point (ES Module)
 */
import { apiFetch, getApiUrl } from './utils.js';
import { initMediaModule, refreshMediaFiles } from './media.js';
import { initPdfModule } from './pdf.js';
import { initTranscriberModule } from './transcriber.js';

const i18n = window.i18n || { t: (k) => k, ready: Promise.resolve() };
const ACTIVE_TAB_KEY = 'torktool.activeTab';

document.addEventListener('DOMContentLoaded', async () => {
  // Wait for translations to be ready
  await i18n.ready;
  
  // Initialize Modules
  initMediaModule();
  initPdfModule();
  initTranscriberModule();
  
  // Global UI logic
  initTabSystem();
  initAgentStatusSystem();
  initDragAndDrop();
  initAgentModal();
  setLatestStableDownload();
});

function initTabSystem() {
  const navButtons = document.querySelectorAll('.nav-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  function switchTab(tabId) {
    navButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
    tabContents.forEach((content) => content.classList.toggle('active', content.id === tabId));
    localStorage.setItem(ACTIVE_TAB_KEY, tabId);
  }

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  const savedTab = localStorage.getItem(ACTIVE_TAB_KEY);
  if (savedTab) switchTab(savedTab);
}

function initAgentStatusSystem() {
  const statusBar = document.getElementById('backendStatus');
  const statusText = document.getElementById('statusText');
  const modalStatus = document.getElementById('modalStatus');
  const modalStatusText = document.getElementById('modalStatusText');
  const connectBtn = document.getElementById('connectAgentBtn');

  let pollInterval = 5000;
  let timerId = null;
  let isConnectingManually = false;

  async function checkStatus(isManual = false) {
    try {
      const response = await apiFetch('/api/status');
      const data = await response.json();

      const isOnline = data.status === 'online';
      
      // Update UI
      statusBar?.classList.remove('online', 'offline');
      statusBar?.classList.add(isOnline ? 'online' : 'offline');
      
      if (statusText) {
        statusText.textContent = isOnline ? i18n.t('status.online') : i18n.t('status.offline');
      }

      if (isOnline) {
        if (pollInterval !== 5000) console.log('Agent reconnected, restoring fast polling.');
        pollInterval = 5000; 
        await refreshMediaFiles();
        
        isConnectingManually = false;
        
        if (connectBtn && !connectBtn.classList.contains('connected')) {
            updateConnectBtnState('connected');
        }
      } else {
        pollInterval = 30000; 
        if (connectBtn && connectBtn.classList.contains('connected')) {
            updateConnectBtnState('connect');
        }
      }

      if (modalStatus) {
        modalStatus.className = `status-indicator ${isOnline ? 'online' : 'offline'}`;
        if (modalStatusText) modalStatusText.textContent = isOnline ? i18n.t('status.modal_online') : i18n.t('status.modal_offline');
      }
      
      return isOnline;
    } catch (error) {
      statusBar?.classList.remove('online', 'offline');
      statusBar?.classList.add('offline');
      if (statusText) statusText.textContent = i18n.t('status.offline');
      pollInterval = 30000; 
      
      if (connectBtn && (connectBtn.classList.contains('connected') || connectBtn.classList.contains('connecting'))) {
          updateConnectBtnState('connect');
      }
      
      return false;
    } finally {
      if (!isManual) {
        if (timerId) clearTimeout(timerId);
        timerId = setTimeout(() => checkStatus(), pollInterval);
      }
    }
  }

  function updateConnectBtnState(state) {
    if (!connectBtn) return;
    const span = connectBtn.querySelector('span');
    const icon = connectBtn.querySelector('i');

    switch (state) {
      case 'connect':
        connectBtn.disabled = false;
        connectBtn.classList.remove('connecting', 'connected');
        if (span) span.textContent = i18n.t('status.connect');
        if (icon) icon.className = 'fas fa-plug';
        break;
      case 'connecting':
        connectBtn.disabled = true;
        connectBtn.classList.remove('connected');
        connectBtn.classList.add('connecting');
        if (span) span.textContent = i18n.t('status.connecting');
        if (icon) icon.className = 'fas fa-spinner fa-spin';
        break;
      case 'connected':
        connectBtn.disabled = true;
        connectBtn.classList.remove('connecting');
        connectBtn.classList.add('connected');
        if (span) span.textContent = i18n.t('status.connected');
        if (icon) icon.className = 'fas fa-check';
        break;
    }
  }

  connectBtn?.addEventListener('click', async () => {
    if (isConnectingManually) return;
    
    isConnectingManually = true;
    updateConnectBtnState('connecting');

    const maxAttempts = 10; // 20 seconds / 2 seconds
    let attempts = 0;

    const attemptConnection = async () => {
      attempts++;
      const online = await checkStatus(true);
      
      if (online) {
        // Success handled inside checkStatus
        return;
      }

      if (attempts < maxAttempts && isConnectingManually) {
        setTimeout(attemptConnection, 2000);
      } else {
        isConnectingManually = false;
        updateConnectBtnState('connect');
      }
    };

    attemptConnection();
  });

  checkStatus();
}

function initDragAndDrop() {
  const dropOverlay = document.getElementById('dropOverlay');
  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay?.classList.add('active');
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) dropOverlay?.classList.remove('active');
  });

  window.addEventListener('dragover', (e) => e.preventDefault());

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay?.classList.remove('active');
  });
}

function initAgentModal() {
  const modal = document.getElementById('agentModal');
  const openBtn = document.getElementById('openAgentModalBtn');
  const closeBtn = document.getElementById('closeAgentModalBtn');
  const okBtn = document.getElementById('modalOkBtn');

  const toggle = (show) => modal?.classList.toggle('active', show);

  openBtn?.addEventListener('click', () => toggle(true));
  closeBtn?.addEventListener('click', () => toggle(false));
  okBtn?.addEventListener('click', () => toggle(false));

  window.addEventListener('click', (e) => {
    if (e.target === modal) toggle(false);
  });
}

async function setLatestStableDownload() {
  const btn = document.getElementById("download-btn");
  if (!btn) return;

  const repoUrl = "https://github.com/MrtinTrape/Torktool";
  const apiUrl = "https://api.github.com/repos/MrtinTrape/Torktool/releases/latest";

  // Default fallback link to the releases page
  btn.href = `${repoUrl}/releases`;

  try {
    const res = await fetch(apiUrl);

    // Check if the response is actually JSON before parsing
    const contentType = res.headers.get("content-type");
    if (!res.ok || !contentType || !contentType.includes("application/json")) {
      console.warn('Latest release info not available or invalid format, using fallback link.');
      return;
    }

    const release = await res.json();
    if (release && release.assets && Array.isArray(release.assets)) {
      const exe = release.assets.find(a => a.name && a.name.endsWith(".exe"));
      if (exe) {
        btn.href = exe.browser_download_url;
        btn.setAttribute("download", "TorkTool.exe");
      }
    }
  } catch (e) {
    console.warn('Error processing release info:', e.message);
  }
}

