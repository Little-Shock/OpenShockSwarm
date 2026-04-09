"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  buildOperatorCookieValue,
  normalizeOperatorName,
  OPERATOR_NAME_STORAGE_KEY,
} from "@/lib/operator";

type OperatorContextValue = {
  operatorName: string;
  setOperatorName: (value: string) => void;
};

const OperatorContext = createContext<OperatorContextValue | null>(null);

function persistOperatorName(value: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(OPERATOR_NAME_STORAGE_KEY, value);
  }

  if (typeof document !== "undefined") {
    document.cookie = buildOperatorCookieValue(value);
  }
}

export function OperatorProvider({
  initialOperatorName,
  children,
}: {
  initialOperatorName: string;
  children: ReactNode;
}) {
  const [operatorName, setOperatorNameState] = useState(
    normalizeOperatorName(initialOperatorName),
  );

  useEffect(() => {
    persistOperatorName(operatorName);
  }, [operatorName]);

  const value = useMemo<OperatorContextValue>(
    () => ({
      operatorName,
      setOperatorName(value) {
        const resolvedName = normalizeOperatorName(value);
        setOperatorNameState(resolvedName);
        persistOperatorName(resolvedName);
      },
    }),
    [operatorName],
  );

  return (
    <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>
  );
}

export function useCurrentOperator() {
  const context = useContext(OperatorContext);

  if (!context) {
    throw new Error("useCurrentOperator must be used within OperatorProvider");
  }

  return context;
}
