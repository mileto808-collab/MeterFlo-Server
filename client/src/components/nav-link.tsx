import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useCallback } from "react";

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  invalidateKeys?: string[];
  "data-testid"?: string;
}

export function NavLink({ 
  href, 
  children, 
  className, 
  invalidateKeys,
  "data-testid": testId 
}: NavLinkProps) {
  const [location, setLocation] = useLocation();

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    
    const keysToInvalidate = invalidateKeys || [];
    
    if (href.includes("/work-orders")) {
      keysToInvalidate.push("/api/projects");
    }
    if (href.includes("/users")) {
      keysToInvalidate.push("/api/users");
    }
    if (href.includes("/projects") && !href.includes("/work-orders")) {
      keysToInvalidate.push("/api/projects");
    }
    
    keysToInvalidate.forEach(key => {
      queryClient.invalidateQueries({ queryKey: [key] });
    });
    
    if (location === href) {
      queryClient.invalidateQueries();
    }
    
    setLocation(href);
  }, [href, location, setLocation, invalidateKeys]);

  return (
    <a 
      href={href} 
      onClick={handleClick} 
      className={className}
      data-testid={testId}
    >
      {children}
    </a>
  );
}
