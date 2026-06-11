(function () {
    // Перехоплення XMLHttpRequest
    const origOpen = window.XMLHttpRequest.prototype.open;
    const origSend = window.XMLHttpRequest.prototype.send;

    window.XMLHttpRequest.prototype.open = function (method, url) {
        this._url = url;
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
        const p = origFetch.apply(this, args);
        p.then(response => {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
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
