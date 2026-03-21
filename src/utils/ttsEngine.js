import { ttsState, ttsEnabled, voiceModeEnabled } from '../stores/voiceSignals';
import { pauseTranscriber, resumeTranscriber } from './moonshineLoader';

let speechQueue = [];
let isSpeaking = false;

/**
 * Check if Web Speech API TTS is supported
 */
export function isTTSSupported() {
  return 'speechSynthesis' in window;
}

/**
 * Split text into speakable sentences, skipping code blocks
 */
function splitIntoSentences(text) {
  // Remove code blocks (``` ... ```)
  const withoutCodeBlocks = text.replace(/```[\s\S]*?```/g, '');
  // Remove inline code
  const withoutInlineCode = withoutCodeBlocks.replace(/`[^`]+`/g, '');
  // Remove markdown formatting
  const cleaned = withoutInlineCode
    .replace(/#{1,6}\s/g, '')       // headers
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1') // bold/italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links
    .replace(/^\s*[-*]\s/gm, '')    // list markers
    .replace(/^\s*\d+\.\s/gm, '')   // numbered lists
    .trim();

  if (!cleaned) return [];

  // Split on sentence boundaries
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  return sentences;
}

/**
 * Process the speech queue
 */
function processQueue() {
  if (!isSpeaking || speechQueue.length === 0) {
    isSpeaking = false;
    ttsState.value = 'idle';
    // Resume mic after TTS finishes
    if (voiceModeEnabled.value) {
      resumeTranscriber();
    }
    return;
  }

  const text = speechQueue.shift();
  const utterance = new SpeechSynthesisUtterance(text);

  utterance.onend = () => {
    processQueue();
  };

  utterance.onerror = (e) => {
    if (e.error !== 'interrupted') {
      console.warn('[TTS] Error:', e.error);
    }
    processQueue();
  };

  speechSynthesis.speak(utterance);
}

/**
 * Queue text for TTS playback
 * @param {string} text - Text to speak (can contain markdown)
 */
export function speakText(text) {
  if (!isTTSSupported() || !ttsEnabled.value || !voiceModeEnabled.value) return;

  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return;

  // Pause mic to prevent feedback loop
  pauseTranscriber();

  speechQueue.push(...sentences);

  if (!isSpeaking) {
    isSpeaking = true;
    ttsState.value = 'speaking';
    processQueue();
  }
}

/**
 * Cancel all TTS playback immediately
 */
export function cancelSpeech() {
  speechSynthesis.cancel();
  speechQueue = [];
  isSpeaking = false;
  ttsState.value = 'idle';
}

/**
 * Get available TTS voices
 */
export function getAvailableVoices() {
  return speechSynthesis.getVoices();
}
