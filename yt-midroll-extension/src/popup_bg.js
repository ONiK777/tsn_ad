// ═══════════════════════════════════════════════════════════════════════════════
// Валера: фонова 3D-фігура (Popup Runner)
// Використовує спільний WebGL 3D Point Cloud рушій valera_cloud.js
// ═══════════════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const stage = document.getElementById('bg-stage');
    const video = document.getElementById('bg-figure');
    const canvas = document.getElementById('bg-points');
    const neon = document.querySelector('#bg-stage .bg-neon');
    const scroller = document.querySelector('.content');
    const statusEl = document.querySelector('.preloader-status');

    if (!video) return;

    const startTime = performance.now();

    // Запобіжний таймер: очікує GPU-кешування 3D атласу (або приховує прелоадер через 3.5с)
    const safetyTimeout = setTimeout(() => {
        hidePreloader();
    }, 3500);

    function hidePreloader() {
        clearTimeout(safetyTimeout);
        const preloader = document.getElementById('app-preloader');
        if (preloader && !preloader.classList.contains('fade-out')) {
            preloader.classList.add('fade-out');
            setTimeout(() => {
                if (preloader && preloader.parentNode) preloader.remove();
            }, 350);
        }
    }

    // Гарантує, що прелоадер буде видно щонайменше 400мс для чіткого запуску без мерехтіння
    function triggerHidePreloader() {
        const elapsed = performance.now() - startTime;
        const minDuration = 400;
        if (elapsed < minDuration) {
            setTimeout(hidePreloader, minDuration - elapsed);
        } else {
            hidePreloader();
        }
    }

    // Якщо відео не завантажилось — тихо прибираємо шар
    video.addEventListener('error', () => {
        if (stage) stage.remove();
        triggerHidePreloader();
    });

    if (window.initValeraPointCloud) {
        window.initValeraPointCloud({
            stage,
            video,
            canvas,
            neon,
            scroller,
            atlasUrl: '../media/figure_atlas.webp',
            atlasCols: 12,
            atlasRows: 20,
            atlasFrames: 238,
            onProgress: (pct, label) => {
                if (statusEl) {
                    statusEl.textContent = pct >= 100 ? 'Готово' : `Кешування 3D • ${pct}%`;
                }
            },
            cols: 200,
            rows: 180,
            scale: 0.82,
            yShift: -0.05,
            pointSize: 2.55,
            threshold: 0.065,
            opY: 0,
            getBaseOP: () => document.body.classList.contains('size-small') ? 88 : 100,
            getEndOP: () => document.body.classList.contains('size-small') ? 64 : 55,
            onReady: triggerHidePreloader,
            onFallback: () => {
                triggerHidePreloader();
            }
        });
    } else {
        triggerHidePreloader();
    }
})();
