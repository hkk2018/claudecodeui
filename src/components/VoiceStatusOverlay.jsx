import React from 'react';
import { Mic, Volume2, Send, Loader2, X } from 'lucide-react';
import {
  voiceModeEnabled, voiceState, partialTranscript, ttsState,
  disableVoiceMode
} from '../stores/voiceSignals';
import { destroyTranscriber } from '../utils/moonshineLoader';
import { cancelSpeech } from '../utils/ttsEngine';

export function VoiceStatusOverlay() {
  if (!voiceModeEnabled.value) return null;

  const state = voiceState.value;
  const speaking = ttsState.value === 'speaking';
  const partial = partialTranscript.value;

  const getStatusDisplay = () => {
    if (state === 'loading-model') {
      return {
        icon: <Loader2 className="w-4 h-4 animate-spin" />,
        text: 'Loading voice model...',
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/10 border-blue-500/30',
      };
    }
    if (speaking) {
      return {
        icon: <Volume2 className="w-4 h-4" />,
        text: 'Claude is speaking...',
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/10 border-purple-500/30',
      };
    }
    if (state === 'transcribing') {
      return {
        icon: <Mic className="w-4 h-4 animate-pulse" />,
        text: partial || 'Listening...',
        color: 'text-green-400',
        bgColor: 'bg-green-500/10 border-green-500/30',
      };
    }
    if (state === 'sending') {
      return {
        icon: <Send className="w-4 h-4" />,
        text: 'Sending...',
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/10 border-blue-500/30',
      };
    }
    if (state === 'listening') {
      return {
        icon: <Mic className="w-4 h-4" />,
        text: 'Listening...',
        color: 'text-green-400',
        bgColor: 'bg-green-500/10 border-green-500/30',
      };
    }
    if (state === 'error') {
      return {
        icon: <Mic className="w-4 h-4" />,
        text: 'Voice error',
        color: 'text-red-400',
        bgColor: 'bg-red-500/10 border-red-500/30',
      };
    }
    return null;
  };

  const status = getStatusDisplay();
  if (!status) return null;

  const handleStop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    destroyTranscriber();
    cancelSpeech();
    disableVoiceMode();
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm mb-2 ${status.bgColor}`}>
      <span className={status.color}>
        {status.icon}
      </span>
      <span className={`flex-1 truncate ${status.color}`}>
        {status.text}
      </span>
      <button
        type="button"
        onClick={handleStop}
        className="text-gray-400 hover:text-white transition-colors p-0.5 rounded"
        title="Stop voice mode"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
