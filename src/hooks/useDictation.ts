import { useState, useEffect, useCallback, useRef } from 'react';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface UseDictationOptions {
  onResult?: (text: string, isFinal: boolean) => void;
  language?: string;
}

export function useDictation({ onResult, language = 'ru-RU' }: UseDictationOptions = {}) {
  const [isListening, setIsListening]         = useState(false);
  const [isSupported, setIsSupported]         = useState(true);
  const [interimTranscript, setInterimTranscript] = useState('');

  const recognitionRef        = useRef<any>(null);
  const onResultRef           = useRef(onResult);
  const shouldBeListeningRef  = useRef(false); // intent flag — survives auto-stop
  const restartTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.lang            = language;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setInterimTranscript('');
    };

    recognition.onresult = (event: any) => {
      let finalTranscript   = '';
      let interimText       = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimText += transcript;
        }
      }

      setInterimTranscript(interimText);

      if (finalTranscript && onResultRef.current) {
        onResultRef.current(finalTranscript, true);
      }
      if (interimText && onResultRef.current) {
        onResultRef.current(interimText, false);
      }
    };

    recognition.onerror = (event: any) => {
      const err = event.error as string;
      // Silence no-speech errors — they happen during pauses, we'll auto-restart
      if (err === 'no-speech') return;

      if (err === 'not-allowed' || err === 'service-not-allowed') {
        shouldBeListeningRef.current = false;
        setIsListening(false);
        setInterimTranscript('');
        return;
      }

      if (err === 'aborted') return; // expected on manual stop

      console.warn('[useDictation] recognition error:', err);
    };

    recognition.onend = () => {
      setInterimTranscript('');

      // If the user still wants to dictate, auto-restart after a short delay.
      // This handles the browser's built-in "stop after ~7s of silence" behaviour.
      if (shouldBeListeningRef.current) {
        restartTimerRef.current = setTimeout(() => {
          try {
            recognitionRef.current?.start();
          } catch {
            // Already started or destroyed — ignore
          }
        }, 150);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldBeListeningRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      try { recognition.abort(); } catch {}
    };
  }, [language]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || shouldBeListeningRef.current) return;
    shouldBeListeningRef.current = true;
    try {
      recognitionRef.current.start();
    } catch (e) {
      console.warn('[useDictation] start failed:', e);
      shouldBeListeningRef.current = false;
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldBeListeningRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try {
      recognitionRef.current?.stop();
    } catch {}
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const toggleListening = useCallback(() => {
    if (shouldBeListeningRef.current) {
      stopListening();
    } else {
      startListening();
    }
  }, [startListening, stopListening]);

  return {
    isListening,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
    toggleListening,
  };
}
