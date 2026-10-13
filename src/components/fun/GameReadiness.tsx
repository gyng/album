import { createContext, useContext, type ReactNode } from "react";

type GameReadiness = {
  loading: boolean;
  showProgress: boolean;
  progress: number;
  error: string | null;
  retry: () => void;
};

const readiness = createContext<GameReadiness>({
  loading: false,
  showProgress: false,
  progress: 100,
  error: null,
  retry: () => {},
});

export const GameReadinessProvider = ({
  value,
  children,
}: {
  value: GameReadiness;
  children: ReactNode;
}) => <readiness.Provider value={value}>{children}</readiness.Provider>;

export const useGameReadiness = () => useContext(readiness);
