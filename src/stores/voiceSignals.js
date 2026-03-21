import { signal, computed } from '@preact/signals-react';

// === Helper: safe localStorage ===
const safeLocalStorage = {
  getItem(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  setItem(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  }
};

// === Core State ===
export const voiceModeEnabled = signal(false);
export const voiceState = signal('idle'); // 'idle' | 'loading-model' | 'listening' | 'transcribing' | 'sending' | 'speaking' | 'error'
export const modelLoaded = signal(false);

// === Transcription ===
export const partialTranscript = signal('');
export const finalTranscript = signal('');

// === TTS ===
export const ttsEnabled = signal(safeLocalStorage.getItem('voice_tts_enabled', 'true') === 'true');
export const ttsState = signal('idle'); // 'idle' | 'speaking' | 'interrupted'

// === Settings (persisted) ===
export const voiceModelSize = signal(safeLocalStorage.getItem('voice_model_size', 'tiny'));
export const voiceAutoSend = signal(safeLocalStorage.getItem('voice_auto_send', 'true') === 'true');

// === Error ===
export const voiceError = signal(null);

// === Computed ===
export const isVoiceActive = computed(() =>
  voiceModeEnabled.value && voiceState.value !== 'idle' && voiceState.value !== 'error'
);

export const isListening = computed(() =>
  voiceState.value === 'listening'
);

// === Actions ===
export function enableVoiceMode() {
  voiceModeEnabled.value = true;
  voiceError.value = null;
}

export function disableVoiceMode() {
  voiceModeEnabled.value = false;
  voiceState.value = 'idle';
  partialTranscript.value = '';
  finalTranscript.value = '';
  voiceError.value = null;
  ttsState.value = 'idle';
}

export function setVoiceState(state) {
  voiceState.value = state;
}

export function setVoiceError(error) {
  voiceError.value = error;
  voiceState.value = 'error';
}

export function clearVoiceError() {
  voiceError.value = null;
  if (voiceState.value === 'error') {
    voiceState.value = 'idle';
  }
}

export function setTtsEnabled(enabled) {
  ttsEnabled.value = enabled;
  safeLocalStorage.setItem('voice_tts_enabled', String(enabled));
}

export function setVoiceModelSize(size) {
  voiceModelSize.value = size;
  safeLocalStorage.setItem('voice_model_size', size);
}

export function setVoiceAutoSend(enabled) {
  voiceAutoSend.value = enabled;
  safeLocalStorage.setItem('voice_auto_send', String(enabled));
}
