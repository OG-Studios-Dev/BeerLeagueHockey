'use client';

import { useEffect, useRef } from 'react';
import { useUser } from '@/hooks/useUser';
import { useAuth } from './AuthProvider';

export function LeagueLandingSignInPrompt() {
  const { user, isLoading } = useUser();
  const { openLogin } = useAuth();
  const promptedRef = useRef(false);

  useEffect(() => {
    if (promptedRef.current || isLoading || user) {
      return;
    }

    promptedRef.current = true;
    const timeoutId = window.setTimeout(() => {
      openLogin();
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [isLoading, openLogin, user]);

  return null;
}
