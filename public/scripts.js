document.addEventListener("DOMContentLoaded", () => {

  // ── Socket ──────────────────────────────────────────────
  let socket;
  try { socket = io(); } catch(e) { socket = { on: () => {}, emit: () => {} }; }

  let allCommandsCache = [];

  const phoneInput        = document.getElementById("phone");
  const requestPairingBtn = document.getElementById("requestPairing");
  const statusEl          = document.getElementById("status");
  const countdownWrap     = document.getElementById("countdownWrap");
  const countdownBar      = document.getElementById("countdownBar");
  const countdownSec      = document.getElementById("countdownSec");
  const stepsWrap         = document.getElementById("stepsWrap");
  const botStatusDot      = document.getElementById("botStatusDot");
  const botStatusText     = document.getElementById("botStatusText");
  const themeToggle       = document.getElementById("themeToggle");
  const themeIcon         = document.getElementById("themeIcon");
  const toastContainer    = document.getElementById("toastContainer");
  const flagEmoji         = document.getElementById("flagEmoji");
  const countryLabel      = document.getElementById("countryLabel");
  const tabCode           = document.getElementById("tabCode");
  const tabQr             = document.getElementById("tabQr");
  const codeMethodPanel   = document.getElementById("codeMethodPanel");
  const qrMethodPanel     = document.getElementById("qrMethodPanel");
  const requestQrBtn      = document.getElementById("requestQr");
  const qrBox             = document.getElementById("qrBox");
  const stepText1         = document.getElementById("stepText1");
  const stepText5         = document.getElementById("stepText5");

  function setStepsForMethod(isQr) {
    if (!stepText1 || !stepText5) return;
    stepText1.innerHTML = isQr
      ? 'Keep this page open and the QR code visible'
      : 'Copy the 8-digit code above';
    stepText5.innerHTML = isQr
      ? 'Choose <b>"Link with QR code"</b> and scan it'
      : 'Choose <b>"Link with phone number"</b> and enter the code';
  }

  // ── Year ─────────────────────────────────────────────────
  document.getElementById('year').textContent = new Date().getFullYear();

  // ── Particles ────────────────────────────────────────────
  const pc = document.getElementById('particles');
  const count = window.innerWidth < 600 ? 18 : 36;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 4 + 2;
    p.style.cssText = `width:${size}px;height:${size}px;left:${Math.random()*100}%;animation-duration:${Math.random()*18+14}s;animation-delay:${Math.random()*18}s;`;
    pc.appendChild(p);
  }

  // ══════════════════════════════════════════════════
  // 🎵 SUCCESS SOUND
  // ══════════════════════════════════════════════════
  function playSuccessSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5 E5 G5 C6
      notes.forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.12;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.25, t + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.start(t);
        osc.stop(t + 0.35);
      });
    } catch(e) {}
  }

  function playGenerateSound() {
    if (localStorage.getItem('drHoneySound') === 'off') return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(660, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } catch(e) {}
  }

  // ══════════════════════════════════════════════════
  // 🎨 THEME COLOR PICKER
  // ══════════════════════════════════════════════════
  const colorPickerBtn   = document.getElementById("colorPickerBtn");
  const colorOptions     = document.getElementById("colorOptions");
  const colorSwatches    = document.querySelectorAll(".color-swatch:not(.color-swatch-custom)");
  const customSwatch     = document.getElementById("customColorSwatch");
  const customColorInput = document.getElementById("customColorInput");
  const metaThemeColor   = document.getElementById("metaThemeColor");

  const themeColors = {
    purple: "#6c3adb", red: "#dc2626", blue: "#1d4ed8",
    green:  "#059669", orange: "#ea580c", pink: "#be185d",
    teal:   "#0d9488", indigo: "#4338ca"
  };

  // Convert a hex color into the same set of CSS variables the fixed themes use,
  // so a custom color gets the same glow/glass/dark-bg treatment.
  function hexToRgb(hex) {
    const m = hex.replace('#','').match(/.{1,2}/g);
    return m.map(h => parseInt(h, 16));
  }
  function shadeHex(hex, percent) {
    const [r, g, b] = hexToRgb(hex);
    const t = percent < 0 ? 0 : 255;
    const p = Math.abs(percent);
    const newC = c => Math.round((t - c) * p) + c;
    return '#' + [newC(r), newC(g), newC(b)].map(c => c.toString(16).padStart(2,'0')).join('');
  }
  function applyCustomColor(hex) {
    const [r, g, b] = hexToRgb(hex);
    const bright = shadeHex(hex, 0.25);
    const light  = shadeHex(hex, 0.55);
    const deep   = shadeHex(hex, -0.85);
    const mid    = shadeHex(hex, -0.65);
    const lav    = shadeHex(hex, 0.85);
    const body   = document.body.style;
    body.setProperty('--c-main', hex);
    body.setProperty('--c-bright', bright);
    body.setProperty('--c-light', light);
    body.setProperty('--c-glow', `rgba(${r},${g},${b},0.35)`);
    body.setProperty('--c-glass', `rgba(${r},${g},${b},0.12)`);
    body.setProperty('--c-deep', deep);
    body.setProperty('--c-mid', mid);
    body.setProperty('--lavender', lav);
    const [mr, mg, mb] = hexToRgb(mid);
    body.setProperty('--card-bg', `rgba(${mr},${mg},${mb},0.72)`);
    document.body.dataset.theme = 'custom';
    colorSwatches.forEach(sw => sw.classList.remove('active'));
    customSwatch.classList.add('active');
    customSwatch.style.background = hex;
    if (metaThemeColor) metaThemeColor.content = hex;
  }

  const savedColor = localStorage.getItem('drHoneyColor') || 'purple';
  const savedCustomHex = localStorage.getItem('drHoneyCustomColorHex');
  if (savedColor === 'custom' && savedCustomHex) {
    customColorInput.value = savedCustomHex;
    applyCustomColor(savedCustomHex);
  } else {
    applyColor(savedColor);
  }

  colorPickerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    colorOptions.classList.toggle('open');
  });
  document.addEventListener('click', () => colorOptions.classList.remove('open'));
  colorOptions.addEventListener('click', e => e.stopPropagation());

  colorSwatches.forEach(sw => {
    sw.addEventListener('click', () => {
      const color = sw.dataset.color;
      applyColor(color);
      localStorage.setItem('drHoneyColor', color);
      localStorage.removeItem('drHoneyCustomColorHex');
      colorOptions.classList.remove('open');
      showToast(`Theme changed to ${color.charAt(0).toUpperCase()+color.slice(1)}! 🎨`, 'info', 2000);
    });
  });

  // "+" swatch opens the native color picker instead of applying a fixed color directly
  customSwatch.addEventListener('click', () => {
    customColorInput.click();
  });
  customColorInput.addEventListener('input', () => {
    applyCustomColor(customColorInput.value);
  });
  customColorInput.addEventListener('change', () => {
    localStorage.setItem('drHoneyColor', 'custom');
    localStorage.setItem('drHoneyCustomColorHex', customColorInput.value);
    colorOptions.classList.remove('open');
    showToast('Custom theme applied! 🎨', 'info', 2000);
  });

  function applyColor(color) {
    document.body.style.removeProperty('--c-main');
    document.body.style.removeProperty('--c-bright');
    document.body.style.removeProperty('--c-light');
    document.body.style.removeProperty('--c-glow');
    document.body.style.removeProperty('--c-glass');
    document.body.style.removeProperty('--c-deep');
    document.body.style.removeProperty('--c-mid');
    document.body.style.removeProperty('--lavender');
    document.body.style.removeProperty('--card-bg');
    customSwatch.style.background = '';
    document.body.dataset.theme = color;
    colorSwatches.forEach(sw => sw.classList.toggle('active', sw.dataset.color === color));
    customSwatch.classList.remove('active');
    if (metaThemeColor) metaThemeColor.content = themeColors[color] || themeColors.purple;
  }

  // ══════════════════════════════════════════════════
  // 🌙 DARK / LIGHT MODE TOGGLE
  // ══════════════════════════════════════════════════
  const savedTheme = localStorage.getItem('drHoneyTheme') || 'dark';
  if (savedTheme === 'light') applyLight();

  themeToggle.addEventListener('click', () => {
    if (document.body.classList.contains('light-mode')) {
      applyDark();
      localStorage.setItem('drHoneyTheme', 'dark');
    } else {
      applyLight();
      localStorage.setItem('drHoneyTheme', 'light');
    }
  });

  function applyLight() { document.body.classList.add('light-mode');    themeIcon.className = 'fas fa-sun'; }
  function applyDark()  { document.body.classList.remove('light-mode'); themeIcon.className = 'fas fa-moon'; }

  // ══════════════════════════════════════════════════
  // 🔔 TOAST NOTIFICATIONS
  // ══════════════════════════════════════════════════
  function showToast(message, type = 'info', duration = 3500) {
    const icons = { success:'✅', error:'❌', info:'💬', warning:'⚠️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type]||'💬'}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 350);
    }, duration);
  }

  // ══════════════════════════════════════════════════
  // ⚙️ SETTINGS PANEL
  // ══════════════════════════════════════════════════
  const settingsBtn   = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const soundToggle    = document.getElementById('soundToggle');
  const refreshStatsBtn = document.getElementById('refreshStatsBtn');
  const shareSiteBtn   = document.getElementById('shareSiteBtn');

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel.classList.toggle('open');
  });
  document.addEventListener('click', () => settingsPanel.classList.remove('open'));
  settingsPanel.addEventListener('click', e => e.stopPropagation());

  // Sound toggle (persisted; respected by playGenerateSound)
  soundToggle.checked = localStorage.getItem('drHoneySound') !== 'off';
  soundToggle.addEventListener('change', () => {
    localStorage.setItem('drHoneySound', soundToggle.checked ? 'on' : 'off');
    showToast(soundToggle.checked ? 'Sound effects on 🔊' : 'Sound effects off 🔇', 'info', 1800);
  });

  // Live glow animation (always on; toggle removed)
  document.body.classList.add('glow-on');

  // Glass blur kept at default (intensity control removed)
  document.documentElement.style.setProperty('--glass-blur', '24px');

  // Card shape kept at default (rounded; shape control removed)
  document.body.classList.add('shape-rounded');

  // ── Avatar Icon ──
  const avatarIconBtns = document.querySelectorAll('#avatarIconGroup .font-size-btn');
  const avatarIconEl = document.querySelector('.avatar i');
  function applyAvatarIcon(icon) {
    if (avatarIconEl) avatarIconEl.className = 'fas ' + icon;
    avatarIconBtns.forEach(b => b.classList.toggle('active', b.dataset.icon === icon));
  }
  applyAvatarIcon(localStorage.getItem('drHoneyAvatarIcon') || 'fa-robot');
  avatarIconBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      applyAvatarIcon(btn.dataset.icon);
      localStorage.setItem('drHoneyAvatarIcon', btn.dataset.icon);
    });
  });

  // ── Card Wallpaper (upload from gallery, with crop preview) ──
  const mainCardEl = document.getElementById('mainCard');
  const cardWallpaperEl = document.getElementById('cardWallpaper');
  const cardWallpaperInput = document.getElementById('cardWallpaperInput');
  const cardWallpaperUploadBtn = document.getElementById('cardWallpaperUploadBtn');
  const cardWallpaperRemoveBtn = document.getElementById('cardWallpaperRemoveBtn');

  const wallpaperCropOverlay = document.getElementById('wallpaperCropOverlay');
  const wallpaperCropViewport = document.getElementById('wallpaperCropViewport');
  const wallpaperCropImage = document.getElementById('wallpaperCropImage');
  const wallpaperCropZoom = document.getElementById('wallpaperCropZoom');
  const wallpaperCropCancelBtn = document.getElementById('wallpaperCropCancelBtn');
  const wallpaperCropApplyBtn = document.getElementById('wallpaperCropApplyBtn');

  function applyCardWallpaper(dataUrl) {
    if (!mainCardEl || !cardWallpaperEl) return;
    if (dataUrl) {
      cardWallpaperEl.style.backgroundImage = `url("${dataUrl}")`;
      mainCardEl.classList.add('has-wallpaper');
      cardWallpaperRemoveBtn.style.display = 'flex';
    } else {
      cardWallpaperEl.style.backgroundImage = '';
      mainCardEl.classList.remove('has-wallpaper');
      cardWallpaperRemoveBtn.style.display = 'none';
    }
  }

  const savedCardWallpaper = localStorage.getItem('drHoneyCardWallpaper');
  if (savedCardWallpaper) applyCardWallpaper(savedCardWallpaper);

  cardWallpaperUploadBtn.addEventListener('click', () => cardWallpaperInput.click());

  // ---- Crop state ----
  let cropImgEl = null;
  let cropFrameW = 0, cropFrameH = 0;
  let cropMinScale = 1, cropScale = 1;
  let cropOffsetX = 0, cropOffsetY = 0;
  let cropDragging = false, cropDragStartX = 0, cropDragStartY = 0, cropStartOffsetX = 0, cropStartOffsetY = 0;

  function clampCropOffsets() {
    const scaledW = cropImgEl.naturalWidth * cropScale;
    const scaledH = cropImgEl.naturalHeight * cropScale;
    const minX = Math.min(0, cropFrameW - scaledW);
    const minY = Math.min(0, cropFrameH - scaledH);
    cropOffsetX = Math.max(minX, Math.min(0, cropOffsetX));
    cropOffsetY = Math.max(minY, Math.min(0, cropOffsetY));
  }

  function updateCropTransform() {
    clampCropOffsets();
    wallpaperCropImage.style.transform = `translate(${cropOffsetX}px, ${cropOffsetY}px) scale(${cropScale})`;
  }

  function openWallpaperCrop(img) {
    cropImgEl = img;

    // Match the crop frame to the real card's own aspect ratio so the
    // preview shows exactly what will be visible on the card.
    const cardRect = mainCardEl.getBoundingClientRect();
    const aspect = (cardRect.width && cardRect.height) ? (cardRect.width / cardRect.height) : (9 / 16);

    let vw = Math.min(360, window.innerWidth - 64);
    let vh = vw / aspect;
    const maxVh = Math.min(440, window.innerHeight * 0.5);
    if (vh > maxVh) { vh = maxVh; vw = vh * aspect; }

    cropFrameW = vw;
    cropFrameH = vh;
    wallpaperCropViewport.style.width = vw + 'px';
    wallpaperCropViewport.style.height = vh + 'px';

    cropMinScale = Math.max(cropFrameW / img.naturalWidth, cropFrameH / img.naturalHeight);
    cropScale = cropMinScale;
    cropOffsetX = (cropFrameW - img.naturalWidth * cropScale) / 2;
    cropOffsetY = (cropFrameH - img.naturalHeight * cropScale) / 2;

    wallpaperCropImage.src = img.src;
    wallpaperCropZoom.value = 100;
    updateCropTransform();
    wallpaperCropOverlay.classList.add('open');
  }

  function closeWallpaperCrop() {
    wallpaperCropOverlay.classList.remove('open');
    cropImgEl = null;
  }

  wallpaperCropViewport.addEventListener('pointerdown', (e) => {
    if (!cropImgEl) return;
    cropDragging = true;
    cropDragStartX = e.clientX;
    cropDragStartY = e.clientY;
    cropStartOffsetX = cropOffsetX;
    cropStartOffsetY = cropOffsetY;
    wallpaperCropViewport.setPointerCapture(e.pointerId);
  });
  wallpaperCropViewport.addEventListener('pointermove', (e) => {
    if (!cropDragging) return;
    cropOffsetX = cropStartOffsetX + (e.clientX - cropDragStartX);
    cropOffsetY = cropStartOffsetY + (e.clientY - cropDragStartY);
    updateCropTransform();
  });
  const endCropDrag = () => { cropDragging = false; };
  wallpaperCropViewport.addEventListener('pointerup', endCropDrag);
  wallpaperCropViewport.addEventListener('pointercancel', endCropDrag);
  wallpaperCropViewport.addEventListener('pointerleave', endCropDrag);

  wallpaperCropZoom.addEventListener('input', () => {
    if (!cropImgEl) return;
    const zoomFactor = parseInt(wallpaperCropZoom.value, 10) / 100; // 1x .. 3x over the min "cover" scale
    const oldScale = cropScale;
    const newScale = cropMinScale * zoomFactor;
    const cx = cropFrameW / 2, cy = cropFrameH / 2;
    const imgX = (cx - cropOffsetX) / oldScale;
    const imgY = (cy - cropOffsetY) / oldScale;
    cropScale = newScale;
    cropOffsetX = cx - imgX * cropScale;
    cropOffsetY = cy - imgY * cropScale;
    updateCropTransform();
  });

  wallpaperCropCancelBtn.addEventListener('click', closeWallpaperCrop);

  wallpaperCropApplyBtn.addEventListener('click', () => {
    if (!cropImgEl) return;

    // Render at a high resolution (Full HD-class width) straight from the
    // original full-quality image, so the saved wallpaper stays sharp.
    const outW = 1080;
    const outH = Math.round(outW * (cropFrameH / cropFrameW));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const renderScale = outW / cropFrameW;
    ctx.drawImage(
      cropImgEl,
      0, 0, cropImgEl.naturalWidth, cropImgEl.naturalHeight,
      cropOffsetX * renderScale, cropOffsetY * renderScale,
      cropImgEl.naturalWidth * cropScale * renderScale,
      cropImgEl.naturalHeight * cropScale * renderScale
    );

    const finalDataUrl = canvas.toDataURL('image/jpeg', 0.95);
    try {
      localStorage.setItem('drHoneyCardWallpaper', finalDataUrl);
      applyCardWallpaper(finalDataUrl);
      showToast('Card wallpaper updated 🖼️', 'success', 1800);
    } catch {
      showToast('Could not save wallpaper (storage full)', 'error', 2200);
    }
    closeWallpaperCrop();
  });

  cardWallpaperInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    cardWallpaperInput.value = ''; // allow re-selecting the same file later
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file', 'error', 1800);
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('Image is too large (max 15MB)', 'error', 2000);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => openWallpaperCrop(img);
      img.onerror = () => showToast('Could not read that image', 'error', 1800);
      img.src = ev.target.result;
    };
    reader.onerror = () => showToast('Could not read file', 'error', 1800);
    reader.readAsDataURL(file);
  });

  cardWallpaperRemoveBtn.addEventListener('click', () => {
    localStorage.removeItem('drHoneyCardWallpaper');
    applyCardWallpaper(null);
    showToast('Card wallpaper removed', 'info', 1600);
  });

  // ── Export / Import Settings ──
  const SETTINGS_KEYS = [
    'drHoneyColor','drHoneyCustomColorHex','drHoneyTheme','drHoneySound','drHoneyFontSize',
    'drHoneyAvatarIcon','drHoneyCardWallpaper','drHoneyLang'
  ];
  const exportSettingsBtn = document.getElementById('exportSettingsBtn');
  const importSettingsBtn = document.getElementById('importSettingsBtn');
  exportSettingsBtn.addEventListener('click', async () => {
    const data = {};
    SETTINGS_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) data[k] = v; });
    const code = btoa(encodeURIComponent(JSON.stringify(data)));
    try {
      await navigator.clipboard.writeText(code);
      showToast('Settings code copied to clipboard! 📋', 'success', 2200);
    } catch {
      window.prompt('Copy this settings code:', code);
    }
  });
  importSettingsBtn.addEventListener('click', () => {
    const code = window.prompt('Paste your settings code:');
    if (!code) return;
    try {
      const data = JSON.parse(decodeURIComponent(atob(code.trim())));
      Object.keys(data).forEach(k => localStorage.setItem(k, data[k]));
      showToast('Settings imported! Reloading… ✅', 'success', 1800);
      setTimeout(() => window.location.reload(), 900);
    } catch {
      showToast('Invalid settings code ❌', 'error', 2000);
    }
  });

  // Refresh stats: re-pull commands count + usage chart from the server
  refreshStatsBtn.addEventListener('click', () => {
    refreshStatsBtn.disabled = true;
    const icon = refreshStatsBtn.querySelector('i');
    icon.classList.add('fa-spin');
    Promise.allSettled([
      fetch('/api/commands').then(r => r.json()).then(d => {
        allCommandsCache = d.commands || [];
        commandsCount.textContent = (d.total || allCommandsCache.length) + ' cmds';
      }),
      fetch('/api/usage').then(r => r.json()).then(d => renderUsageChart(d.data || []))
    ]).finally(() => {
      icon.classList.remove('fa-spin');
      refreshStatsBtn.disabled = false;
      showToast('Stats refreshed ✅', 'success', 1800);
    });
  });

  // Share site: native share sheet on mobile, clipboard copy fallback on desktop
  shareSiteBtn.addEventListener('click', async () => {
    const shareData = {
      title: 'Dr Honey',
      text: 'Connect your WhatsApp bot with Dr Honey!',
      url: window.location.href
    };
    if (navigator.share) {
      try { await navigator.share(shareData); }
      catch (e) { /* user cancelled share, ignore */ }
    } else {
      try {
        await navigator.clipboard.writeText(shareData.url);
        showToast('Link copied to clipboard! 🔗', 'success', 2000);
      } catch (e) {
        showToast('Could not copy link', 'error', 2000);
      }
    }
    settingsPanel.classList.remove('open');
  });

  // Font size control
  const fontSizeBtns = document.querySelectorAll('.font-size-btn');
  function applyFontSize(size) {
    if (size === 'normal') {
      document.body.removeAttribute('data-fontsize');
    } else {
      document.body.dataset.fontsize = size;
    }
    fontSizeBtns.forEach(b => b.classList.toggle('active', b.dataset.size === size));
  }
  const savedFontSize = localStorage.getItem('drHoneyFontSize') || 'normal';
  applyFontSize(savedFontSize);
  fontSizeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const size = btn.dataset.size;
      applyFontSize(size);
      localStorage.setItem('drHoneyFontSize', size);
    });
  });

  // Reset theme to default (purple, dark mode)
  const resetThemeBtn = document.getElementById('resetThemeBtn');
  resetThemeBtn.addEventListener('click', () => {
    applyColor('purple');
    localStorage.setItem('drHoneyColor', 'purple');
    localStorage.removeItem('drHoneyCustomColorHex');
    applyDark();
    localStorage.setItem('drHoneyTheme', 'dark');
    showToast('Theme reset to default 🎨', 'info', 1800);
  });

  // Clear all saved preferences (color, theme, sound, font size)
  const clearDataBtn = document.getElementById('clearDataBtn');
  clearDataBtn.addEventListener('click', () => {
    if (!confirm('This will clear all saved preferences (theme, color, sound, font size, glow animation, and other customizations) on this device. Continue?')) return;
    ['drHoneyColor','drHoneyCustomColorHex','drHoneyTheme','drHoneySound','drHoneyFontSize',
     'drHoneyAvatarIcon','drHoneyCardWallpaper']
      .forEach(k => localStorage.removeItem(k));
    showToast('Saved data cleared. Reloading…', 'info', 1500);
    setTimeout(() => location.reload(), 900);
  });

  // ══════════════════════════════════════════════════
  // 🌍 COUNTRY FLAG AUTO-DETECT
  // ══════════════════════════════════════════════════
  const countryData = [
    { code:"92", flag:"🇵🇰", name:"Pakistan" },
    { code:"91", flag:"🇮🇳", name:"India" },
    { code:"1",  flag:"🇺🇸", name:"USA / Canada" },
    { code:"44", flag:"🇬🇧", name:"United Kingdom" },
    { code:"971",flag:"🇦🇪", name:"UAE" },
    { code:"966",flag:"🇸🇦", name:"Saudi Arabia" },
    { code:"880", flag:"🇧🇩",name:"Bangladesh" },
    { code:"20", flag:"🇪🇬", name:"Egypt" },
    { code:"234",flag:"🇳🇬", name:"Nigeria" },
    { code:"254",flag:"🇰🇪", name:"Kenya" },
    { code:"27", flag:"🇿🇦", name:"South Africa" },
    { code:"62", flag:"🇮🇩", name:"Indonesia" },
    { code:"60", flag:"🇲🇾", name:"Malaysia" },
    { code:"65", flag:"🇸🇬", name:"Singapore" },
    { code:"63", flag:"🇵🇭", name:"Philippines" },
    { code:"66", flag:"🇹🇭", name:"Thailand" },
    { code:"84", flag:"🇻🇳", name:"Vietnam" },
    { code:"86", flag:"🇨🇳", name:"China" },
    { code:"81", flag:"🇯🇵", name:"Japan" },
    { code:"82", flag:"🇰🇷", name:"South Korea" },
    { code:"55", flag:"🇧🇷", name:"Brazil" },
    { code:"52", flag:"🇲🇽", name:"Mexico" },
    { code:"54", flag:"🇦🇷", name:"Argentina" },
    { code:"49", flag:"🇩🇪", name:"Germany" },
    { code:"33", flag:"🇫🇷", name:"France" },
    { code:"39", flag:"🇮🇹", name:"Italy" },
    { code:"34", flag:"🇪🇸", name:"Spain" },
    { code:"7",  flag:"🇷🇺", name:"Russia" },
    { code:"90", flag:"🇹🇷", name:"Turkey" },
    { code:"98", flag:"🇮🇷", name:"Iran" },
    { code:"93", flag:"🇦🇫", name:"Afghanistan" },
    { code:"964",flag:"🇮🇶", name:"Iraq" },
    { code:"961",flag:"🇱🇧", name:"Lebanon" },
    { code:"962",flag:"🇯🇴", name:"Jordan" },
    { code:"213",flag:"🇩🇿", name:"Algeria" },
    { code:"216",flag:"🇹🇳", name:"Tunisia" },
    { code:"212",flag:"🇲🇦", name:"Morocco" },
    { code:"256",flag:"🇺🇬", name:"Uganda" },
    { code:"255",flag:"🇹🇿", name:"Tanzania" },
    { code:"233",flag:"🇬🇭", name:"Ghana" },
    { code:"94", flag:"🇱🇰", name:"Sri Lanka" },
    { code:"977", flag:"🇳🇵",name:"Nepal" },
    { code:"95", flag:"🇲🇲", name:"Myanmar" },
    { code:"61", flag:"🇦🇺", name:"Australia" },
    { code:"64", flag:"🇳🇿", name:"New Zealand" },
    { code:"31", flag:"🇳🇱", name:"Netherlands" },
    { code:"32", flag:"🇧🇪", name:"Belgium" },
    { code:"41", flag:"🇨🇭", name:"Switzerland" },
    { code:"46", flag:"🇸🇪", name:"Sweden" },
    { code:"47", flag:"🇳🇴", name:"Norway" },
    { code:"45", flag:"🇩🇰", name:"Denmark" },
    { code:"48", flag:"🇵🇱", name:"Poland" },
    { code:"380",flag:"🇺🇦", name:"Ukraine" },
    { code:"30", flag:"🇬🇷", name:"Greece" },
    { code:"351",flag:"🇵🇹", name:"Portugal" },
    { code:"420",flag:"🇨🇿", name:"Czech Republic" },
    { code:"36", flag:"🇭🇺", name:"Hungary" },
    { code:"40", flag:"🇷🇴", name:"Romania" },
  ];

  // Sort by code length descending for longest-match first
  const sortedCountries = [...countryData].sort((a,b)=>b.code.length-a.code.length);

  function detectCountry(number) {
    for (const c of sortedCountries) {
      if (number.startsWith(c.code)) return c;
    }
    return null;
  }

  phoneInput.addEventListener('input', function() {
    this.value = this.value.replace(/\D/g, '').slice(0, 15);
    const val = this.value;
    const country = detectCountry(val);
    if (country && val.length >= country.code.length) {
      flagEmoji.textContent = country.flag;
      countryLabel.textContent = country.flag + ' ' + country.name;
    } else {
      flagEmoji.textContent = '🌍';
      countryLabel.textContent = '';
    }
  });
  phoneInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') requestPairingBtn.click();
  });

  // ══════════════════════════════════════════════════
  // 🤖 BOT STATUS INDICATOR
  // ══════════════════════════════════════════════════
  function updateBotStatus(isOnline, count = 0) {
    if (!botStatusDot || !botStatusText) return;
    if (isOnline && count > 0) {
      botStatusDot.className = 'bot-status-dot online';
      botStatusText.className = 'bot-status-text online';
      botStatusText.textContent = 'Online';
    } else {
      botStatusDot.className = 'bot-status-dot offline';
      botStatusText.className = 'bot-status-text offline';
      botStatusText.textContent = 'Offline';
    }
  }
  updateBotStatus(false, 0);

  // ══════════════════════════════════════════════════
  // 📊 COMMANDS COUNT BADGE
  // ══════════════════════════════════════════════════
  const commandsCount = document.getElementById('commandsCount');

  function loadCommandsCount() {
    fetch('/api/commands')
      .then(r => r.json())
      .then(d => {
        allCommandsCache = d.commands || [];
        const cnt = d.total || allCommandsCache.length;
        commandsCount.textContent = cnt + ' cmds';
      })
      .catch(() => { commandsCount.textContent = '? cmds'; });
  }
  loadCommandsCount();

  // ══════════════════════════════════════════════════
  // 📜 COMMANDS LIST MODAL
  // ══════════════════════════════════════════════════
  const commandsBadge = document.getElementById('commandsBadge');
  const commandsModalOverlay = document.getElementById('commandsModalOverlay');
  const commandsModalClose = document.getElementById('commandsModalClose');
  const commandsModalBody = document.getElementById('commandsModalBody');
  const commandsModalCount = document.getElementById('commandsModalCount');
  const commandsSearchInput = document.getElementById('commandsSearchInput');

  const categoryIcons = {
    admin:      'fa-user-shield',
    fun:        'fa-face-laugh',
    downloader: 'fa-download',
    download:   'fa-download',
    utility:    'fa-toolbox',
    other:      'fa-shapes',
    group:      'fa-users',
    owner:      'fa-crown',
    converter:  'fa-arrows-rotate',
    convert:    'fa-arrows-rotate',
    search:     'fa-magnifying-glass',
    music:      'fa-music',
    sticker:    'fa-sticky-note',
    tools:      'fa-wrench'
  };

  function renderCommandsList(list) {
    if (!list.length) {
      commandsModalBody.innerHTML = '<div class="commands-empty"><i class="fas fa-ghost"></i><br>No commands found.</div>';
      return;
    }
    // Group by category
    const groups = {};
    list.forEach(cmd => {
      const cat = cmd.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(cmd);
    });

    const sortedCats = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    let html = '';
    sortedCats.forEach(cat => {
      const icon = categoryIcons[cat.toLowerCase()] || 'fa-shapes';
      html += `<div class="commands-category-group">
        <div class="commands-category-title">
          <i class="fas ${icon}"></i> ${cat.toUpperCase()} <span class="count-chip">${groups[cat].length}</span>
        </div>`;
      groups[cat].forEach(cmd => {
        html += `<div class="command-row">
          <span class="cmd-tag">.${escapeHtml(cmd.name)}</span>
          <div class="cmd-info">
            ${cmd.desc ? `<div class="cmd-desc">${escapeHtml(cmd.desc)}</div>` : ''}
            ${cmd.use ? `<div class="cmd-use">${escapeHtml(cmd.use)}</div>` : ''}
          </div>
        </div>`;
      });
      html += `</div>`;
    });
    commandsModalBody.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function openCommandsModal() {
    commandsModalOverlay.style.display = 'flex';
    commandsSearchInput.value = '';
    document.body.style.overflow = 'hidden';

    if (allCommandsCache.length) {
      commandsModalCount.textContent = allCommandsCache.length;
      renderCommandsList(allCommandsCache);
    } else {
      commandsModalBody.innerHTML = '<div class="commands-loading"><i class="fas fa-spinner fa-spin"></i> Loading commands...</div>';
      fetch('/api/commands')
        .then(r => r.json())
        .then(d => {
          allCommandsCache = d.commands || [];
          commandsModalCount.textContent = d.total || allCommandsCache.length;
          renderCommandsList(allCommandsCache);
        })
        .catch(() => {
          commandsModalBody.innerHTML = '<div class="commands-empty"><i class="fas fa-triangle-exclamation"></i><br>Could not load commands.</div>';
        });
    }
  }

  function closeCommandsModal() {
    commandsModalOverlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  commandsBadge.addEventListener('click', openCommandsModal);
  commandsModalClose.addEventListener('click', closeCommandsModal);
  commandsModalOverlay.addEventListener('click', (e) => {
    if (e.target === commandsModalOverlay) closeCommandsModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && commandsModalOverlay.style.display === 'flex') closeCommandsModal();
  });

  commandsSearchInput.addEventListener('input', () => {
    const term = commandsSearchInput.value.trim().toLowerCase();
    if (!term) { renderCommandsList(allCommandsCache); return; }
    const filtered = allCommandsCache.filter(c =>
      c.name.toLowerCase().includes(term) ||
      (c.desc || '').toLowerCase().includes(term) ||
      (c.category || '').toLowerCase().includes(term)
    );
    renderCommandsList(filtered);
  });

  // ── Request a New Command ──
  const cmdRequestToggle  = document.getElementById('cmdRequestToggle');
  const cmdRequestForm    = document.getElementById('cmdRequestForm');
  const cmdRequestName    = document.getElementById('cmdRequestName');
  const cmdRequestDesc    = document.getElementById('cmdRequestDesc');
  const cmdRequestSubmit  = document.getElementById('cmdRequestSubmit');

  cmdRequestToggle.addEventListener('click', () => {
    const isOpen = cmdRequestForm.classList.toggle('open');
    cmdRequestToggle.classList.toggle('open', isOpen);
    if (isOpen) setTimeout(() => cmdRequestName.focus(), 150);
  });

  cmdRequestSubmit.addEventListener('click', async () => {
    const name = cmdRequestName.value.trim();
    const description = cmdRequestDesc.value.trim();

    if (!name) { showToast('Please enter a command name', 'error', 1800); cmdRequestName.focus(); return; }
    if (description.length < 5) { showToast('Please describe the command a bit more', 'error', 1800); cmdRequestDesc.focus(); return; }

    cmdRequestSubmit.disabled = true;
    const originalHtml = cmdRequestSubmit.innerHTML;
    cmdRequestSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    try {
      const res = await fetch('/api/command-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description })
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        showToast('Thanks! Your command request was sent 🙌', 'success', 2400);
        cmdRequestName.value = '';
        cmdRequestDesc.value = '';
        cmdRequestName.focus();
      } else {
        showToast(data.error || 'Could not send request. Try again later.', 'error', 2400);
      }
    } catch {
      showToast('Network error. Please try again.', 'error', 2200);
    } finally {
      cmdRequestSubmit.disabled = false;
      cmdRequestSubmit.innerHTML = originalHtml;
    }
  });

  // ══════════════════════════════════════════════════
  // 📈 USAGE GRAPH (last 7 days)
  // ══════════════════════════════════════════════════
  function renderUsageChart(data) {
    const chart = document.getElementById('usageChart');
    if (!chart) return;
    chart.innerHTML = '';
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const today = new Date().getDay();
    const max = Math.max(...data.map(d=>d.count), 1);
    data.forEach((d, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'usage-bar-wrap';
      const barH = Math.max(4, Math.round((d.count / max) * 60));
      const isToday = i === data.length - 1;
      wrap.innerHTML = `
        <div class="usage-val">${d.count}</div>
        <div class="usage-bar${isToday?' today':''}" style="height:${barH}px"></div>
        <div class="usage-day">${d.day}</div>
      `;
      chart.appendChild(wrap);
    });
  }

  function loadUsageData() {
    fetch('/api/usage')
      .then(r => r.json())
      .then(d => renderUsageChart(d.data || []))
      .catch(() => {
        // Demo fallback
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const td = new Date().getDay();
        const demo = [];
        for (let i = 6; i >= 0; i--) {
          const di = (td - i + 7) % 7;
          demo.push({ day: days[di], count: i === 0 ? 0 : Math.floor(Math.random()*12+1) });
        }
        renderUsageChart(demo);
      });
  }
  loadUsageData();

  // ══════════════════════════════════════════════════
  // ⭐ CONFETTI / FIREWORKS ANIMATION
  // ══════════════════════════════════════════════════
  function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const pieces = [];
    const colors = ['#6c3adb','#8b5cf6','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#fbbf24'];

    for (let i = 0; i < 180; i++) {
      pieces.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 10 + 4,
        h: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        speed: Math.random() * 3 + 2,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.15,
        drift: (Math.random() - 0.5) * 2
      });
    }

    let frame = 0;
    const maxFrames = 140;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - frame / maxFrames);
        ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
        ctx.restore();
        p.y     += p.speed;
        p.x     += p.drift;
        p.angle += p.spin;
      });
      frame++;
      if (frame < maxFrames) requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    draw();
  }

  // ══════════════════════════════════════════════════
  // ⭐ SUCCESS OVERLAY
  // ══════════════════════════════════════════════════
  const successOverlay  = document.getElementById('successOverlay');
  const successCloseBtn = document.getElementById('successCloseBtn');
  const successSessionId= document.getElementById('successSessionId');

  function showSuccessScreen(sessionId) {
    successSessionId.textContent = 'Session: ' + (sessionId || '');
    successOverlay.style.display = 'flex';
    launchConfetti();
    playSuccessSound();
  }

  successCloseBtn.addEventListener('click', () => {
    successOverlay.style.display = 'none';
  });

  // ══════════════════════════════════════════════════
  // ⏱️ COUNTDOWN TIMER
  // ══════════════════════════════════════════════════
  let countdownInterval = null;

  function startCountdown(seconds = 60) {
    clearInterval(countdownInterval);
    let remaining = seconds;
    countdownWrap.style.display = 'block';
    countdownBar.style.width = '100%';
    countdownBar.classList.remove('danger');
    countdownSec.textContent = remaining;

    countdownInterval = setInterval(() => {
      remaining--;
      countdownSec.textContent = remaining;
      countdownBar.style.width = (remaining / seconds * 100) + '%';
      if (remaining <= 15) {
        countdownBar.classList.add('danger');
        countdownSec.style.color = '#ef4444';
      }
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        countdownWrap.style.display = 'none';
        countdownSec.style.color = '';
        showToast('⏰ Code expired! Please generate a new one.', 'warning');
        showStatus('<span class="status-msg" style="color:#f59e0b;">⏰ Code expired. Generate a new one.</span>', 'warning');
        stepsWrap.style.display = 'none';
        loadUsageData();
      }
    }, 1000);
  }

  function stopCountdown() {
    clearInterval(countdownInterval);
    countdownWrap.style.display = 'none';
    countdownSec.style.color = '';
  }

  // ── Show status ──────────────────────────────────────────
  function showStatus(html, type = '') {
    statusEl.innerHTML = html;
    statusEl.className = 'code-box fade-in' + (type ? ' ' + type : '');
  }

  // ══════════════════════════════════════════════════
  // 🔀 PAIR METHOD TABS (Code vs QR)
  // ══════════════════════════════════════════════════
  function setPairMethod(method) {
    const isQr = method === 'qr';
    tabCode.classList.toggle('active', !isQr);
    tabQr.classList.toggle('active', isQr);
    codeMethodPanel.style.display = isQr ? 'none' : 'block';
    qrMethodPanel.style.display   = isQr ? 'block' : 'none';
    statusEl.style.display        = isQr ? 'none' : 'flex';
    setStepsForMethod(isQr);
    stopCountdown();
    stepsWrap.style.display = 'none';
    showStatus(
      isQr
        ? '<span class="placeholder-txt">Your pair code will appear here</span>'
        : '<span class="placeholder-txt">Your pair code will appear here</span>'
    );
  }

  if (tabCode) tabCode.addEventListener('click', () => setPairMethod('code'));
  if (tabQr)   tabQr.addEventListener('click', () => setPairMethod('qr'));

  // ══════════════════════════════════════════════════
  // 📷 REQUEST QR CODE
  // ══════════════════════════════════════════════════
  if (requestQrBtn) {
    requestQrBtn.addEventListener('click', async () => {
      requestQrBtn.disabled = true;
      requestQrBtn.innerHTML = '<span class="spinner"></span> Generating...';
      qrBox.innerHTML = '<span class="placeholder-txt">Waiting for QR code…</span>';
      showToast('Generating your QR code...', 'info', 2500);

      try {
        const res = await fetch('/api/pair-qr', {
          method: 'POST',
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ socketId: socket.id }),
        });
        const data = await res.json();

        if (!res.ok) {
          qrBox.innerHTML = `<span class="placeholder-txt" style="color:#ef4444;">❌ ${data.error || 'Failed to start QR session.'}</span>`;
          showToast(data.error || 'Failed to start QR session.', 'error');
          return;
        }

        stepsWrap.style.display = 'none';
        loadUsageData();
        showToast('Scan the QR code with WhatsApp!', 'success');
        fetch('/api/usage/track', { method: 'POST' }).catch(() => {});
      } catch (err) {
        qrBox.innerHTML = '<span class="placeholder-txt" style="color:#ef4444;">❌ Network error. Please try again.</span>';
        showToast('Network error. Try again.', 'error');
      } finally {
        requestQrBtn.disabled = false;
        requestQrBtn.innerHTML = '<i class="fas fa-qrcode"></i> Generate QR Code';
      }
    });
  }

  // Show the incoming QR image whenever the server (re)issues one
  socket.on('qrCode', ({ qrDataUrl }) => {
    if (!qrBox) return;
    qrBox.innerHTML = `<img src="${qrDataUrl}" alt="WhatsApp QR code" class="qr-img" />`;
    startCountdown(20);
  });

  socket.on('qrLinked', () => {
    stopCountdown();
    stepsWrap.style.display = 'none';
    loadUsageData();
    if (qrBox) qrBox.innerHTML = '<span class="placeholder-txt" style="color:#10b981;">✅ Scanned! Connecting…</span>';
  });

  // ══════════════════════════════════════════════════
  // 🔑 REQUEST PAIRING + COPY BUTTON
  // ══════════════════════════════════════════════════
  if (requestPairingBtn && phoneInput) {
  requestPairingBtn.addEventListener("click", async () => {
    const number = (phoneInput.value || "").trim().replace(/\D/g, "");

    if (!number) {
      showStatus('<span class="status-msg" style="color:#ef4444">❌ Please enter your phone number with country code.</span>', 'error');
      showToast('Enter your phone number first!', 'error');
      return;
    }
    if (!/^[0-9]{8,15}$/.test(number)) {
      showStatus('<span class="status-msg" style="color:#ef4444">❌ Invalid number. Digits only, 8–15 characters.</span>', 'error');
      showToast('Invalid number format!', 'error');
      return;
    }

    try { playGenerateSound(); } catch (_) {}
    try { stopCountdown(); } catch (_) {}
    try { if (stepsWrap) stepsWrap.style.display = 'none'; } catch (_) {}

    requestPairingBtn.disabled = true;
    requestPairingBtn.innerHTML = '<span class="spinner"></span> Generating...';
    showStatus('<span class="status-msg" style="color:#6c3adb"><span class="spinner" style="border-color:rgba(108,58,219,0.3);border-top-color:#6c3adb;"></span> &nbsp;Requesting pair code… wait 15–30 sec</span>', '');
    showToast('Generating pair code, please wait…', 'info', 4000);

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 90000) : null;

    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, socketId: (socket && socket.id) ? socket.id : undefined }),
        signal: controller ? controller.signal : undefined,
      });
      let data = {};
      try { data = await res.json(); } catch (_) { data = {}; }

      if (!res.ok) {
        showStatus(`<span class="status-msg" style="color:#ef4444">❌ ${data.error || data.details || "Failed to get pairing code."}</span>`, 'error');
        showToast(data.error || 'Failed to get pairing code. Try again.', 'error');
        return;
      }

      const code = (data.pairingCode || data.rawCode || "").toString().trim();
      if (!code) {
        showStatus('<span class="status-msg" style="color:#ef4444">❌ Empty code from server. Try again.</span>', 'error');
        showToast('Empty code. Try again.', 'error');
        return;
      }
      const spaced = code.replace(/-/g, '').match(/.{1,4}/g)?.join('-') || code;

      showStatus(`
        <div style="width:100%;text-align:center;">
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:nowrap;">
            <div class="pairing-code" id="pairingCode">${spaced}</div>
            <button class="copy-btn" id="copyBtn" type="button">
              <i class="fas fa-copy"></i> Copy
            </button>
          </div>
          <div class="pair-label" style="margin-top:4px;">
            <i class="fas fa-hand-pointer" style="font-size:0.7rem;"></i> Enter this code in WhatsApp → Linked Devices
          </div>
        </div>
      `, 'success');

      try { playGenerateSound(); } catch (_) {}
      showToast('Pair code ready! Enter in WhatsApp.', 'success');
      try { if (stepsWrap) stepsWrap.style.display = 'none'; } catch (_) {}
      try { loadUsageData(); } catch (_) {}
      try { startCountdown(60); } catch (_) {}
      try { fetch('/api/usage/track', { method:'POST' }).catch(()=>{}); } catch (_) {}

      const copyBtn = document.getElementById("copyBtn");
      const codeEl  = document.getElementById("pairingCode");
      function doCopy() {
        const raw = code.replace(/-/g, '');
        navigator.clipboard.writeText(raw).then(() => {
          if (copyBtn) {
            copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            copyBtn.classList.add('copied');
          }
          showToast('Code copied!', 'success', 2000);
          setTimeout(() => {
            if (copyBtn) {
              copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
              copyBtn.classList.remove('copied');
            }
          }, 2000);
        }).catch(() => showToast('Long-press the code to copy', 'warning'));
      }
      if (copyBtn) copyBtn.addEventListener("click", doCopy);
      if (codeEl)  codeEl.addEventListener("click", doCopy);

    } catch (err) {
      const msg = (err && err.name === 'AbortError')
        ? 'Timeout — server took too long. Try again.'
        : ('Network error: ' + (err && err.message ? err.message : 'try again'));
      showStatus('<span class="status-msg" style="color:#ef4444">❌ ' + msg + '</span>', 'error');
      showToast(msg, 'error');
      console.error('Pair error:', err);
    } finally {
      if (timer) clearTimeout(timer);
      requestPairingBtn.disabled = false;
      requestPairingBtn.innerHTML = '<i class="fas fa-key"></i> Generate Pair Code';
    }
  });
  } else {
    console.error('Pair UI missing: button or phone input not found');
  }

  // ── Socket events ────────────────────────────────────────
  socket.on("linked", ({ sessionId }) => {
    stopCountdown();
    stepsWrap.style.display = 'none';
    showStatus(`
      <div style="text-align:center;">
        <div style="font-size:2rem;color:#10b981;margin-bottom:8px;">✅</div>
        <div class="status-msg" style="color:#10b981;font-weight:700;">Successfully Connected!</div>
        <div class="pair-label">Session: ${sessionId}</div>
      </div>
    `, 'success');
    showToast('WhatsApp connected successfully! 🎉', 'success', 5000);
    updateBotStatus(true, 1);
    phoneInput.value = '';
    flagEmoji.textContent = '🌍';
    countryLabel.textContent = '';
    showSuccessScreen(sessionId);
    loadUsageData();
  });

  socket.on("unlinked",      () => showToast('Bot disconnected.', 'warning'));

  socket.on("pairingTimeout", ({ number }) => {
    stopCountdown();
    stepsWrap.style.display = 'none';
    loadUsageData();
    showStatus(`<div class="status-msg" style="color:#f59e0b;">⏰ Code for ${number} expired. Generate a new one.</div>`, 'warning');
    showToast('Pairing code expired!', 'warning');
  });

  // ── Live stats ──────────────────────────────────────────
  function animateTo(el, newVal) {
    if (!el) return;
    const current = parseInt(el.textContent.replace(/\D/g, '')) || 0;
    if (current === newVal) return;
    el.classList.remove('stat-tick');
    void el.offsetWidth;
    el.textContent = newVal;
    el.classList.add('stat-tick');
  }

  socket.on("statsUpdate", ({ activeSockets, totalUsers, totalBotLinked, totalQrLinked }) => {
    animateTo(document.getElementById("totalUsers"),  totalUsers    || 0);
    animateTo(document.getElementById("activeCount"), totalBotLinked || 0);
    animateTo(document.getElementById("qrCount"),     totalQrLinked || 0);
    updateBotStatus(activeSockets > 0, activeSockets);
  });

  // ── Auto-update commands badge + modal when a command is added/removed ─
  socket.on("commands-updated", ({ commands: list, total, changeType, filename }) => {
    allCommandsCache = list || [];
    const cnt = total || allCommandsCache.length;

    // Update badge count
    const badge = document.getElementById('commandsCount');
    if (badge) {
      badge.textContent = cnt + ' cmds';
      badge.classList.add('commands-badge-pulse');
      setTimeout(() => badge.classList.remove('commands-badge-pulse'), 1500);
    }

    // Update modal count
    const modalCount = document.getElementById('commandsModalCount');
    if (modalCount) modalCount.textContent = cnt;

    // Re-render modal body if it's currently open
    const overlay = document.getElementById('commandsModalOverlay');
    if (overlay && overlay.style.display === 'flex') {
      renderCommandsList(allCommandsCache);
    }

    // Toast notification — show what changed
    if (changeType === 'delete' && filename) {
      showToast(`🗑️ Command removed: .${filename}`, 'warning');
    } else if (changeType === 'add' && filename) {
      showToast(`✅ New command added: .${filename}`, 'success');
    } else if (changeType === 'update') {
      showToast(`🔄 Commands updated (${cnt} total)`, 'info');
    }
  });

  // ══════════════════════════════════════════════════
  // 📱 PWA SUPPORT
  // ══════════════════════════════════════════════════
  let deferredPrompt = null;
  const pwaBanner       = document.getElementById('pwaBanner');
  const pwaInstallBtn   = document.getElementById('pwaInstallBtn');
  const pwaDismiss      = document.getElementById('pwaDismiss');
  const settingsInstallBtn = document.getElementById('settingsInstallBtn');

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  // Always show the install banner (unless already installed or user dismissed it),
  // instead of waiting only for the browser's own beforeinstallprompt event.
  if (pwaBanner && !isStandalone && !localStorage.getItem('pwaDismissed')) {
    setTimeout(() => { pwaBanner.style.display = 'flex'; }, 1500);
  }

  async function triggerInstall() {
    if (deferredPrompt) {
      // Native install prompt available (Chrome/Android/Edge)
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (pwaBanner) pwaBanner.style.display = 'none';
      showToast(outcome === 'accepted' ? 'App installed! 🎉' : 'Maybe next time!', outcome === 'accepted' ? 'success' : 'info');
    } else if (isIOS) {
      // iOS Safari has no install API — show manual instructions
      showToast('Tap Share ⬆️ then "Add to Home Screen"', 'info');
    } else if (isStandalone) {
      showToast('App is already installed! 🎉', 'info');
    } else {
      // Criteria not met yet or unsupported browser — guide manually
      showToast('Open browser menu (⋮) and tap "Add to Home screen" / "Install app"', 'info');
    }
  }

  if (pwaInstallBtn) {
    pwaInstallBtn.addEventListener('click', triggerInstall);
  }

  if (settingsInstallBtn) {
    settingsInstallBtn.addEventListener('click', triggerInstall);
  }

  if (pwaDismiss) {
    pwaDismiss.addEventListener('click', () => {
      pwaBanner.style.display = 'none';
      localStorage.setItem('pwaDismissed', '1');
    });
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // ══════════════════════════════════════════════════
  // 🌐 MULTI-LANGUAGE TOGGLE (Settings Panel)
  // ══════════════════════════════════════════════════
  (function() {
    const langButtons  = document.querySelectorAll('.settings-lang-btn');

    const translations = {
      en: {
        brand_sub: "Connect your WhatsApp account",
        phone_label: "Enter your WhatsApp number with country code",
        generate_btn: "Generate Pair Code",
        stat_total_linked: "Total Num Linked",
        stat_bot_linked: "Total Bot Linked",
        stat_qr_linked: "Total QR Linked",
        faq_title: "FAQ & Help"
      },
      ur: {
        brand_sub: "اپنا واٹس ایپ اکاؤنٹ منسلک کریں",
        phone_label: "اپنا واٹس ایپ نمبر کوڈ کے ساتھ درج کریں",
        generate_btn: "پیئر کوڈ بنائیں",
        stat_total_linked: "کل منسلک نمبر",
        stat_bot_linked: "کل منسلک بوٹس",
        stat_qr_linked: "کل QR منسلک",
        faq_title: "سوالات و مدد"
      },
      hi: {
        brand_sub: "अपना व्हाट्सएप अकाउंट कनेक्ट करें",
        phone_label: "कंट्री कोड के साथ अपना व्हाट्सएप नंबर डालें",
        generate_btn: "पेयर कोड बनाएं",
        stat_total_linked: "कुल लिंक्ड नंबर",
        stat_bot_linked: "कुल लिंक्ड बॉट्स",
        stat_qr_linked: "कुल QR लिंक्ड",
        faq_title: "सहायता और सवाल"
      },
      ar: {
        brand_sub: "اربط حساب واتساب الخاص بك",
        phone_label: "أدخل رقم واتساب مع رمز الدولة",
        generate_btn: "إنشاء رمز الإقران",
        stat_total_linked: "إجمالي الأرقام المرتبطة",
        stat_bot_linked: "إجمالي البوتات المرتبطة",
        stat_qr_linked: "إجمالي روابط QR",
        faq_title: "الأسئلة الشائعة والمساعدة"
      }
    };

    function applyLanguage(lang) {
      const dict = translations[lang] || translations.en;
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) el.textContent = dict[key];
      });
      document.documentElement.setAttribute('lang', lang);
      document.documentElement.setAttribute('dir', lang === 'ar' || lang === 'ur' ? 'rtl' : 'ltr');
      langButtons.forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
      localStorage.setItem('drHoneyLang', lang);
    }

    langButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        applyLanguage(btn.dataset.lang);
        showToast(`Language changed! 🌐`, 'info', 1800);
      });
    });

    applyLanguage(localStorage.getItem('drHoneyLang') || 'en');
  })();

  // ══════════════════════════════════════════════════
  // ❓ FAQ / HELP MODAL
  // ══════════════════════════════════════════════════
  (function() {
    const faqBtn       = document.getElementById('faqBtn');
    const faqOverlay    = document.getElementById('faqModalOverlay');
    const faqClose      = document.getElementById('faqModalClose');
    const faqList       = document.getElementById('faqList');
    if (!faqBtn) return;

    const faqs = [
      { q: "How do I pair my WhatsApp number?", a: "Enter your WhatsApp number with the country code (e.g. 923123456789), tap 'Generate Pair Code', then in WhatsApp go to Settings → Linked Devices → Link a Device → Link with phone number, and enter the code shown." },
      { q: "Why did my pair code expire?", a: "Pair codes are only valid for a short time (usually 60 seconds) for security reasons. If it expires, simply tap 'Generate Pair Code' again to get a new one." },
      { q: "Is my number safe with this bot?", a: "Yes. Your number is only used to establish a WhatsApp Web-style linked-device session, exactly like scanning a QR code in WhatsApp. We don't store your password or messages." },
      { q: "Why do I need to join the channels first?", a: "Joining our official channels helps you stay updated on new features, outages, and announcements before using the pairing site." },
      { q: "The bot shows offline, what should I do?", a: "If the bot status badge shows offline, the server may be restarting or under maintenance. Please wait a few minutes and refresh the page." },
      { q: "How do I change the language?", a: "Tap the Settings icon (⚙️) in the top-right corner, then choose your preferred language from the Language section inside the settings panel." }
    ];

    function renderFaqs() {
      faqList.innerHTML = faqs.map((f, i) => `
        <div class="faq-item" data-idx="${i}">
          <div class="faq-question">${f.q} <i class="fas fa-chevron-down"></i></div>
          <div class="faq-answer">${f.a}</div>
        </div>
      `).join('');
      faqList.querySelectorAll('.faq-item').forEach(item => {
        item.querySelector('.faq-question').addEventListener('click', () => {
          item.classList.toggle('open');
        });
      });
    }

    faqBtn.addEventListener('click', () => {
      renderFaqs();
      faqOverlay.style.display = 'flex';
    });
    faqClose.addEventListener('click', () => { faqOverlay.style.display = 'none'; });
    faqOverlay.addEventListener('click', (e) => { if (e.target === faqOverlay) faqOverlay.style.display = 'none'; });
  })();


});
