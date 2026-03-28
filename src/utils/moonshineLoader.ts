import {
  voiceState, modelLoaded, partialTranscript, finalTranscript,
  voiceError, setVoiceState, setVoiceError
} from '../stores/voiceSignals';

const CDN_URL = 'https://cdn.jsdelivr.net/npm/@moonshine-ai/moonshine-js@latest/dist/moonshine.min.js';

let MoonshineLib = null;
let activeTranscriber = null;

/**
 * Check if browser supports Moonshine (getUserMedia + WASM)
 */
export function isMoonshineSupported() {
  return !!(
    navigator.mediaDevices?.getUserMedia &&
    typeof WebAssembly === 'object' &&
    (location.protocol === 'https:' || location.hostname === 'localhost')
  );
}

/**
 * Dynamically load moonshine-js from CDN (cached after first load)
 */
export async function loadMoonshineLibrary() {
  if (MoonshineLib) return MoonshineLib;

  try {
    MoonshineLib = await import(/* @vite-ignore */ CDN_URL);
    return MoonshineLib;
  } catch (err) {
    console.error('Failed to load Moonshine JS:', err);
    throw new Error('Failed to load voice recognition library. Check your network connection.');
  }
}

/**
 * Create and start a MicrophoneTranscriber
 * @param {string} modelSize - 'tiny' or 'base'
 * @param {object} callbacks - { onCommitted(text), onSpeechStart(), onSpeechEnd() }
 * @returns {object} transcriber instance
 */
export async function createTranscriber(modelSize = 'tiny', callbacks: any = {}) {
  if (activeTranscriber) {
    destroyTranscriber();
  }

  setVoiceState('loading-model');

  const Moonshine = await loadMoonshineLibrary();

  const modelPath = `model/${modelSize}`;

  const transcriber = new Moonshine.MicrophoneTranscriber(
    modelPath,
    {
      onModelLoadStarted() {
        console.log('[Moonshine] Model loading started...');
        setVoiceState('loading-model');
      },
      onModelLoaded() {
        console.log('[Moonshine] Model loaded');
        modelLoaded.value = true;
      },
      onTranscribeStarted() {
        console.log('[Moonshine] Transcription started');
        setVoiceState('listening');
      },
      onSpeechStart() {
        console.log('[Moonshine] Speech detected');
        setVoiceState('transcribing');
        callbacks.onSpeechStart?.();
      },
      onSpeechEnd() {
        console.log('[Moonshine] Speech ended');
        callbacks.onSpeechEnd?.();
      },
      onTranscriptionUpdated(text: any) {
        partialTranscript.value = text;
      },
      onTranscriptionCommitted(text: any) {
        console.log('[Moonshine] Committed:', text);
        finalTranscript.value = text;
        partialTranscript.value = '';
        if (text.trim()) {
          setVoiceState('sending');
          callbacks.onCommitted?.(text.trim());
        }
        // Return to listening after sending
        setTimeout(() => {
          if (voiceState.value === 'sending') {
            setVoiceState('listening');
          }
        }, 300);
      },
      onTranscribeStopped() {
        console.log('[Moonshine] Transcription stopped');
      },
    },
    true // partialUpdates (VAD mode)
  );

  activeTranscriber = transcriber;

  try {
    await transcriber.load();
    await transcriber.start();
  } catch (err) {
    console.error('[Moonshine] Failed to start:', err);
    activeTranscriber = null;

    if (err.name === 'NotAllowedError') {
      setVoiceError('Microphone access denied. Please allow microphone permissions.');
    } else if (err.name === 'NotFoundError') {
      setVoiceError('No microphone found.');
    } else {
      setVoiceError(err.message || 'Failed to start voice recognition.');
    }
    throw err;
  }

  return transcriber;
}

/**
 * Pause the active transcriber (e.g., during TTS playback)
 */
export function pauseTranscriber() {
  if (activeTranscriber) {
    try {
      activeTranscriber.stop();
    } catch (err) {
      console.warn('[Moonshine] Error pausing:', err);
    }
  }
}

/**
 * Resume the active transcriber (e.g., after TTS ends)
 */
export async function resumeTranscriber() {
  if (activeTranscriber) {
    try {
      await activeTranscriber.start();
      setVoiceState('listening');
    } catch (err) {
      console.warn('[Moonshine] Error resuming:', err);
    }
  }
}

/**
 * Destroy the active transcriber and clean up
 */
export function destroyTranscriber() {
  if (activeTranscriber) {
    try {
      activeTranscriber.stop();
    } catch (err) {
      console.warn('[Moonshine] Error stopping:', err);
    }
    activeTranscriber = null;
  }
  partialTranscript.value = '';
  finalTranscript.value = '';
}

/**
 * Get the active transcriber (for external control)
 */
export function getActiveTranscriber() {
  return activeTranscriber;
}
