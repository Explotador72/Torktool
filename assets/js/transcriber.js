(function () {
  const t = (key, params) => window.i18n?.t(key, params) ?? key;
  const tc = (oneKey, otherKey, count, params = {}) => t(count === 1 ? oneKey : otherKey, { ...params, count });

  const audioInput = document.getElementById('audioInput');
  const transcriptBtn = document.getElementById('transcriptBtn');
  const transcriptOutput = document.getElementById('transcriptOutput');
  const audioDropZone = document.getElementById('audioDropZone');

  if (!audioInput || !transcriptBtn || !transcriptOutput || !audioDropZone) {
    return;
  }

  function setTranscriptButtonState(isLoading) {
    transcriptBtn.disabled = isLoading || audioInput.files.length === 0;
    transcriptBtn.innerHTML = isLoading
      ? `<i class="fas fa-spinner fa-spin"></i><span>${t('transcriber.transcribing')}</span>`
      : `<i class="fas fa-wand-magic-sparkles"></i><span>${t('transcriber.start')}</span>`;
  }

  audioInput.addEventListener('change', () => {
    const fileCount = audioInput.files.length;
    transcriptBtn.disabled = fileCount === 0;
    audioDropZone.querySelector('p').textContent = tc('transcriber.selected_one', 'transcriber.selected_other', fileCount);
    audioDropZone.classList.toggle('has-files', fileCount > 0);
  });

  transcriptBtn.addEventListener('click', async () => {
    if (audioInput.files.length === 0) {
      return;
    }

    setTranscriptButtonState(true);
    transcriptOutput.innerHTML = `<p class="loading-text">${t('transcriber.analyzing')}</p>`;
    showGlobalProgress(t('progress.audio_processing'), 30);

    setTimeout(() => {
      showGlobalProgress(t('progress.audio_extracting'), 70);

      setTimeout(() => {
        hideGlobalProgress();
        transcriptOutput.innerHTML = `
          <div class="transcript-result">
            <strong>${t('transcriber.note_title')}</strong> ${t('transcriber.placeholder_result')}
          </div>
        `;
        setTranscriptButtonState(false);
      }, 1500);
    }, 1500);
  });

  setTranscriptButtonState(false);
})();
