(function () {
    if (window.__mraInjectInstalled) return;
    window.__mraInjectInstalled = true;

    // ── Пошук підказок YouTube про природні паузи у JSON-відповідях Studio ──
    // YT сам знає, де у відео природні паузи (його вердикт "перемістіть мітку"
    // береться саме звідси). Якщо ці позиції приходять по мережі — віддаємо їх боту.
    const AD_HINT_URL_RE = /ad_?break|monetiz|video_editor|get_video|editor/i;
    const AD_HINT_KEY_RE = /(natural.?pause|suggest.*ad.?break|ad.?break.?suggest|suggested.?break|break.?point)/i;
    const AD_HINT_EXCLUDE_RE = /(manual|existing|current|user|deleted|removed)/i;

    function pickTimeField(o) {
        if (!o || typeof o !== 'object') return null;
        const v = o.timeMs ?? o.startTimeMs ?? o.offsetMs ?? o.startMs ?? o.adBreakTimeMs
            ?? o.timeSec ?? o.startSec ?? o.seconds ?? o.startSeconds;
        return (typeof v === 'number' && isFinite(v) && v >= 0) ? v
            : (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) ? parseFloat(v) : null;
    }

    function scanForAdBreakHints(data, url) {
        const matches = [];
        const visit = (node, keyPath, depth) => {
            if (!node || typeof node !== 'object' || depth > 12) return;
            if (AD_HINT_EXCLUDE_RE.test(keyPath)) return;
            if (Array.isArray(node)) {
                if (node.length >= 3 && node.length <= 500 && AD_HINT_KEY_RE.test(keyPath)) {
                    let times = null;
                    if (node.every(v => typeof v === 'number' && isFinite(v) && v >= 0)) {
                        times = node.slice(0, 500);
                    } else {
                        const parsed = node.map(pickTimeField);
                        if (parsed.length && parsed.every(t => t !== null)) {
                            times = parsed.slice(0, 500);
                        }
                    }
                    if (times && times.length >= 3) {
                        const priority = /natural|suggest/i.test(keyPath) ? 2 : 1;
                        matches.push({ times, priority });
                    }
                }
                for (const ch of node) visit(ch, keyPath, depth + 1);
                return;
            }
            for (const k in node) visit(node[k], keyPath ? (keyPath + '.' + k) : k, depth + 1);
        };
        try { visit(data, '', 0); } catch (e) { }

        if (matches.length > 0) {
            matches.sort((a, b) => b.priority - a.priority || b.times.length - a.times.length);
            const best = matches[0].times;
            if (best && best.length >= 3) {
                window.postMessage({
                    type: 'MRA_YT_AD_HINTS',
                    url: String(url).slice(0, 160),
                    times: best
                }, '*');
            }
        }
    }

    function maybeScanResponse(url, text) {
        try {
            if (!url || !AD_HINT_URL_RE.test(url)) return;
            if (!text || text.length > 3000000) return;
            scanForAdBreakHints(JSON.parse(text), url);
        } catch (e) { }
    }

    // Витягнути dur= з videoplayback URL
    function extractDuration(url) {
        if (!url || typeof url !== 'string') return;
        if (!url.includes('videoplayback') || !url.includes('dur=')) return;
        try {
            const match = url.match(/[?&]dur=([\d.]+)/);
            if (match) {
                const dur = parseFloat(match[1]);
                if (dur > 0 && isFinite(dur)) {
                    window.postMessage({ type: 'MRA_VIDEO_DURATION', duration: dur, path: window.location.pathname }, '*');
                }
            }
        } catch (e) { }
    }

    // Перехоплення XMLHttpRequest
    const origOpen = window.XMLHttpRequest.prototype.open;
    const origSend = window.XMLHttpRequest.prototype.send;

    window.XMLHttpRequest.prototype.open = function (method, url) {
        this._url = url;
        extractDuration(url);
        return origOpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function () {
        this.addEventListener('load', function () {
            if (this._url && this._url.includes('get_audio_waveform_url')) {
                try {
                    const data = JSON.parse(this.responseText);
                    if (data.audioWaveformUrl) {
                        window.postMessage({ type: 'MRA_WAVEFORM_URL', url: data.audioWaveformUrl }, '*');
                    }
                } catch (e) { }
            }
            try { maybeScanResponse(this._url, this.responseText); } catch (e) { }
        });
        return origSend.apply(this, arguments);
    };

    // Перехоплення Fetch API
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        extractDuration(url);

        const p = origFetch.apply(this, args);
        p.then(response => {
            if (url.includes('get_audio_waveform_url')) {
                const clone = response.clone();
                clone.json().then(data => {
                    if (data && data.audioWaveformUrl) {
                        window.postMessage({ type: 'MRA_WAVEFORM_URL', url: data.audioWaveformUrl }, '*');
                    }
                }).catch(() => { });
            }
            if (AD_HINT_URL_RE.test(url)) {
                response.clone().text().then(text => maybeScanResponse(url, text)).catch(() => { });
            }
        }).catch(() => { });
        return p;
    };
})();
