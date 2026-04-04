/**
 * Desktop mode notification sound.
 * Uses a base64-encoded short chime WAV for instant playback.
 */

let audioElement: HTMLAudioElement | null = null;
let lastPlayTime = 0;
const DEBOUNCE_MS = 3000;

// Generate a tiny WAV chime programmatically
function generateChimeWav(): string {
  const sampleRate = 22050;
  const duration = 0.25;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Two-tone chime: A5 (880Hz) then D6 (1175Hz)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.max(0, 1 - t / duration) * (1 - Math.exp(-t * 80));
    const freq = t < 0.12 ? 880 : 1175;
    const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.3;
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clamped * 32767, true);
  }

  // Convert to base64 data URL
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

function getAudioElement(): HTMLAudioElement {
  if (!audioElement) {
    audioElement = new Audio(generateChimeWav());
    audioElement.volume = 0.5;
  }
  return audioElement;
}

// Pre-init on first user interaction (required by browsers)
let initialized = false;
function ensureInit() {
  if (initialized) return;
  initialized = true;
  const el = getAudioElement();
  // Preload
  el.load();
}

// Call this once on any user click to unlock audio
export function initNotificationSound() {
  ensureInit();
}

export function playNotificationSound() {
  const now = Date.now();
  if (now - lastPlayTime < DEBOUNCE_MS) return;
  lastPlayTime = now;

  ensureInit();

  try {
    const el = getAudioElement();
    el.currentTime = 0;
    el.play().catch(() => {
      // Autoplay blocked - will work after user interaction
    });
  } catch (err) {
    console.warn('Failed to play notification sound:', err);
  }
}
