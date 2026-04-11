import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
type ColorScheme = "bgp" | "claude" | "ocean" | "ember" | "landsec";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
  colorScheme: "bgp",
  setColorScheme: () => {},
});

export const COLOR_SCHEMES: { id: ColorScheme; label: string; color: string; description: string }[] = [
  { id: "bgp", label: "BGP Classic", color: "#1a1a1a", description: "Professional monochrome" },
  { id: "claude", label: "Claude", color: "#d4a574", description: "Warm and elegant" },
  { id: "ocean", label: "Hot Pink", color: "#ec4899", description: "Bold and vibrant" },
  { id: "ember", label: "Lemon", color: "#eab308", description: "Bright and fresh" },
  { id: "landsec", label: "Landsec", color: "#00263A", description: "Corporate navy" },
];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("bgp-color-scheme") as ColorScheme) || "bgp";
    }
    return "bgp";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("bgp-theme", theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    COLOR_SCHEMES.forEach(s => root.classList.remove(`scheme-${s.id}`));
    root.classList.add(`scheme-${colorScheme}`);
    localStorage.setItem("bgp-color-scheme", colorScheme);
  }, [colorScheme]);

  const toggleTheme = () => {
  };

  const setColorScheme = (scheme: ColorScheme) => {
    setColorSchemeState(scheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, colorScheme, setColorScheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
