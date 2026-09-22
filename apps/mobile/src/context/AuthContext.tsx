import type { Session, User } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

import { signInWithOAuth } from '../lib/supabase/auth';
import { supabase } from '../lib/supabase/client';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isGuest: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signInWithApple: () => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  continueAsGuest: () => void;
  exitGuest: () => void;
  signOut: () => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const authGeneration = useRef(0);
  const isGuestRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    const bootstrapGeneration = ++authGeneration.current;

    void supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!isMounted || bootstrapGeneration !== authGeneration.current) return;
        setSession(session);
        setIsLoading(false);
      })
      .catch(() => {
        if (!isMounted || bootstrapGeneration !== authGeneration.current) return;
        setIsLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return;
      if (!nextSession && isGuestRef.current) return;
      authGeneration.current += 1;
      setSession(nextSession);
      isGuestRef.current = false;
      setIsGuest(false);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      authGeneration.current += 1;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    return { error: error ? new Error(error.message) : null };
  };

  const signUpWithEmail = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    return { error: error ? new Error(error.message) : null };
  };

  const signInWithApple = async () => signInWithOAuth('apple');

  const signInWithGoogle = async () => signInWithOAuth('google');

  const continueAsGuest = () => {
    authGeneration.current += 1;
    isGuestRef.current = true;
    setSession(null);
    setIsLoading(false);
    setIsGuest(true);
  };

  const exitGuest = () => {
    isGuestRef.current = false;
    setIsGuest(false);
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) {
        return { error: new Error(error.message) };
      }

      isGuestRef.current = false;
      setIsGuest(false);
      return { error: null };
    } catch (error) {
      return {
        error: error instanceof Error ? error : new Error('Unable to log out on this device'),
      };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        isLoading,
        isGuest,
        signInWithEmail,
        signUpWithEmail,
        signInWithApple,
        signInWithGoogle,
        continueAsGuest,
        exitGuest,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
