(function () {
  const t = (key, params) => window.i18n?.t(key, params) ?? key;
  const ACTIVE_TAB_KEY = 'torktool.activeTab';

  function getApiUrl() {
    return window.API_URL;
  }

  function readCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function writeCookie(name, value) {
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
  }

  function getStoredTab() {
    try {
      return localStorage.getItem(ACTIVE_TAB_KEY) || readCookie(ACTIVE_TAB_KEY) || 'media';
    } catch (error) {
      return readCookie(ACTIVE_TAB_KEY) || 'media';
    }
  }

  function setStoredTab(tab) {
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, tab);
    } catch (error) {
      writeCookie(ACTIVE_TAB_KEY, tab);
    }
    writeCookie(ACTIVE_TAB_KEY, tab);
  }

  function activateTab(tabName) {
    const navButtons = document.querySelectorAll('.nav-btn');
    const sections = document.querySelectorAll('.tab-content');
    const targetButton = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);
    const targetSection = document.getElementById(tabName);

    navButtons.forEach((item) => item.classList.remove('active'));
    sections.forEach((section) => section.classList.remove('active'));

    if (targetButton) {
      targetButton.classList.add('active');
    }
    if (targetSection) {
      targetSection.classList.add('active');
    }

    setStoredTab(tabName);

    if (tabName === 'media' && typeof window.refreshMediaFiles === 'function') {
      window.refreshMediaFiles();
    }
  }

  function showGlobalProgress(label, percent = 0) {
    const globalProgress = document.getElementById('globalProgress');
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    const progressLabel = document.getElementById('progressLabel');

    if (!globalProgress || !progressBar || !progressPercent || !progressLabel) {
      return;
    }

    const nextPercent = Math.max(0, Math.min(100, percent));
    globalProgress.style.display = 'block';
    progressLabel.textContent = label;
    progressBar.style.width = `${nextPercent}%`;
    progressPercent.textContent = `${nextPercent}%`;
  }

  function hideGlobalProgress() {
    const globalProgress = document.getElementById('globalProgress');
    if (globalProgress) {
      globalProgress.style.display = 'none';
    }
  }

  function showAgentModal() {
    const modal = document.getElementById('agentModal');
    if (modal) {
      modal.classList.add('active');
    }
  }

  function hideAgentModal() {
    const modal = document.getElementById('agentModal');
    if (modal) {
      modal.classList.remove('active');
    }
  }

  async function checkConnectivity() {
    const statusDiv = document.getElementById('backendStatus');
    const statusText = document.getElementById('statusText');
    const modalStatus = document.getElementById('modalStatus');
    const modalStatusText = document.getElementById('modalStatusText');

    if (!statusDiv || !statusText || !modalStatus || !modalStatusText) {
      return;
    }

    try {
      const response = await fetch(`${getApiUrl()}/api/status`);
      if (!response.ok) {
        throw new Error('Offline');
      }

      statusDiv.className = 'status-bar online';
      statusText.textContent = t('status.online');
      modalStatus.className = 'status-indicator online';
      modalStatusText.textContent = t('status.modal_online');
    } catch (error) {
      statusDiv.className = 'status-bar offline';
      statusText.textContent = t('status.offline');
      modalStatus.className = 'status-indicator offline';
      modalStatusText.textContent = t('status.modal_offline');
    }
  }

  function bindNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');

    navButtons.forEach((button) => {
      button.addEventListener('click', () => {
        activateTab(button.dataset.tab);
      });
    });
  }

  function bindControls() {
    const openAgentModalBtn = document.getElementById('openAgentModalBtn');
    const closeAgentModalBtn = document.getElementById('closeAgentModalBtn');
    const modalOkBtn = document.getElementById('modalOkBtn');
    const refreshMediaBtn = document.getElementById('refreshMediaBtn');
    const pdfDropZone = document.getElementById('pdfDropZone');
    const imgInput = document.getElementById('imgInput');
    const audioBrowseBtn = document.getElementById('audioBrowseBtn');
    const audioInput = document.getElementById('audioInput');

    openAgentModalBtn?.addEventListener('click', showAgentModal);
    closeAgentModalBtn?.addEventListener('click', hideAgentModal);
    modalOkBtn?.addEventListener('click', hideAgentModal);
    refreshMediaBtn?.addEventListener('click', () => {
      if (typeof window.refreshMediaFiles === 'function') {
        window.refreshMediaFiles();
      }
    });

    pdfDropZone?.addEventListener('click', () => imgInput?.click());
    audioBrowseBtn?.addEventListener('click', () => audioInput?.click());

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideAgentModal();
      }
    });
  }

  function syncDocumentTitle() {
    const title = document.querySelector('title');
    if (title) {
      document.title = title.textContent;
    }
  }

  function initApp() {
    syncDocumentTitle();
    bindNavigation();
    bindControls();
    activateTab(getStoredTab());
    checkConnectivity();
    window.setInterval(checkConnectivity, 5000);
  }

  window.API_URL = 'http://localhost:7777';
  window.getApiUrl = getApiUrl;
  window.showGlobalProgress = showGlobalProgress;
  window.hideGlobalProgress = hideGlobalProgress;
  window.showAgentModal = showAgentModal;
  window.hideAgentModal = hideAgentModal;

  window.addEventListener('torktool:i18n-ready', () => {
    syncDocumentTitle();
  });

  const start = () => initApp();
  if (window.i18n?.ready) {
    window.i18n.ready.then(start);
  } else {
    start();
  }
})();
