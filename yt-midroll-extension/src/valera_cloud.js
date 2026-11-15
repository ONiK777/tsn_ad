// ═══════════════════════════════════════════════════════════════════════════════
// VALERA 3D POINT CLOUD ENGINE (Zero-Dependency Shared Module)
// WebGL point cloud + exponential damping + 3D pulse shockwaves + throttled video seeking
// ═══════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const activeInstances = new Set();

  window.triggerValeraPulse = function (clientX, clientY, strength = 1.0) {
    for (const inst of activeInstances) {
      try {
        inst.triggerPulse(clientX, clientY, strength);
      } catch (e) {
        // ignore
      }
    }
  };

  function damp(cur, target, speed, dt) {
    return cur + (target - cur) * (1 - Math.exp(-speed * dt));
  }

  function mat4Perspective(out, fovYRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovYRad / 2.0);
    const nf = 1.0 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = (2.0 * far * near) * nf; out[15] = 0;
    return out;
  }

  function mat4ModelView(out, rx, ry, camZ) {
    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);

    out[0] = cy;
    out[1] = 0;
    out[2] = -sy;
    out[3] = 0;

    out[4] = sy * sx;
    out[5] = cx;
    out[6] = cy * sx;
    out[7] = 0;

    out[8] = sy * cx;
    out[9] = -sx;
    out[10] = cy * cx;
    out[11] = 0;

    out[12] = 0;
    out[13] = 0;
    out[14] = -camZ;
    out[15] = 1;
    return out;
  }

  const vsSource = `
    precision highp float;

    attribute vec2 aUv;
    attribute float aRandom;

    uniform mat4 uProjection;
    uniform mat4 uModelView;
    uniform sampler2D uTex;

    uniform float uUseAtlas;
    uniform vec4 uAtlasGrid;
    uniform vec2 uAtlasTexel;

    uniform vec2 uUvScale;
    uniform vec2 uUvOffset;
    uniform vec2 uPlaneHalfSize;

    uniform float uScale;
    uniform float uYShift;

    uniform float uThreshold;
    uniform float uHueRad;
    uniform vec3 uNeonColor;
    uniform float uTime;
    uniform float uPointSize;
    uniform float uPixelRatio;

    uniform vec3 uMouse;
    uniform vec4 uPulses[4];

    varying vec3 vColor;
    varying vec3 vNeonColor;
    varying float vEdgeFade;
    varying float vEnergy;

    vec3 rotateHue(vec3 col, float angle) {
      const vec3 k = vec3(0.57735026919);
      float cosA = cos(angle);
      return clamp(col * cosA + cross(k, col) * sin(angle) + k * dot(k, col) * (1.0 - cosA), 0.0, 1.0);
    }

    vec4 sampleAtlasTile(vec2 uv, float frame) {
      float cols = uAtlasGrid.x;
      float rows = uAtlasGrid.y;
      vec2 tileSize = vec2(1.0 / cols, 1.0 / rows);
      float fIndex = floor(frame + 0.5);
      float col = mod(fIndex, cols);
      float row = floor(fIndex / cols);
      vec2 tileOffset = vec2(col, row) * tileSize;
      vec2 inset = uAtlasTexel * 0.6;
      vec2 tileUv = clamp(tileOffset + uv * tileSize, tileOffset + inset, tileOffset + tileSize - inset);
      return texture2D(uTex, tileUv);
    }

    vec4 sampleSource(vec2 uv) {
      if (uUseAtlas < 0.5) {
        return texture2D(uTex, uv);
      }
      float maxF = max(0.0, uAtlasGrid.z - 1.0);
      float f = clamp(uAtlasGrid.w, 0.0, maxF);
      float f0 = floor(f);
      float f1 = min(f0 + 1.0, maxF);
      float frac = f - f0;
      vec4 s0 = sampleAtlasTile(uv, f0);
      vec4 s1 = sampleAtlasTile(uv, f1);
      return mix(s0, s1, frac);
    }

    void discardPoint() {
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vEdgeFade = 0.0;
      vEnergy = 0.0;
      vColor = vec3(0.0);
      vNeonColor = vec3(0.0);
    }

    void main() {
      vec2 sampleUv = aUv * uUvScale + uUvOffset;
      // Early-out for guaranteed black backdrop outside figure bounds in all 238 atlas frames (0 texture fetches)
      if (uUseAtlas > 0.5 && uThreshold >= 0.06 && (sampleUv.x < 0.415 || sampleUv.x > 0.960)) {
        discardPoint();
        return;
      }

      vec4 tex = sampleSource(sampleUv);

      float luma = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
      float maxCh = max(tex.r, max(tex.g, tex.b));
      float signal = mix(luma, maxCh, 0.45);

      float edgeFade = smoothstep(uThreshold, uThreshold + 0.055, signal);
      if (edgeFade <= 0.005) {
        discardPoint();
        return;
      }

      vec3 pos = vec3(
        (aUv.x - 0.5) * 2.0 * uPlaneHalfSize.x * uScale,
        ((0.5 - aUv.y) * 2.0 * uPlaneHalfSize.y * uScale) + uYShift,
        0.0
      );

      // Об'ємне виштовхування рельєфу вперед у 3D
      pos.z += pow(signal, 0.85) * 0.48;

      // Живий внутрішній рух крапочок усередині силуету (швидший, плавний 3D-дрифт)
      float phase = aRandom * 6.28318 + aUv.x * 10.0 + aUv.y * 8.0;
      float interiorMask = smoothstep(uThreshold + 0.02, uThreshold + 0.24, signal);
      pos.x += sin(uTime * 3.2 + phase) * 0.009 * interiorMask;
      pos.y += cos(uTime * 2.8 + phase * 1.37) * 0.009 * interiorMask;
      pos.z += sin(uTime * 3.0 + aRandom * 6.28318) * 0.025;

      float energy = max(0.0, sin(uTime * 3.6 + phase * 1.6)) * 0.14 * interiorMask;

      // Локальне силове поле курсора (плавне розступання та світіння)
      if (uMouse.z > 0.01) {
        vec2 mDelta = pos.xy - uMouse.xy;
        float mDist = length(mDelta);
        float mRadius = 0.42;
        if (mDist < mRadius) {
          float mFalloff = (1.0 - mDist / mRadius) * uMouse.z;
          mFalloff = mFalloff * mFalloff;
          vec2 mDir = (mDist > 0.0001) ? (mDelta / mDist) : vec2(0.0, 1.0);
          vec2 mTan = vec2(-mDir.y, mDir.x);
          pos.xy += (mDir * 0.075 + mTan * 0.03) * mFalloff;
          pos.z += sin(mDist * 14.0 - uTime * 6.5 + aRandom * 3.14159) * 0.06 * mFalloff;
          energy += mFalloff * 0.65;
        }
      }

      // 3D Pulse Shockwaves (ударні хвилі від дій)
      for (int i = 0; i < 4; i++) {
        vec4 p = uPulses[i];
        float strength = p.w;
        float age = p.z;
        if (strength > 0.001 && age < 1.45) {
          vec2 pDelta = pos.xy - p.xy;
          float dist = length(pDelta);
          vec2 dir = (dist > 0.0001) ? (pDelta / dist) : vec2(0.0, 1.0);
          vec2 tanDir = vec2(-dir.y, dir.x);

          float attack = smoothstep(0.0, 0.14, age);
          float waveR = age * 1.95;
          float sigma = 0.28 + age * 0.22;
          float ring = attack * exp(-pow((dist - waveR) / sigma, 2.0)) * exp(-age * 1.85);

          float swell = smoothstep(0.0, 0.12, age) * exp(-age * 3.4) * 0.14;

          float radScatter = ring * strength * (0.11 + 0.18 * aRandom);
          float tanScatter = ring * strength * sin(aRandom * 6.28318) * 0.055;
          float zScatter = ring * strength * (0.26 + 0.30 * aRandom) + swell * strength;

          pos.xy += dir * radScatter + tanDir * tanScatter;
          pos.z += zScatter;

          energy += ring * strength * 1.6;
        }
      }

      vec4 mvPos = uModelView * vec4(pos, 1.0);
      gl_Position = uProjection * mvPos;

      float sizeMod = 0.85 + 0.40 * signal + energy * 0.45;
      gl_PointSize = uPointSize * uPixelRatio * sizeMod * (2.6 / max(-mvPos.z, 0.4));
      gl_PointSize = clamp(gl_PointSize, 1.0, 36.0);

      vec3 rotCol = rotateHue(tex.rgb, uHueRad);
      float rotLuma = dot(rotCol, vec3(0.299, 0.587, 0.114));
      vec3 satCol = clamp(mix(vec3(rotLuma), rotCol, 1.35), 0.0, 1.0);
      vColor = mix(satCol, satCol * 0.68 + uNeonColor * (0.25 + 0.85 * signal), 0.30);
      vNeonColor = uNeonColor;
      vEdgeFade = edgeFade;
      vEnergy = clamp(energy, 0.0, 2.5);
    }
  `;

  const fsSource = `
    precision mediump float;

    varying vec3 vColor;
    varying vec3 vNeonColor;
    varying float vEdgeFade;
    varying float vEnergy;

    void main() {
      if (vEdgeFade <= 0.005) discard;

      vec2 coord = gl_PointCoord - vec2(0.5);
      float d = length(coord);
      if (d > 0.5) discard;

      float shape = smoothstep(0.5, 0.06, d);

      vec3 col = vColor + vNeonColor * (vEnergy * 0.85);
      col += (vColor * 0.45 + vec3(0.08)) * (1.0 - smoothstep(0.0, 0.22, d));

      gl_FragColor = vec4(col, shape * vEdgeFade * 0.88);
    }
  `;

  function hslToRgb(hDeg, s, l) {
    const h = (((hDeg % 360) + 360) % 360) / 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)];
  }

  function createShader(glCtx, type, source) {
    const shader = glCtx.createShader(type);
    glCtx.shaderSource(shader, source);
    glCtx.compileShader(shader);
    if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
      console.warn('Shader compile error:', glCtx.getShaderInfoLog(shader));
      glCtx.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function initValeraPointCloud(opts) {
    opts = opts || {};
    const video = opts.video || (opts.stage && opts.stage.querySelector('video'));
    if (!video) return null;

    const stage = opts.stage || video.parentElement;
    const canvas = opts.canvas || (stage && stage.querySelector('canvas'));
    const neon = opts.neon || (stage && (stage.querySelector('.bg-neon') || stage.querySelector('.mra-fig-neon')));
    const scroller = opts.scroller || null;
    const boundsEl = opts.boundsEl || null;
    const actionRoot = opts.actionRoot || document;
    const trackListener = opts.trackListener || ((el, ev, fn, opt) => el.addEventListener(ev, fn, opt));

    const scale = typeof opts.scale === 'number' ? opts.scale : 0.82;
    const yShift = typeof opts.yShift === 'number' ? opts.yShift : -0.05;
    const pointSize = typeof opts.pointSize === 'number' ? opts.pointSize : 2.55;
    const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.065;
    const opY = typeof opts.opY === 'number' ? opts.opY : 0;
    const getBaseOP = opts.getBaseOP || (() => 88);
    const getEndOP = opts.getEndOP || (() => 64);
    const isPaused = opts.isPaused || (() => false);

    const atlasCols = typeof opts.atlasCols === 'number' ? opts.atlasCols : 12;
    const atlasRows = typeof opts.atlasRows === 'number' ? opts.atlasRows : 20;
    const atlasFrames = typeof opts.atlasFrames === 'number' ? opts.atlasFrames : 238;

    let atlasReady = false;
    let atlasLoading = false;
    let atlasTexWidth = 3840;
    let atlasTexHeight = 3600;
    const atlasAbortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;

    const cleanups = [];
    let destroyed = false;

    function addTracked(el, ev, fn, opt) {
      if (!el) return;
      trackListener(el, ev, fn, opt);
      cleanups.push(() => {
        try {
          el.removeEventListener(ev, fn, opt);
        } catch (e) {
          // ignore
        }
      });
    }

    // Video fallback loader (lazy when atlasUrl provided, eager otherwise)
    let blobUrl = null;
    let videoFallbackStarted = false;
    function startVideoFallback() {
      if (videoFallbackStarted || destroyed) return;
      videoFallbackStarted = true;
      if (opts.videoUrl) {
        if (opts.fetchAsBlob && typeof fetch === 'function') {
          fetch(opts.videoUrl)
            .then(res => {
              if (!res.ok) throw new Error('Fetch failed: ' + res.status);
              return res.blob();
            })
            .then(blob => {
              if (destroyed) return;
              blobUrl = URL.createObjectURL(blob);
              video.src = blobUrl;
              try { video.load(); } catch (e) {}
            })
            .catch(err => {
              console.warn('[Valera] Blob fetch failed, falling back to direct videoUrl:', err);
              if (destroyed) return;
              try { video.crossOrigin = 'anonymous'; } catch (e) {}
              video.src = opts.videoUrl;
              try { video.load(); } catch (e) {}
            });
        } else {
          video.src = opts.videoUrl;
          try { video.load(); } catch (e) {}
        }
      } else if (video.src) {
        try { video.load(); } catch (e) {}
      }
    }

    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      startVideoFallback();
      video.classList.add('ready');
      if (opts.onReady) opts.onReady();
      return {
        destroy: () => {},
        triggerPulse: () => {},
        isReady: () => false,
        getStats: () => ({ mode: 'reduced-motion' })
      };
    }

    // Gaze calibration & throttled seeking
    const GAZE_MIN = 0.04;
    const GAZE_FRONT = 0.72;
    const GAZE_MAX = 0.96;
    const MIN_SEEK_INTERVAL = 33; // ms (~30fps seek cadence for smooth 24fps all-intra video)

    let duration = video.duration || 0;
    let targetGaze = GAZE_FRONT;
    let currentGaze = GAZE_FRONT;
    let lastFrameFloat = GAZE_FRONT * Math.max(1, atlasFrames - 1);
    let lastSeekTarget = -1;
    let lastSeekCallTime = 0;
    let seeking = false;
    let seekingSince = 0;
    let pending = null;
    let canvasDirty = false;
    let lastUploadedTime = -1;

    function captureVideoFrame() {
      if (atlasReady || !video || video.readyState < 2) return;
      try {
        stageCtx.drawImage(video, 0, 0, 480, 270);
        canvasDirty = true;
        lastUploadedTime = video.currentTime;
      } catch (err) {
        console.warn('[Valera] Video frame capture fallback:', err);
        webglReady = false;
        if (canvas) canvas.classList.remove('ready');
        if (stage) stage.classList.remove('webgl-active');
        video.classList.add('ready');
        if (opts.onFallback) opts.onFallback();
      }
    }

    function seekTo(t) {
      if (!duration || atlasReady) return;
      t = Math.max(0, Math.min(duration - 0.05, t));
      const now = performance.now();
      if (seeking) {
        if (now - seekingSince < 400) {
          pending = t;
          return;
        }
        seeking = false; // watchdog reset
      }
      if (Math.abs(t - video.currentTime) < 0.002) {
        lastSeekTarget = t;
        return;
      }
      seeking = true;
      seekingSince = now;
      lastSeekTarget = t;
      lastSeekCallTime = now;
      try {
        video.currentTime = t;
      } catch (e) {
        seeking = false;
      }
    }

    addTracked(video, 'seeked', () => {
      if (atlasReady) return;
      seeking = false;
      // Capture decoded frame BEFORE dispatching pending seek!
      captureVideoFrame();
      if (pending !== null) {
        const t = pending;
        pending = null;
        seekTo(t);
      }
    });

    addTracked(video, 'loadeddata', () => {
      if (atlasReady) return;
      captureVideoFrame();
    });

    addTracked(video, 'canplay', () => {
      if (atlasReady) return;
      captureVideoFrame();
    });

    addTracked(video, 'loadedmetadata', () => {
      duration = video.duration || 0;
      targetGaze = GAZE_FRONT;
      currentGaze = GAZE_FRONT;
      if (!atlasReady) {
        seekTo(duration * GAZE_FRONT);
        if (!webglReady) {
          video.classList.add('ready');
          if (opts.onReady) opts.onReady();
        }
      }
    });

    addTracked(video, 'error', () => {
      if (atlasReady) return;
      console.warn('[Valera] Video load error');
      if (stage) stage.classList.remove('webgl-active');
      if (opts.onFallback) opts.onFallback();
    });

    if (!opts.atlasUrl && video.readyState >= 1) {
      duration = video.duration || 0;
      targetGaze = GAZE_FRONT;
      currentGaze = GAZE_FRONT;
      seekTo(duration * GAZE_FRONT);
    }

    // Interactive state (rotations, tilt zoom, color hue, mouse field)
    let targetTiltScale = 1;
    let tiltScale = 1;

    let targetRotX = 0;
    let targetRotY = 0;
    let rotX = 0;
    let rotY = 0;

    let targetMouseActive = 0;
    let mouseActive = 0;

    let targetMx = 0;
    let targetMy = 0;
    let smoothMouseX = 0;
    let smoothMouseY = 0;

    let pTarget = 0;
    let pCur = 0;

    const BASE_HUE = 225;
    const DRIFT_SPEED = 26;
    let hueOffset = 0;
    let hueOffsetTarget = 0;
    const hueT0 = performance.now();

    let canvasAspect = 1.0;
    let planeHalfHeight = 2.6 * Math.tan((22.5 * Math.PI) / 180);
    let planeHalfWidth = planeHalfHeight;

    function onMouseMove(e) {
      if (destroyed) return;
      let rect;
      if (boundsEl && boundsEl.getBoundingClientRect) {
        rect = boundsEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
      } else {
        rect = {
          left: 0,
          top: 0,
          width: window.innerWidth || 600,
          height: window.innerHeight || 600
        };
      }

      const pX = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
      const pY = Math.max(0, Math.min((e.clientY - rect.top) / rect.height, 1));

      targetGaze = pX <= 0.5
        ? (pX / 0.5) * GAZE_FRONT
        : GAZE_FRONT + ((pX - 0.5) / 0.5) * (GAZE_MAX - GAZE_FRONT);

      targetTiltScale = 1.0 + (pY * 0.22);

      targetRotY = (pX * 2.0 - 1.0) * (6.0 * Math.PI / 180.0);
      targetRotX = -(pY * 2.0 - 1.0) * (5.0 * Math.PI / 180.0);

      targetMouseActive = 1;
      targetMx = (pX * 2.0 - 1.0) * planeHalfWidth;
      targetMy = (1.0 - pY * 2.0) * planeHalfHeight;
    }

    function onMouseLeave() {
      targetTiltScale = 1;
      targetRotX = 0;
      targetRotY = 0;
      targetMouseActive = 0;
    }

    addTracked(document, 'mousemove', onMouseMove);
    addTracked(document, 'mouseleave', onMouseLeave);

    // Scroll parallax
    if (stage && scroller) {
      const RAMP = 320;
      stage.style.transformOrigin = '65% 30%';
      stage.style.willChange = 'transform, opacity';

      addTracked(scroller, 'scroll', () => {
        const range = Math.min(RAMP, Math.max(1, scroller.scrollHeight - scroller.clientHeight));
        pTarget = Math.max(0, Math.min(scroller.scrollTop / range, 1));
      }, { passive: true });
    }

    // 3D Pulse Shockwave Ring-Buffer
    const MAX_PULSES = 4;
    const pulses = [];
    for (let i = 0; i < MAX_PULSES; i++) {
      pulses.push({ x: 0, y: 0, age: 999, strength: 0, t0: 0 });
    }
    let pulseIndex = 0;
    let lastPulseTimestamp = 0;

    function triggerPulse(clientX, clientY, strength = 1.0) {
      const now = performance.now();
      if (now - lastPulseTimestamp < 35) return;
      lastPulseTimestamp = now;

      let nx, ny;
      if (boundsEl && boundsEl.getBoundingClientRect) {
        const rect = boundsEl.getBoundingClientRect();
        const rw = Math.max(1, rect.width);
        const rh = Math.max(1, rect.height);
        nx = ((clientX - rect.left) / rw) * 2.0 - 1.0;
        ny = (1.0 - ((clientY - rect.top) / rh)) * 2.0 - 1.0;
      } else {
        const w = window.innerWidth || 600;
        const h = window.innerHeight || 600;
        nx = (clientX / w) * 2.0 - 1.0;
        ny = (1.0 - (clientY / h)) * 2.0 - 1.0;
      }

      const originX = nx * planeHalfWidth;
      const originY = ny * planeHalfHeight;

      pulses[pulseIndex] = {
        x: originX,
        y: originY,
        age: 0.0,
        strength: Math.min(Math.max(strength, 0.2), 2.5),
        t0: now
      };
      pulseIndex = (pulseIndex + 1) % MAX_PULSES;
    }

    let lastHueJumpTime = 0;
    function jumpHue() {
      const now = performance.now();
      if (now - lastHueJumpTime < 80) return;
      lastHueJumpTime = now;
      hueOffsetTarget += 60 + Math.random() * 240;
      console.log('%c🎨 Валера змінив колір', 'color:#ff2d3f;font-weight:bold;');
    }

    // Action listeners on actionRoot
    addTracked(actionRoot, 'pointerdown', (e) => {
      jumpHue();
      const interactive = e.target && e.target.closest && e.target.closest('button, summary, .tab-btn, .action-type-option, .notif-row, #size-toggle, #mra-size, input, select, label, .switch, .mt');
      if (!interactive) {
        triggerPulse(e.clientX, e.clientY, 0.85);
      }
    });

    addTracked(actionRoot, 'click', (e) => {
      const ctrl = e.target && e.target.closest && e.target.closest('button, summary, .tab-btn, .action-type-option, .notif-row, #size-toggle, #mra-size');
      if (!ctrl) return;
      jumpHue();
      const rect = ctrl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const isPrimary = ctrl.id === 'btn-schedule' || ctrl.id === 'btn-cancel' || ctrl.id === 'mra-analyze' || ctrl.id === 'mra-insert' || ctrl.classList.contains('btn-primary');
      const str = isPrimary ? 1.35 : 1.05;
      triggerPulse(cx, cy, str);
    });

    addTracked(actionRoot, 'change', (e) => {
      const inp = e.target && e.target.closest && e.target.closest('input, select');
      if (!inp) return;
      jumpHue();
      const targetEl = inp.closest('.switch, .mt') || inp;
      const rect = targetEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      triggerPulse(cx, cy, 0.95);
    });

    // 480x270 Offscreen canvas for fast video texture uploads (16x less GPU bandwidth)
    const stageCanvas = document.createElement('canvas');
    stageCanvas.width = 480;
    stageCanvas.height = 270;
    const stageCtx = stageCanvas.getContext('2d', { willReadFrequently: false });

    // WebGL Initialization
    let gl = null;
    if (canvas) {
      const glOpts = { alpha: true, antialias: false, powerPreference: 'high-performance' };
      gl = canvas.getContext('webgl2', glOpts) || canvas.getContext('webgl', glOpts);
    }

    let program = null;
    let vbo = null;
    let texture = null;
    let numParticles = 0;
    let pulseUniformData = new Float32Array(MAX_PULSES * 4);
    let projMatrix = new Float32Array(16);
    let mvMatrix = new Float32Array(16);

    let uProjectionLoc, uModelViewLoc, uTexLoc;
    let uUvScaleLoc, uUvOffsetLoc, uPlaneHalfSizeLoc;
    let uScaleLoc, uYShiftLoc;
    let uThresholdLoc, uHueRadLoc, uNeonColorLoc, uTimeLoc, uPointSizeLoc, uPixelRatioLoc;
    let uMouseLoc, uPulsesLoc;
    let uUseAtlasLoc, uAtlasGridLoc, uAtlasTexelLoc;
    let webglReady = false;

    function resizeCanvas() {
      if (!canvas || !gl) return;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const renderW = Math.floor(w * dpr);
      const renderH = Math.floor(h * dpr);

      if (canvas.width !== renderW || canvas.height !== renderH) {
        canvas.width = renderW;
        canvas.height = renderH;
      }
      gl.viewport(0, 0, renderW, renderH);

      canvasAspect = w / h;
      planeHalfHeight = 2.6 * Math.tan((22.5 * Math.PI) / 180);
      planeHalfWidth = planeHalfHeight * canvasAspect;
    }

    function initWebGL() {
      if (!gl) return false;

      const maxVT = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
      if (!maxVT || maxVT < 1) {
        console.warn('[Valera] Vertex texture fetch not supported');
        return false;
      }

      const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
      const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) return false;

      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('[Valera] Program link error:', gl.getProgramInfoLog(program));
        return false;
      }

      gl.useProgram(program);

      uProjectionLoc = gl.getUniformLocation(program, 'uProjection');
      uModelViewLoc = gl.getUniformLocation(program, 'uModelView');
      uTexLoc = gl.getUniformLocation(program, 'uTex');

      uUseAtlasLoc = gl.getUniformLocation(program, 'uUseAtlas');
      uAtlasGridLoc = gl.getUniformLocation(program, 'uAtlasGrid');
      uAtlasTexelLoc = gl.getUniformLocation(program, 'uAtlasTexel');

      uUvScaleLoc = gl.getUniformLocation(program, 'uUvScale');
      uUvOffsetLoc = gl.getUniformLocation(program, 'uUvOffset');
      uPlaneHalfSizeLoc = gl.getUniformLocation(program, 'uPlaneHalfSize');

      uScaleLoc = gl.getUniformLocation(program, 'uScale');
      uYShiftLoc = gl.getUniformLocation(program, 'uYShift');

      uThresholdLoc = gl.getUniformLocation(program, 'uThreshold');
      uHueRadLoc = gl.getUniformLocation(program, 'uHueRad');
      uNeonColorLoc = gl.getUniformLocation(program, 'uNeonColor');
      uTimeLoc = gl.getUniformLocation(program, 'uTime');
      uPointSizeLoc = gl.getUniformLocation(program, 'uPointSize');
      uPixelRatioLoc = gl.getUniformLocation(program, 'uPixelRatio');
      uMouseLoc = gl.getUniformLocation(program, 'uMouse');
      uPulsesLoc = gl.getUniformLocation(program, 'uPulses');

      const COLS = opts.cols || 200;
      const ROWS = opts.rows || 180;
      numParticles = COLS * ROWS;
      const vertexData = new Float32Array(numParticles * 3);
      let ptr = 0;
      for (let r = 0; r < ROWS; r++) {
        const v = r / (ROWS - 1);
        for (let c = 0; c < COLS; c++) {
          const u = c / (COLS - 1);
          vertexData[ptr++] = u;
          vertexData[ptr++] = v;
          vertexData[ptr++] = Math.random();
        }
      }

      vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

      const stride = 3 * Float32Array.BYTES_PER_ELEMENT;
      const aUvLoc = gl.getAttribLocation(program, 'aUv');
      const aRandomLoc = gl.getAttribLocation(program, 'aRandom');

      gl.enableVertexAttribArray(aUvLoc);
      gl.vertexAttribPointer(aUvLoc, 2, gl.FLOAT, false, stride, 0);

      gl.enableVertexAttribArray(aRandomLoc);
      gl.vertexAttribPointer(aRandomLoc, 1, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

      // Pre-allocate WebGL texture once at 480x270 RGBA
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 480, 270, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.disable(gl.DEPTH_TEST);

      resizeCanvas();
      return true;
    }

    if (window.ResizeObserver && canvas) {
      const ro = new ResizeObserver(() => resizeCanvas());
      ro.observe(canvas);
      cleanups.push(() => ro.disconnect());
    }
    addTracked(window, 'resize', resizeCanvas);

    if (canvas) {
      addTracked(canvas, 'webglcontextlost', (e) => {
        e.preventDefault();
        webglReady = false;
        atlasReady = false;
        atlasLoading = false;
        canvas.classList.remove('ready');
        if (stage) stage.classList.remove('webgl-active');
        startVideoFallback();
        if (video) video.classList.add('ready');
      });

      addTracked(canvas, 'webglcontextrestored', () => {
        if (destroyed) return;
        webglReady = initWebGL();
        if (!webglReady) return;
        const maxTex = (gl && typeof gl.getParameter === 'function') ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
        if (opts.atlasUrl && maxTex >= 4096) {
          loadAtlas();
        } else if (video && video.readyState >= 2) {
          captureVideoFrame();
        }
      });
    }

    function loadAtlas() {
      if (atlasLoading || atlasReady || destroyed) return;
      atlasLoading = true;

      if (opts.onProgress) opts.onProgress(10, 'Завантаження 3D...');

      fetch(opts.atlasUrl, { signal: atlasAbortController ? atlasAbortController.signal : undefined })
        .then(async (res) => {
          if (!res.ok) throw new Error('Atlas fetch HTTP ' + res.status);
          const contentLength = Number(res.headers.get('content-length')) || 775558;
          let blob;
          if (res.body && typeof res.body.getReader === 'function') {
            const reader = res.body.getReader();
            const chunks = [];
            let received = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              received += value.length;
              const pct = Math.min(88, 10 + Math.round((received / contentLength) * 78));
              if (opts.onProgress) opts.onProgress(pct, 'Кешування 3D...');
            }
            blob = new Blob(chunks, { type: 'image/webp' });
          } else {
            if (opts.onProgress) opts.onProgress(50, 'Кешування 3D...');
            blob = await res.blob();
          }

          if (destroyed) return;
          if (opts.onProgress) opts.onProgress(92, 'Розпакування текстури...');

          let imgSource = null;
          if (typeof createImageBitmap === 'function') {
            try {
              imgSource = await createImageBitmap(blob);
            } catch (err) {
              console.warn('[Valera] createImageBitmap failed, falling back to Image:', err);
            }
          }
          if (!imgSource) {
            imgSource = await new Promise((resolve, reject) => {
              const img = new Image();
              const url = URL.createObjectURL(blob);
              img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
              };
              img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Image decode error'));
              };
              img.src = url;
            });
          }

          if (destroyed) {
            if (imgSource && typeof imgSource.close === 'function') imgSource.close();
            return;
          }

          atlasTexWidth = imgSource.width || 3840;
          atlasTexHeight = imgSource.height || 3600;

          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgSource);

          if (typeof imgSource.close === 'function') {
            imgSource.close();
          }

          atlasReady = true;
          if (opts.onProgress) opts.onProgress(100, 'Готово');

          // Warm-up render frame so shader and textures are hot in GPU (also marks ready & fires onReady once)
          renderFrame(performance.now());
          if ((!canvas || !canvas.classList.contains('ready')) && opts.onReady) {
            if (canvas) {
              canvas.classList.add('ready');
              canvas.dataset.mode = 'atlas-60fps';
            }
            if (stage) stage.classList.add('webgl-active');
            opts.onReady();
          }
        })
        .catch((err) => {
          if (destroyed) return;
          console.warn('[Valera] Atlas pipeline failed, falling back to video:', err);
          startVideoFallback();
          if (opts.onFallback) opts.onFallback();
        });
    }

    webglReady = initWebGL();
    if (!opts.atlasUrl && video.readyState >= 2) {
      captureVideoFrame();
    }

    if (opts.atlasUrl) {
      const maxTex = (gl && typeof gl.getParameter === 'function') ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
      if (webglReady && maxTex >= 4096) {
        loadAtlas();
      } else {
        console.warn(`[Valera] WebGL not ready or MAX_TEXTURE_SIZE (${maxTex}) < 4096, using video fallback`);
        startVideoFallback();
      }
    } else {
      startVideoFallback();
    }

    function updateTextureIfNeeded() {
      if (atlasReady || !gl || !texture || !video || video.readyState < 2) return;
      if (!canvasDirty && !seeking && video.currentTime !== lastUploadedTime) {
        captureVideoFrame();
      }
      if (canvasDirty) {
        canvasDirty = false;
        try {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, stageCanvas);
        } catch (err) {
          console.warn('[Valera] WebGL video texture fallback:', err);
          webglReady = false;
          if (canvas) canvas.classList.remove('ready');
          if (stage) stage.classList.remove('webgl-active');
          video.classList.add('ready');
          if (opts.onFallback) opts.onFallback();
        }
      }
    }

    function renderFrame(now) {
      if (!webglReady || !gl || !program) return;

      if (!atlasReady) {
        updateTextureIfNeeded();
      }

      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);

      // Perspective & ModelView
      mat4Perspective(projMatrix, (45 * Math.PI) / 180, canvasAspect, 0.1, 50.0);
      mat4ModelView(mvMatrix, rotX, rotY, 2.6);

      gl.uniformMatrix4fv(uProjectionLoc, false, projMatrix);
      gl.uniformMatrix4fv(uModelViewLoc, false, mvMatrix);

      // Atlas vs Video uniforms
      if (atlasReady) {
        gl.uniform1f(uUseAtlasLoc, 1.0);
        gl.uniform4f(uAtlasGridLoc, atlasCols, atlasRows, atlasFrames, lastFrameFloat);
        gl.uniform2f(uAtlasTexelLoc, 1.0 / atlasTexWidth, 1.0 / atlasTexHeight);
      } else {
        gl.uniform1f(uUseAtlasLoc, 0.0);
        gl.uniform4f(uAtlasGridLoc, 1.0, 1.0, 1.0, 0.0);
        gl.uniform2f(uAtlasTexelLoc, 1.0 / 480.0, 1.0 / 270.0);
      }

      // Aspect ratio cover + crop
      const videoAspect = (atlasReady || !video.videoWidth || !video.videoHeight)
        ? (16 / 9)
        : (video.videoWidth / video.videoHeight);

      const op = getBaseOP();
      const opCur = op + (getEndOP() - op) * pCur;

      let uvScaleX = 1.0, uvScaleY = 1.0, uvOffsetX = 0.0, uvOffsetY = 0.0;
      if (canvasAspect < videoAspect) {
        uvScaleX = canvasAspect / videoAspect;
        uvScaleY = 1.0;
        uvOffsetX = (1.0 - uvScaleX) * (opCur / 100.0);
        uvOffsetY = 0.0;
      } else {
        uvScaleX = 1.0;
        uvScaleY = videoAspect / canvasAspect;
        uvOffsetX = 0.0;
        uvOffsetY = (1.0 - uvScaleY) * (opY / 100.0);
      }

      gl.uniform2f(uUvScaleLoc, uvScaleX, uvScaleY);
      gl.uniform2f(uUvOffsetLoc, uvOffsetX, uvOffsetY);
      gl.uniform2f(uPlaneHalfSizeLoc, planeHalfWidth, planeHalfHeight);

      gl.uniform1f(uScaleLoc, scale);
      gl.uniform1f(uYShiftLoc, yShift);
      gl.uniform1f(uThresholdLoc, threshold);

      const t = (now - hueT0) / 1000;
      const hue = (t * DRIFT_SPEED + 18 * Math.sin(t * 0.5) + hueOffset) % 360;
      gl.uniform1f(uHueRadLoc, (hue * Math.PI) / 180.0);
      const [nr, ng, nb] = hslToRgb(BASE_HUE + hue, 0.95, 0.58);
      gl.uniform3f(uNeonColorLoc, nr, ng, nb);
      gl.uniform1f(uTimeLoc, t);
      gl.uniform1f(uPointSizeLoc, pointSize);
      gl.uniform1f(uPixelRatioLoc, Math.min(window.devicePixelRatio || 1, 2));

      // Smooth mouse hover field
      gl.uniform3f(uMouseLoc, smoothMouseX, smoothMouseY, mouseActive);

      // Pulses ring buffer
      for (let i = 0; i < MAX_PULSES; i++) {
        const p = pulses[i];
        if (p.strength > 0.001) {
          p.age = (now - p.t0) / 1000.0;
          if (p.age >= 1.45) p.strength = 0;
        }
        const off = i * 4;
        pulseUniformData[off + 0] = p.x;
        pulseUniformData[off + 1] = p.y;
        pulseUniformData[off + 2] = p.age;
        pulseUniformData[off + 3] = p.strength;
      }
      gl.uniform4fv(uPulsesLoc, pulseUniformData);

      // Texture bind & draw
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uTexLoc, 0);

      gl.drawArrays(gl.POINTS, 0, numParticles);

      if (!canvas.classList.contains('ready') && (atlasReady || video.readyState >= 2)) {
        canvas.classList.add('ready');
        if (atlasReady) {
          canvas.dataset.mode = 'atlas-60fps';
        }
        if (stage) stage.classList.add('webgl-active');
        if (opts.onReady) opts.onReady();
        const rect = boundsEl && boundsEl.getBoundingClientRect ? boundsEl.getBoundingClientRect() : {
          left: 0,
          top: 0,
          width: window.innerWidth || 600,
          height: window.innerHeight || 600
        };
        triggerPulse(rect.left + rect.width * 0.52, rect.top + rect.height * 0.35, 0.75);
      }
    }

    let rafId = null;
    let lastNow = performance.now();

    function tick(now) {
      if (destroyed) return;
      if (!video || !video.isConnected || (boundsEl && !boundsEl.isConnected)) {
        destroy();
        return;
      }

      const dt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;

      // Exponential damping
      currentGaze = damp(currentGaze, targetGaze, 12.5, dt);
      rotX = damp(rotX, targetRotX, 11, dt);
      rotY = damp(rotY, targetRotY, 11, dt);
      tiltScale = damp(tiltScale, targetTiltScale, 9, dt);
      hueOffset = damp(hueOffset, hueOffsetTarget, 5.5, dt);
      mouseActive = damp(mouseActive, targetMouseActive, 9, dt);
      smoothMouseX = damp(smoothMouseX, targetMx, 16, dt);
      smoothMouseY = damp(smoothMouseY, targetMy, 16, dt);

      if (scroller) {
        pCur = damp(pCur, pTarget, 10, dt);
        if (Math.abs(pTarget - pCur) < 0.001) pCur = pTarget;
      }

      // Smooth throttled video seeking (only if !atlasReady)
      if (!atlasReady && duration > 0) {
        const finalGaze = (1 - pCur) * currentGaze + pCur * GAZE_MIN;
        const newTarget = finalGaze * duration;
        const timeSinceSeek = now - lastSeekCallTime;
        if (timeSinceSeek >= MIN_SEEK_INTERVAL && Math.abs(newTarget - lastSeekTarget) >= 0.015) {
          seekTo(newTarget);
        }
      }

      // Compute frameFloat for atlas interpolation
      if (atlasReady) {
        const finalGaze = (1 - pCur) * currentGaze + pCur * GAZE_MIN;
        lastFrameFloat = Math.max(0, Math.min(1, finalGaze)) * Math.max(1, atlasFrames - 1);
      }

      // Hue calculation
      const t = (now - hueT0) / 1000;
      const hue = (t * DRIFT_SPEED + 18 * Math.sin(t * 0.5) + hueOffset) % 360;

      if (!webglReady) {
        video.style.filter = 'hue-rotate(' + hue.toFixed(1) + 'deg)';
      }
      if (neon && neon.isConnected) {
        neon.style.setProperty('--neon-h', String((BASE_HUE + hue) % 360));
        neon.style.setProperty('--mra-neon-h', String((BASE_HUE + hue) % 360));
      }

      // Stage transform fallback
      if (stage && stage.isConnected) {
        if (pCur === 0 && Math.abs(tiltScale - 1) < 0.001) {
          stage.style.transform = '';
          stage.style.opacity = '';
          video.style.objectPosition = '';
        } else {
          const scrollScale = 1 + 0.14 * pCur;
          const scrollX = 4 * pCur;
          const scrollY = 2.5 * pCur;
          stage.style.transform = `scale(${scrollScale * tiltScale}) translate(${scrollX}%, ${scrollY}%)`;
          stage.style.opacity = String(1 - 0.45 * pCur);
          const op = getBaseOP();
          const opCur = op + (getEndOP() - op) * pCur;
          video.style.objectPosition = opCur + '% ' + opY + '%';
        }
      }

      // Minimized / paused / hidden tab check: skip WebGL rendering when not visible
      if (document.hidden || isPaused()) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      // Render WebGL frame
      renderFrame(now);

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (atlasAbortController) {
        try { atlasAbortController.abort(); } catch (e) {}
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      activeInstances.delete(instance);

      cleanups.forEach(fn => {
        try { fn(); } catch (e) {}
      });
      cleanups.length = 0;

      if (blobUrl) {
        try { URL.revokeObjectURL(blobUrl); } catch (e) {}
        blobUrl = null;
      }

      if (gl) {
        if (vbo) { try { gl.deleteBuffer(vbo); } catch (e) {} vbo = null; }
        if (texture) { try { gl.deleteTexture(texture); } catch (e) {} texture = null; }
        if (program) { try { gl.deleteProgram(program); } catch (e) {} program = null; }
      }
    }

    const instance = {
      destroy,
      triggerPulse,
      isReady: () => (atlasReady || webglReady),
      getStats: () => ({
        mode: atlasReady ? 'atlas-60fps' : (webglReady ? 'video-webgl' : 'video-fallback'),
        atlasReady,
        frameFloat: atlasReady ? lastFrameFloat : -1,
        currentGaze,
        targetGaze
      })
    };

    activeInstances.add(instance);
    return instance;
  }

  window.initValeraPointCloud = initValeraPointCloud;
})();
