import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Loader2, Trash2, Volume2, AlertCircle } from 'lucide-react';
import { authenticatedFetch } from '../utils/api';

/**
 * Standalone Voice Test Panel using:
 * - @ricky0123/vad-web (Silero VAD) for voice activity detection
 * - Server-side whisper.cpp for STT
 */
export function VoiceTestPanel() {
  const [status, setStatus] = useState('idle'); // idle | loading | listening | processing | error
  const [transcripts, setTranscripts] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [vadInfo, setVadInfo] = useState(null);
  const vadRef = useRef(null);
  const scrollRef = useRef(null);

  // Auto-scroll transcript list
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (vadRef.current) {
        vadRef.current.pause();
        vadRef.current.destroy();
        vadRef.current = null;
      }
    };
  }, []);

  const startListening = async () => {
    setStatus('loading');
    setErrorMsg(null);

    try {
      const { MicVAD } = await import('@ricky0123/vad-web');

      const vadOptions: any = {
        modelURL: '/silero_vad_legacy.onnx',
        workletURL: '/vad.worklet.bundle.min.js',
        onnxWASMBasePath: '/',
        onSpeechStart: () => {
          setStatus('listening');
        },
        onSpeechEnd: async (audio) => {
          // audio is Float32Array of PCM samples at 16kHz
          setStatus('processing');

          try {
            // Convert Float32Array to WAV
            const wavBlob = float32ToWav(audio, 16000);

            // Send to server for whisper.cpp transcription
            const formData = new FormData();
            formData.append('audio', wavBlob, 'speech.wav');

            const response = await authenticatedFetch('/api/voice/transcribe', {
              method: 'POST',
              body: formData,
            });

            if (!response.ok) {
              const err = await response.json().catch(() => ({}));
              throw new Error(err.error || `Server error: ${response.status}`);
            }

            const data = await response.json();
            if (data.text && data.text.trim()) {
              setTranscripts(prev => [
                ...prev,
                {
                  text: data.text.trim(),
                  time: new Date().toLocaleTimeString(),
                  duration: (audio.length / 16000).toFixed(1),
                  engine: data.engine || 'whisper.cpp',
                }
              ]);
            }
          } catch (err) {
            console.error('[VoiceTest] Transcription error:', err);
            setErrorMsg(err.message);
          }

          // Resume listening
          if (vadRef.current) {
            setStatus('listening');
          }
        },
        onVADMisfire: () => {
          // Speech was too short, ignore
          console.log('[VoiceTest] VAD misfire (too short)');
        },
      };
      const vad = await MicVAD.new(vadOptions);

      vadRef.current = vad;
      vad.start();
      setStatus('listening');
      setVadInfo('Silero VAD v5 + whisper.cpp (small)');
    } catch (err) {
      console.error('[VoiceTest] Error:', err);
      setStatus('error');
      if (err.name === 'NotAllowedError') {
        setErrorMsg('Microphone permission denied');
      } else if (err.name === 'NotFoundError') {
        setErrorMsg('No microphone found');
      } else {
        setErrorMsg(err.message || 'Failed to start');
      }
    }
  };

  const stopListening = () => {
    if (vadRef.current) {
      vadRef.current.pause();
      vadRef.current.destroy();
      vadRef.current = null;
    }
    setStatus('idle');
  };

  const toggleVoice = () => {
    if (status === 'listening' || status === 'processing') {
      stopListening();
    } else if (status === 'idle' || status === 'error') {
      startListening();
    }
  };

  const clearTranscripts = () => {
    setTranscripts([]);
  };

  const speakText = (text) => {
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      speechSynthesis.speak(utterance);
    }
  };

  const getButtonColor = () => {
    switch (status) {
      case 'loading': return '#3b82f6';
      case 'listening': return '#22c55e';
      case 'processing': return '#a855f7';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'idle': return 'Click to start';
      case 'loading': return 'Loading VAD model...';
      case 'listening': return 'Listening (speak now)';
      case 'processing': return 'Transcribing...';
      case 'error': return 'Error';
      default: return '';
    }
  };

  const isSupported = !!(
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices?.getUserMedia &&
    (location.protocol === 'https:' || location.hostname === 'localhost')
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleVoice}
            disabled={status === 'loading' || !isSupported}
            style={{ backgroundColor: getButtonColor() }}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-white transition-all
              ${status === 'listening' ? 'animate-pulse' : ''}
              ${(status === 'loading' || !isSupported) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-90'}`}
          >
            {status === 'loading' || status === 'processing' ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : status === 'listening' ? (
              <Mic className="w-5 h-5" />
            ) : (
              <MicOff className="w-5 h-5" />
            )}
          </button>
          <div>
            <div className="text-sm font-medium">
              {getStatusText()}
            </div>
            <div className="text-xs text-muted-foreground">
              {vadInfo || 'VAD + whisper.cpp STT Test'}
              {!isSupported && ' | Requires HTTPS or localhost'}
            </div>
          </div>
        </div>
        <button
          onClick={clearTranscripts}
          className="p-2 hover:bg-accent rounded-md transition-colors text-muted-foreground"
          title="Clear transcripts"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Error */}
      {errorMsg && (
        <div className="px-3 py-2 bg-red-500/10 text-red-500 text-sm border-b border-border flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Processing indicator */}
      {status === 'processing' && (
        <div className="px-3 py-2 bg-purple-500/10 text-purple-400 text-sm border-b border-border animate-pulse">
          Sending to whisper.cpp for transcription...
        </div>
      )}

      {/* Transcript list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {transcripts.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-8">
            {isSupported
              ? 'Press the mic button and start speaking. VAD will auto-detect speech and send to whisper.cpp for transcription.'
              : 'Voice test requires HTTPS or localhost.'}
          </div>
        ) : (
          transcripts.map((t, i) => (
            <div key={i} className="flex items-start gap-2 group">
              <div className="text-xs text-muted-foreground mt-1 w-16 shrink-0">{t.time}</div>
              <div className="flex-1 bg-accent/50 rounded-lg px-3 py-2 text-sm">
                {t.text}
                <div className="text-xs text-muted-foreground mt-1">
                  {t.duration}s | {t.engine}
                </div>
              </div>
              <button
                onClick={() => speakText(t.text)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-accent rounded transition-all text-muted-foreground"
                title="Play with TTS"
              >
                <Volume2 className="w-3 h-3" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer stats */}
      <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground flex justify-between">
        <span>{transcripts.length} transcript(s)</span>
        <span>VAD: Silero v5 | STT: whisper.cpp (small)</span>
      </div>
    </div>
  );
}

/**
 * Convert Float32Array PCM to WAV blob
 */
function float32ToWav(float32Array, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = float32Array.length * (bitsPerSample / 8);
  const bufferSize = 44 + dataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert float32 to int16
  let offset = 44;
  for (let i = 0; i < float32Array.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
