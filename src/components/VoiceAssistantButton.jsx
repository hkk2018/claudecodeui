import React, { useEffect, useRef } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import {
  voiceModeEnabled, voiceState, voiceError, modelLoaded, ttsState,
  enableVoiceMode, disableVoiceMode, clearVoiceError
} from '../stores/voiceSignals';
import {
  isMoonshineSupported, createTranscriber, destroyTranscriber
} from '../utils/moonshineLoader';
import { cancelSpeech } from '../utils/ttsEngine';

export function VoiceAssistantButton({ onAutoSend, className = '' }) {
  const transcriberRef = useRef(null);
  const lastTapRef = useRef(0);

  const supported = isMoonshineSupported();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyTranscriber();
      cancelSpeech();
      if (voiceModeEnabled.value) {
        disableVoiceMode();
      }
    };
  }, []);

  const handleToggle = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!supported) return;

    // Debounce rapid taps
    const now = Date.now();
    if (now - lastTapRef.current < 300) return;
    lastTapRef.current = now;

    if (voiceModeEnabled.value) {
      // Turn off
      destroyTranscriber();
      cancelSpeech();
      disableVoiceMode();
      transcriberRef.current = null;
    } else {
      // Turn on
      enableVoiceMode();
      try {
        transcriberRef.current = await createTranscriber('tiny', {
          onCommitted: (text) => {
            onAutoSend?.(text);
          },
          onSpeechStart: () => {
            // Interrupt TTS when user starts speaking
            cancelSpeech();
          },
        });
      } catch (err) {
        console.error('Voice activation failed:', err);
        transcriberRef.current = null;
      }
    }
  };

  // Determine button appearance
  const getAppearance = () => {
    if (!supported) {
      return { bg: '#6b7280', icon: <MicOff className="w-5 h-5" />, disabled: true, pulse: false };
    }

    if (!voiceModeEnabled.value) {
      return { bg: '#374151', icon: <Mic className="w-5 h-5" />, disabled: false, pulse: false };
    }

    const state = voiceState.value;
    const speaking = ttsState.value === 'speaking';

    if (state === 'loading-model') {
      return { bg: '#3b82f6', icon: <Loader2 className="w-5 h-5 animate-spin" />, disabled: true, pulse: false };
    }
    if (speaking) {
      return { bg: '#a855f7', icon: <Mic className="w-5 h-5" />, disabled: false, pulse: true };
    }
    if (state === 'listening') {
      return { bg: '#22c55e', icon: <Mic className="w-5 h-5" />, disabled: false, pulse: true };
    }
    if (state === 'transcribing') {
      return { bg: '#22c55e', icon: <Mic className="w-5 h-5" />, disabled: false, pulse: true };
    }
    if (state === 'sending') {
      return { bg: '#3b82f6', icon: <Mic className="w-5 h-5" />, disabled: false, pulse: false };
    }
    if (state === 'error') {
      return { bg: '#ef4444', icon: <MicOff className="w-5 h-5" />, disabled: false, pulse: false };
    }

    return { bg: '#22c55e', icon: <Mic className="w-5 h-5" />, disabled: false, pulse: false };
  };

  const { bg, icon, disabled, pulse } = getAppearance();
  const error = voiceError.value;

  return (
    <div className="relative">
      <button
        type="button"
        style={{ backgroundColor: bg }}
        className={`
          flex items-center justify-center
          w-12 h-12 rounded-full
          text-white transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500
          dark:ring-offset-gray-800
          touch-action-manipulation
          ${disabled ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}
          hover:opacity-90
          ${className}
        `}
        onClick={handleToggle}
        disabled={disabled}
        title={
          !supported ? 'Voice not supported (requires HTTPS + modern browser)' :
          voiceModeEnabled.value ? 'Stop voice mode' : 'Start voice mode'
        }
      >
        {icon}
      </button>

      {/* Pulse ring animation */}
      {pulse && (
        <div
          className="absolute -inset-1 rounded-full border-2 animate-ping pointer-events-none"
          style={{ borderColor: bg }}
        />
      )}

      {/* Error tooltip */}
      {error && (
        <div
          className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2
                      bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap z-50
                      shadow-lg cursor-pointer"
          onClick={() => clearVoiceError()}
        >
          {error}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0
                          border-l-4 border-r-4 border-t-4
                          border-l-transparent border-r-transparent border-t-red-600" />
        </div>
      )}
    </div>
  );
}
