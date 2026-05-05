

// Navegación por tabs
window.switchTab = function(tabId) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
    
    localStorage.setItem('torktool.activeTab', tabId);
};

// Vista de imágenes
window.switchImgView = function(view) {
    document.querySelectorAll('.img-toolbar-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.imgView === view);
    });
    
    const editorView = document.getElementById('imgEditorView');
    const pdfView = document.getElementById('imgPdfView');
    
    if (editorView) editorView.style.display = view === 'editor' ? 'block' : 'none';
    if (pdfView) pdfView.style.display = view === 'pdf' ? 'block' : 'none';
};

// Event Listeners para navegación (sin onclick en HTML)
document.addEventListener('DOMContentLoaded', () => {
    // Navegación principal
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    
    // Toolbar de imágenes
    document.querySelectorAll('.img-toolbar-btn').forEach(btn => {
        btn.addEventListener('click', () => switchImgView(btn.dataset.imgView));
    });
    
    // Restaurar tab activa
    const savedTab = localStorage.getItem('torktool.activeTab');
    if (savedTab) switchTab(savedTab);
});