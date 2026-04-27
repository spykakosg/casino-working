"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { getMe, logout as apiLogout } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("casino_token");
    if (!token) { setLoading(false); return; }
    getMe()
      .then(setUser)
      .catch(() => localStorage.removeItem("casino_token"))
      .finally(() => setLoading(false));
  }, []);

  function logout() {
    apiLogout();
    setUser(null);
  }

  function refreshUser() {
    return getMe().then(setUser);
  }

  return (
    <AuthContext.Provider value={{ user, setUser, logout, loading, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
