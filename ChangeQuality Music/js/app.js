/* global bootstrap, $ */
(function () {
  'use strict';

  const state = {
    file: null,
    fileBuffer: null,
    objectUrl: null,
    audioContext: null,
    sourceNode: null,
    analyserNode: null,
    gainNode: null,
    audioElement: null,
    currentMode: 'original',
    animationId: null,
    decodedCache: null
  };

  const modeLabels = {
    original: 'Original Mix',
    vocal: 'Vocal Focus',
    bass: 'Bass Line',
    drums: 'Drums / Percussion',
    instrumental: 'Instrumental Focus'
  };

  $(initApp);

  function initApp() {
    state.audioElement = document.getElementById('audio-player');
    drawIdleSpectrum();
    bindEvents();
  }

  function bindEvents() {
    const $dropzone = $('#upload-dropzone');
    const fileInput = document.getElementById('audio-file-input');

    $('#choose-file-button, #upload-dropzone').on('click', function (event) {
      if (event.target.id !== 'audio-file-input') fileInput.click();
    });

    $dropzone.on('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });

    $dropzone.on('dragover', function (event) {
      event.preventDefault();
      $dropzone.addClass('dragover');
    });

    $dropzone.on('dragleave drop', function () {
      $dropzone.removeClass('dragover');
    });

    $dropzone.on('drop', function (event) {
      event.preventDefault();
      const file = event.originalEvent.dataTransfer.files[0];
      handleFile(file);
    });

    $('#audio-file-input').on('change', function (event) {
      handleFile(event.target.files[0]);
    });

    $('#stem-grid').on('click', '.stem-card', function () {
      const mode = $(this).data('mode');
      setMode(mode);
    });

    $('#play-pause-button').on('click', togglePlayPause);
    $('#rewind-button').on('click', () => seekBy(-10));
    $('#forward-button').on('click', () => seekBy(10));
    $('#master-volume').on('input', function () {
      if (state.gainNode) state.gainNode.gain.value = Number(this.value);
    });

    $('#download-stem-button').on('click', downloadSelectedStem);

    state.audioElement.addEventListener('play', async () => {
      await ensureAudioGraph();
      if (state.audioContext.state === 'suspended') await state.audioContext.resume();
      $('#play-pause-button i').attr('class', 'fa-solid fa-pause');
      startVisualizer();
    });

    state.audioElement.addEventListener('pause', () => {
      $('#play-pause-button i').attr('class', 'fa-solid fa-play');
    });

    state.audioElement.addEventListener('ended', () => {
      $('#play-pause-button i').attr('class', 'fa-solid fa-play');
    });

    state.audioElement.addEventListener('loadedmetadata', updateDurationMeta);
  }

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      showToast('لطفاً یک فایل صوتی معتبر انتخاب کنید.');
      return;
    }

    resetAudioGraph();
    state.file = file;
    state.decodedCache = null;
    state.fileBuffer = await file.arrayBuffer();

    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    state.audioElement.src = state.objectUrl;

    $('#empty-studio-state').addClass('d-none');
    $('#studio-dashboard').removeClass('d-none');
    $('#download-stem-button').prop('disabled', false);
    $('#track-title').text(stripExtension(file.name));
    $('#detail-name').text(file.name);
    $('#detail-size').text(formatBytes(file.size));
    $('#detail-type').text(file.type || 'audio/*');
    $('#file-meta').removeClass('d-none').html(`<strong>${escapeHtml(file.name)}</strong><br><span>${formatBytes(file.size)}</span>`);

    setMode('original');
    simulateProcessing();
    showToast('فایل با موفقیت بارگذاری شد. اکنون می‌توانید Stemها را پیش‌نمایش کنید.');
  }

  async function ensureAudioGraph() {
    if (!state.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      state.audioContext = new AudioContextClass();
      state.sourceNode = state.audioContext.createMediaElementSource(state.audioElement);
      state.analyserNode = state.audioContext.createAnalyser();
      state.analyserNode.fftSize = 2048;
      state.gainNode = state.audioContext.createGain();
      state.gainNode.gain.value = Number($('#master-volume').val() || 0.9);
    }
    routeAudioGraph();
  }

  function resetAudioGraph() {
    if (state.animationId) cancelAnimationFrame(state.animationId);
    state.animationId = null;
    if (state.audioElement) {
      state.audioElement.pause();
      state.audioElement.removeAttribute('src');
      state.audioElement.load();
    }
    if (state.audioContext) {
      try { state.sourceNode.disconnect(); } catch (error) { /* noop */ }
      state.audioContext.close();
    }
    state.audioContext = null;
    state.sourceNode = null;
    state.analyserNode = null;
    state.gainNode = null;
  }

  function setMode(mode) {
    state.currentMode = mode;
    $('.stem-card').removeClass('active');
    $(`.stem-card[data-mode="${mode}"]`).addClass('active');
    $('#process-status').html(`<i class="fa-solid fa-wave-square ms-2"></i>${modeLabels[mode]} فعال شد`);
    if (state.audioContext) routeAudioGraph();
  }

  function routeAudioGraph() {
    if (!state.sourceNode || !state.audioContext || !state.analyserNode || !state.gainNode) return;

    try { state.sourceNode.disconnect(); } catch (error) { /* noop */ }
    try { state.analyserNode.disconnect(); } catch (error) { /* noop */ }
    try { state.gainNode.disconnect(); } catch (error) { /* noop */ }

    const chain = createModeChain(state.audioContext, state.currentMode);
    let previous = state.sourceNode;
    chain.forEach((node) => {
      previous.connect(node);
      previous = node;
    });
    previous.connect(state.analyserNode);
    state.analyserNode.connect(state.gainNode);
    state.gainNode.connect(state.audioContext.destination);
  }

  function createModeChain(context, mode) {
    if (mode === 'original') return [];

    if (mode === 'vocal') {
      const highpass = biquad(context, 'highpass', 160, 0.75, 0);
      const presence = biquad(context, 'peaking', 1200, 1.1, 8);
      const clarity = biquad(context, 'peaking', 3200, 1.2, 5);
      const lowpass = biquad(context, 'lowpass', 4800, 0.8, 0);
      return [highpass, presence, clarity, lowpass];
    }

    if (mode === 'bass') {
      const lowpass = biquad(context, 'lowpass', 210, 0.9, 0);
      const sub = biquad(context, 'lowshelf', 85, 0.7, 10);
      return [lowpass, sub];
    }

    if (mode === 'drums') {
      const highpass = biquad(context, 'highpass', 120, 0.65, 0);
      const punch = biquad(context, 'peaking', 2300, 1.4, 8);
      const air = biquad(context, 'highshelf', 6200, 0.8, 6);
      return [highpass, punch, air];
    }

    if (mode === 'instrumental') {
      const highpass = biquad(context, 'highpass', 65, 0.7, 0);
      const vocalNotchA = biquad(context, 'notch', 950, 1.15, 0);
      const vocalNotchB = biquad(context, 'notch', 2600, 1.05, 0);
      const body = biquad(context, 'peaking', 180, 0.9, 3);
      return [highpass, vocalNotchA, vocalNotchB, body];
    }

    return [];
  }

  function biquad(context, type, frequency, q, gain) {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    node.gain.value = gain;
    return node;
  }

  function togglePlayPause() {
    if (!state.file) {
      showToast('اول یک فایل آهنگ آپلود کنید.');
      return;
    }
    if (state.audioElement.paused) {
      state.audioElement.play();
    } else {
      state.audioElement.pause();
    }
  }

  function seekBy(seconds) {
    if (!state.audioElement.duration) return;
    state.audioElement.currentTime = Math.min(Math.max(state.audioElement.currentTime + seconds, 0), state.audioElement.duration);
  }

  function startVisualizer() {
    if (!state.analyserNode) return;
    const canvas = document.getElementById('waveform-canvas');
    const ctx = canvas.getContext('2d');
    const bufferLength = state.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function render() {
      state.animationId = requestAnimationFrame(render);
      resizeCanvas(canvas, ctx);
      state.analyserNode.getByteFrequencyData(dataArray);
      drawSpectrum(ctx, canvas, dataArray, true);
    }

    render();
  }

  function drawIdleSpectrum() {
    const canvas = document.getElementById('mini-spectrum-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const bars = 80;
    const data = new Uint8Array(bars).map((_, index) => 35 + Math.sin(index * 0.42) * 28 + Math.random() * 38);
    resizeCanvas(canvas, ctx);
    drawSpectrum(ctx, canvas, data, false);
  }

  function drawSpectrum(ctx, canvas, dataArray, glow) {
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#8b5cf6');
    gradient.addColorStop(0.48, '#06b6d4');
    gradient.addColorStop(1, '#22c55e');

    if (glow) {
      ctx.shadowColor = 'rgba(6, 182, 212, .55)';
      ctx.shadowBlur = 14;
    } else {
      ctx.shadowBlur = 0;
    }

    const barWidth = Math.max(3, width / dataArray.length * 1.8);
    let x = 0;
    ctx.fillStyle = gradient;
    for (let i = 0; i < dataArray.length; i += Math.ceil(dataArray.length / 140)) {
      const value = dataArray[i] / 255;
      const barHeight = Math.max(4, value * height * 0.86);
      const radius = Math.min(8, barWidth / 2);
      roundRect(ctx, x, height - barHeight, barWidth, barHeight, radius);
      ctx.fill();
      x += barWidth + 3;
      if (x > width) break;
    }

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.moveTo(0, height * 0.5);
    ctx.lineTo(width, height * 0.5);
    ctx.stroke();
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  function resizeCanvas(canvas, ctx) {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.floor(rect.width * ratio);
    const height = Math.floor((canvas.getAttribute('height') || rect.height || 220) * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
  }

  function simulateProcessing() {
    let percent = 0;
    $('#quality-percent').text('0%');
    $('#quality-bar').css('width', '0%');
    $('#process-status').html('<i class="fa-solid fa-circle-notch fa-spin ms-2"></i>در حال تحلیل فرکانسی');

    const timer = setInterval(() => {
      percent += Math.floor(Math.random() * 13) + 7;
      if (percent >= 100) {
        percent = 100;
        clearInterval(timer);
        $('#process-status').html('<i class="fa-solid fa-check ms-2"></i>آماده پیش‌نمایش Stemها');
      }
      $('#quality-percent').text(`${percent}%`);
      $('#quality-bar').css('width', `${percent}%`);
    }, 150);
  }

  function updateDurationMeta() {
    $('#detail-duration').text(formatTime(state.audioElement.duration));
  }

  async function downloadSelectedStem() {
    if (!state.file || !state.fileBuffer) {
      showToast('برای ساخت خروجی ابتدا فایل صوتی انتخاب کنید.');
      return;
    }

    const button = $('#download-stem-button');
    button.prop('disabled', true).html('<i class="fa-solid fa-circle-notch fa-spin ms-2"></i>در حال رندر WAV...');

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const tempContext = new AudioContextClass();
      const sourceBuffer = state.decodedCache || await tempContext.decodeAudioData(state.fileBuffer.slice(0));
      state.decodedCache = sourceBuffer;
      await tempContext.close();

      const offline = new OfflineAudioContext(sourceBuffer.numberOfChannels, sourceBuffer.length, sourceBuffer.sampleRate);
      const source = offline.createBufferSource();
      source.buffer = sourceBuffer;

      const chain = createModeChain(offline, state.currentMode);
      let previous = source;
      chain.forEach((node) => {
        previous.connect(node);
        previous = node;
      });
      previous.connect(offline.destination);
      source.start(0);

      const rendered = await offline.startRendering();
      const wavBlob = audioBufferToWavBlob(rendered);
      const url = URL.createObjectURL(wavBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${stripExtension(state.file.name)}-${state.currentMode}.wav`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast('خروجی WAV انتخاب‌شده ساخته شد. توجه: این خروجی فیلتر فرکانسی است، نه جداسازی AI واقعی.');
    } catch (error) {
      console.error(error);
      showToast('رندر فایل ممکن نشد. ممکن است مرورگر فرمت فایل را پشتیبانی نکند.');
    } finally {
      button.prop('disabled', false).html('<i class="fa-solid fa-file-arrow-down ms-2"></i>دانلود خروجی انتخاب‌شده WAV');
    }
  }

  function audioBufferToWavBlob(buffer) {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numberOfChannels * 2 + 44;
    const arrayBuffer = new ArrayBuffer(length);
    const view = new DataView(arrayBuffer);
    const channels = [];
    let offset = 0;
    let position = 0;

    writeString(view, position, 'RIFF'); position += 4;
    view.setUint32(position, length - 8, true); position += 4;
    writeString(view, position, 'WAVE'); position += 4;
    writeString(view, position, 'fmt '); position += 4;
    view.setUint32(position, 16, true); position += 4;
    view.setUint16(position, 1, true); position += 2;
    view.setUint16(position, numberOfChannels, true); position += 2;
    view.setUint32(position, sampleRate, true); position += 4;
    view.setUint32(position, sampleRate * numberOfChannels * 2, true); position += 4;
    view.setUint16(position, numberOfChannels * 2, true); position += 2;
    view.setUint16(position, 16, true); position += 2;
    writeString(view, position, 'data'); position += 4;
    view.setUint32(position, length - position - 4, true); position += 4;

    for (let channel = 0; channel < numberOfChannels; channel++) {
      channels.push(buffer.getChannelData(channel));
    }

    while (position < length) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, channels[channel][offset] || 0));
        view.setInt16(position, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        position += 2;
      }
      offset++;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '-';
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${rest}`;
  }

  function stripExtension(name) {
    return name.replace(/\.[^/.]+$/, '');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function showToast(message) {
    $('#toast-message').text(message);
    const toastEl = document.getElementById('app-toast');
    const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 4200 });
    toast.show();
  }
})();
