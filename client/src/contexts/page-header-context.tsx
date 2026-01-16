import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface PageHeaderContextType {
  headerContent: ReactNode | null;
  setHeaderContent: (content: ReactNode | null) => void;
}

const PageHeaderContext = createContext<PageHeaderContextType | undefined>(undefined);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [headerContent, setHeaderContentState] = useState<ReactNode | null>(null);

  const setHeaderContent = useCallback((content: ReactNode | null) => {
    setHeaderContentState(content);
  }, []);

  return (
    <PageHeaderContext.Provider value={{ headerContent, setHeaderContent }}>
      {children}
    </PageHeaderContext.Provider>
  );
}

export function usePageHeader() {
  const context = useContext(PageHeaderContext);
  if (context === undefined) {
    throw new Error("usePageHeader must be used within a PageHeaderProvider");
  }
  return context;
}

export function useSetPageHeader(content: ReactNode | null) {
  const { setHeaderContent } = usePageHeader();
  
  return { setHeaderContent };
}
