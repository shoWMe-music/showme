import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import { useQueryClient } from "@tanstack/react-query";

import { IdleLogoutWarning } from "@/components/IdleLogoutWarning";
import { getAuthClient, signOutUser } from "@/lib/firebaseAuth";
import { useIdleLogout } from "@/lib/idle-logout";
import { queryKeys } from "@/lib/queries/keys";
import { useRefreshClaimsListener } from "@/lib/refresh-claims";

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
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const resetIdleTimerRef = useRef<(() => void) | null>(null);

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

  const handleForceLogout = useCallback(async () => {
    setWarningOpen(false);
    try {
      await signOutUser();
    } catch {
      // ignore — we're redirecting anyway
    }
    window.location.assign("/login?reason=idle");
  }, []);

  const queryClient = useQueryClient();
  useRefreshClaimsListener({
    uid: user?.uid ?? null,
    onRefresh: () => {
      if (user?.uid) {
        queryClient.invalidateQueries({ queryKey: queryKeys.events(user.uid) });
      } else {
        queryClient.invalidateQueries({ queryKey: ["events"] });
      }
    },
  });

  const { resetIdleTimer } = useIdleLogout({
    enabled: !!user && !loading,
    onWarningShow: () => {
      setSecondsRemaining(60);
      setWarningOpen(true);
    },
    onWarningHide: () => setWarningOpen(false),
    onSecondsRemainingChange: setSecondsRemaining,
    onForceLogout: handleForceLogout,
  });

  resetIdleTimerRef.current = resetIdleTimer;

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
      <IdleLogoutWarning
        open={warningOpen}
        secondsRemaining={secondsRemaining}
        onStayActive={() => {
          setWarningOpen(false);
          resetIdleTimerRef.current?.();
        }}
        onLogoutNow={handleForceLogout}
      />
    </AuthContext.Provider>
  );
}
