import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
export type SharedReport = {
  id: string;
  organisation: string;
  uploader: string;
  title: string;
  description: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  fileCount: number;
};
type ReportsContextValue = {
  reports: SharedReport[];
  addReport: (report: SharedReport) => void;
  refresh: () => Promise<void>;
};
const Context = createContext<ReportsContextValue | undefined>(undefined);
export function ReportsProvider({ children }: { children: React.ReactNode }) {
  const [reports, setReports] = useState<SharedReport[]>([]);
  const addReport = useCallback(
    (report: SharedReport) =>
      setReports((items) => [
        report,
        ...items.filter((item) => item.id !== report.id),
      ]),
    [],
  );
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/reports");
      if (!response.ok) return;
      const data = await response.json();
      setReports(data.items || data.reports || []);
    } catch {
      setReports((items) => items);
    }
  }, []);
  const value = useMemo(
    () => ({ reports, addReport, refresh }),
    [reports, addReport, refresh],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useReports = () => {
  const value = useContext(Context);
  if (!value) throw new Error("useReports must be used inside ReportsProvider");
  return value;
};
