(function () {
    // Витягнути dur= з videoplayback URL
    function extractDuration(url) {
        if (!url || typeof url !== 'string') return;
        if (!url.includes('videoplayback') || !url.includes('dur=')) return;
        try {
            const match = url.match(/[?&]dur=([\d.]+)/);
            if (match) {
                const dur = parseFloat(match[1]);
                if (dur > 0 && isFinite(dur)) {
                    window.postMessage({ type: 'MRA_VIDEO_DURATION', duration: dur }, '*');
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
        }).catch(() => { });
        return p;
    };
})();
