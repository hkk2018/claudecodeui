import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Loader2 } from 'lucide-react';
import { api } from '../utils/api';

export function VoiceAssistantButton({ onAutoSend, className = '' }) {
  const [state, setState] = useState('idle'); // idle, recording, transcribing
  const [error, setError] = useState(null);
  const [isSupported, setIsSupported] = useState(true);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const lastTapRef = useRef(0);
  const errorTimerRef = useRef(null);

  // Auto-dismiss error after 4 seconds
  useEffect(() => {
    if (error) {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setError(null), 4000);
    }
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [error]);

  // Check microphone support on mount
  useEffect(() => {
    const checkSupport = () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setIsSupported(false);
        setError('Microphone not supported. Please use HTTPS or a modern browser.');
        return;
      }

      // Additional check for secure context
      if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
        setIsSupported(false);
        setError('Microphone requires HTTPS. Please use a secure connection.');
        return;
      }

      setIsSupported(true);
      setError(null);
    };

    checkSupport();
  }, []);

  // Start recording
  const startRecording = async () => {
    try {
      console.log('Starting recording...');
      setError(null);
      chunksRef.current = [];

      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access not available. Please use HTTPS or a supported browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        console.log('[Voice] Recording stopped, creating blob...');
        const blob = new Blob(chunksRef.current, { type: mimeType });
        console.log('[Voice] Blob size:', blob.size, 'bytes');

        // Clean up stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        // Start transcribing
        setState('transcribing');
        console.log('[Voice] Starting transcription...');

        try {
          const text = await transcribeWithGroq(blob);
          console.log('[Voice] Transcription result:', text);
          if (text && onAutoSend) {
            onAutoSend(text);
          }
        } catch (err) {
          console.error('[Voice] Transcription error:', err);
          setError(err.message);
        } finally {
          setState('idle');
        }
      };

      recorder.start();
      setState('recording');
      console.log('Recording started successfully');
    } catch (err) {
      console.error('Failed to start recording:', err);

      // Provide specific error messages based on error type
      let errorMessage = 'Microphone access failed';

      if (err.name === 'NotAllowedError') {
        errorMessage = 'Microphone access denied. Please allow microphone permissions.';
      } else if (err.name === 'NotFoundError') {
        errorMessage = 'No microphone found. Please check your audio devices.';
      } else if (err.name === 'NotSupportedError') {
        errorMessage = 'Microphone not supported by this browser.';
      } else if (err.name === 'NotReadableError') {
        errorMessage = 'Microphone is being used by another application.';
      } else if (err.message.includes('HTTPS')) {
        errorMessage = err.message;
      }

      setError(errorMessage);
      setState('idle');
    }
  };

  // Stop recording
  const stopRecording = () => {
    console.log('Stopping recording...');
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      // Don't set state here - let the onstop handler do it
    } else {
      // If recorder isn't in recording state, force cleanup
      console.log('Recorder not in recording state, forcing cleanup');
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setState('idle');
    }
  };

  // Handle button click
  const handleClick = (e) => {
    console.log('[Voice] Button clicked!');

    // Prevent double firing on mobile
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Don't proceed if microphone is not supported
    if (!isSupported) {
      console.log('[Voice] Not supported!');
      alert('Voice mode requires HTTPS connection. Please use https:// to access this site.');
      return;
    }

    // Debounce for mobile double-tap issue
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      console.log('[Voice] Ignoring rapid tap');
      return;
    }
    lastTapRef.current = now;

    console.log('[Voice] Current state:', state);

    if (state === 'idle') {
      console.log('[Voice] Starting recording...');
      startRecording();
    } else if (state === 'recording') {
      console.log('[Voice] Stopping recording...');
      stopRecording();
    } else {
      console.log('[Voice] Busy, ignoring click');
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Transcribe with Groq API
  const transcribeWithGroq = async (audioBlob) => {
    const formData = new FormData();
    const fileName = `recording_${Date.now()}.webm`;
    const file = new File([audioBlob], fileName, { type: audioBlob.type });

    formData.append('audio', file);

    const response = await api.groqTranscribe(formData);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error ||
        `Transcription error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    console.log('[Groq] Transcribed:', data);
    return data.text || '';
  };

  // Button appearance based on state
  const getButtonAppearance = () => {
    switch (state) {
      case 'recording':
        return {
          bg: '#ef4444',
          icon: <Mic className="w-5 h-5 text-white" />,
          pulse: true
        };
      case 'transcribing':
        return {
          bg: '#3b82f6',
          icon: <Loader2 className="w-5 h-5 animate-spin" />,
          pulse: false
        };
      default: // idle
        return {
          bg: '#374151',
          icon: <Mic className="w-5 h-5" />,
          pulse: false
        };
    }
  };

  const { bg, icon, pulse } = getButtonAppearance();

  return (
    <div className="relative">
      <button
        type="button"
        style={{ backgroundColor: bg }}
        className={`
          flex items-center justify-center
          w-12 h-12 rounded-full
          text-white transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
          dark:ring-offset-gray-800
          touch-action-manipulation
          cursor-pointer
          hover:opacity-90
          ${state === 'recording' ? 'animate-pulse' : ''}
          ${className}
        `}
        onClick={handleClick}
        disabled={state === 'transcribing'}
        title={
          !isSupported ? 'Voice mode (requires HTTPS)' :
          state === 'recording' ? 'Tap to stop & send' :
          state === 'transcribing' ? 'Transcribing...' :
          'Tap to record'
        }
      >
        {icon}
      </button>

      {pulse && (
        <div className="absolute -inset-1 rounded-full border-2 border-red-500 animate-ping pointer-events-none" />
      )}

      {/* Global toast via portal */}
      {error && createPortal(
        <div
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[9999]
                     bg-red-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg
                     flex items-center gap-2 animate-fade-in cursor-pointer"
          onClick={() => setError(null)}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
          </svg>
          {error}
        </div>,
        document.body
      )}
    </div>
  );
}
