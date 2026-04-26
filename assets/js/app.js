/**
 * Main Application Entry Point (ES Module)
 */
import { i18n, applyTranslations } from './i18n-loader.js';
import { apiFetch, getApiUrl } from './utils.js';
import { initMediaModule, refreshMediaFiles } from './media.js';
import { initPdfModule } from './pdf.js';
import { initTranscriberModule } from './transcriber.js';

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
  const statusDot = document.getElementById('status-dot');
  const modalStatus = document.getElementById('modalStatus');
  const modalStatusText = document.getElementById('modalStatusText');

  async function checkStatus() {
    try {
      const response = await apiFetch('/api/status');
      const data = await response.json();

      const isOnline = data.status === 'online';
      statusBar?.classList.remove('online', 'offline');
      statusBar?.classList.add(isOnline ? 'online' : 'offline');

      
      if (statusText) {
        statusText.textContent = isOnline ? i18n.t('status.online') : i18n.t('status.offline');
      }

      if (isOnline) {
        console.log('Backend is online');
        await refreshMediaFiles();
      }
      if (modalStatus) {
        modalStatus.className = `status-indicator ${isOnline ? 'online' : 'offline'}`;
        if (modalStatusText) modalStatusText.textContent = isOnline ? i18n.t('status.modal_online') : i18n.t('status.modal_offline');
      }
    } catch (error) {
      statusBar?.classList.remove('online', 'offline');
      statusBar?.classList.add('offline');
      await refreshMediaFiles();
      if (statusText) statusText.textContent = i18n.t('status.offline');
    }
  }

  setInterval(checkStatus, 5000);
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
  try {
    const res = await fetch("https://api.github.com/repos/MrtinTrape/Torktool/releases/latest");
    const release = await res.json();
    const exe = release.assets.find(a => a.name.endsWith(".exe"));
    if (exe) {
      btn.href = exe.browser_download_url;
      btn.setAttribute("download", "TorkTool.exe");
    }
  } catch (e) {
    console.error("Error fetching release:", e);
  }
}
