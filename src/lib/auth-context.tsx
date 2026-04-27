import React, { createContext, useContext, useState, useEffect } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";

import { getAuthClient, signOutUser } from "@/lib/firebaseAuth";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    try {
      unsub = onAuthStateChanged(getAuthClient(), (next) => {
        setUser(next);
        setLoading(false);
      });
    } catch {
      setUser(null);
      setLoading(false);
    }
    return () => unsub?.();
  }, []);

  const signOut = async () => {
    await signOutUser();
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
