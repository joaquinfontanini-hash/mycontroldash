import { createContext, useContext, ReactNode } from "react";

export interface AuthContextValue {
  userFullName: string;
  userEmail: string;
  userImageUrl: string | undefined;
  initials: string;
  signOut: () => void | Promise<void>;
}

const defaultAuth: AuthContextValue = {
  userFullName: "Administrador",
  userEmail: "",
  userImageUrl: undefined,
  initials: "A",
  signOut: () => {},
};

export const AuthContext = createContext<AuthContextValue>(defaultAuth);

export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext);
}

function makeInitials(fullName: string): string {
  return fullName
    .split(" ")
    .map((n) => n.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2);
}

interface ProviderProps {
  children: ReactNode;
}

export function buildAuthValue(
  fullName: string,
  email: string,
  imageUrl: string | undefined,
  signOut: () => void | Promise<void>,
): AuthContextValue {
  return {
    userFullName: fullName,
    userEmail: email,
    userImageUrl: imageUrl,
    initials: makeInitials(fullName || "U"),
    signOut,
  };
}

export function AuthContextProvider({
  value,
  children,
}: ProviderProps & { value: AuthContextValue }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
