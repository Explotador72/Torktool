(function () {
  const t = (key, params) => window.i18n?.t(key, params) ?? key;
  const tc = (oneKey, otherKey, count, params = {}) => t(count === 1 ? oneKey : otherKey, { ...params, count });

  const mediaUrlInput = document.getElementById('mediaUrl');
  const processMediaBtn = document.getElementById('processMediaBtn');
  const mediaResult = document.getElementById('mediaResult');
  const mediaFilesList = document.getElementById('mediaFilesList');

  if (!mediaUrlInput || !processMediaBtn || !mediaResult || !mediaFilesList) {
    return;
  }

  function detectMediaType(url) {
    if (url.includes('spotify.com')) {
      if (url.includes('/playlist/')) return 'spotify-playlist';
      if (url.includes('/track/')) return 'spotify-track';
      return 'spotify-unknown';
    }

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      if (url.includes('list=')) return 'youtube-playlist';
      return 'youtube-video';
    }

    return 'unknown';
  }

  function renderMediaCard(info) {
    mediaResult.innerHTML = `
      <div class="media-card">
        <img src="${info.image}" class="media-cover" alt="${info.title}">
        <div class="media-info">
          <span class="badge">${info.badge}</span>
          <h3>${info.title}</h3>
          <div class="media-meta">
            <span><i class="fas fa-user"></i> ${info.author}</span>
            <span><i class="fas fa-music"></i> ${info.count}</span>
          </div>
          <button class="btn-primary" id="startDownloadBtn" type="button">
            <i class="fas fa-download"></i>
            <span>${t('media.download_now')}</span>
          </button>
        </div>
      </div>
    `;

    const startDownloadBtn = document.getElementById('startDownloadBtn');
    startDownloadBtn?.addEventListener('click', info.onDownload);
  }

  async function handleSpotify(url) {
    const response = await apiFetch('/api/playlist/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    renderMediaCard({
      title: data.name,
      author: data.owner,
      count: tc('media.songs_one', 'media.songs_other', data.total_tracks),
      image: data.image || 'img/torken.png',
      badge: t('media.spotify_playlist'),
      onDownload: () => startSpotifyDownload(url),
    });
  }

  async function handleYouTube(url) {
    renderMediaCard({
      title: t('media.youtube_video'),
      author: t('media.youtube_author'),
      count: tc('media.files_one', 'media.files_other', 1),
      image: 'https://www.youtube.com/s/desktop/28e5dc31/img/favicon_144x144.png',
      badge: t('media.youtube_media'),
      onDownload: () => startYouTubeDownload([url]),
    });
  }

  processMediaBtn.addEventListener('click', async () => {
    const url = mediaUrlInput.value.trim();
    if (!url) {
      alert(t('media.invalid_url'));
      return;
    }

    const type = detectMediaType(url);
    if (type === 'unknown') {
      alert(t('media.unsupported_url'));
      return;
    }

    processMediaBtn.disabled = true;
    mediaResult.innerHTML = `<div class="loading-shimmer">${t('media.loading')}</div>`;

    try {
      if (type.startsWith('spotify')) {
        await handleSpotify(url);
      } else {
        await handleYouTube(url);
      }
    } catch (error) {
      mediaResult.innerHTML = `<div class="error-card"><i class="fas fa-exclamation-triangle"></i> ${t('common.error')}: ${error.message}</div>`;
    } finally {
      processMediaBtn.disabled = false;
    }
  });

  async function startSpotifyDownload(url) {
    showGlobalProgress(t('media.spotify_start'), 5);

    try {
      const response = await apiFetch('/api/playlist/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || t('common.error'));
      }

      let percent = 5;
      const interval = setInterval(() => {
        percent = Math.min(95, percent + 5);
        showGlobalProgress(t('media.spotify_unpacking'), percent);
        if (percent >= 95) {
          clearInterval(interval);
        }
      }, 500);

      setTimeout(() => {
        clearInterval(interval);
        hideGlobalProgress();
        window.refreshMediaFiles?.();
        alert(t('media.download_started'));
      }, 3000);
    } catch (error) {
      alert(`${t('common.error')}: ${error.message}`);
      hideGlobalProgress();
    }
  }

  async function startYouTubeDownload(urls) {
    const format = document.querySelector('input[name="format"]:checked')?.value || 'mp3';
    showGlobalProgress(t('media.youtube_processing'), 20);

    try {
      const response = await apiFetch('/api/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls,
          filename: `torktool_yt_${Date.now()}`,
          type: format,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || t('common.error'));
      }

      showGlobalProgress(t('media.ready_to_download'), 100);

      const link = document.createElement('a');
      link.href = `${getApiUrl()}${data.download_url}`;
      link.download = data.filename;
      link.click();

      setTimeout(hideGlobalProgress, 2000);
      window.refreshMediaFiles?.();
    } catch (error) {
      alert(`${t('common.error')}: ${error.message}`);
      hideGlobalProgress();
    }
  }

  async function refreshMediaFiles() {
    try {
      const response = await apiFetch('/api/files');
      const data = await response.json();

      if (data.success && data.files.length > 0) {
        mediaFilesList.innerHTML = data.files.map((file) => `
          <div class="file-card">
            <div class="file-icon">
              <i class="fas fa-file-zipper"></i>
            </div>
            <div class="file-details">
              <p title="${file.name}">${file.name}</p>
              <span>${file.size}</span>
            </div>
            <a href="${getApiUrl()}/api/download/${file.name}" class="btn-icon" download title="${t('common.download_now')}">
              <i class="fas fa-download"></i>
            </a>
          </div>
        `).join('');
      } else {
        mediaFilesList.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-cloud-arrow-down"></i>
            <p>${t('media.empty_recent')}</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('Error loading media files:', error);
    }
  }

  window.refreshMediaFiles = refreshMediaFiles;
  refreshMediaFiles();
})();
