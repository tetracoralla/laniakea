import { useSyncExternalStore } from "react";
import { getColorTheme, setColorTheme, subscribeColorTheme } from "../theme/colorTheme";

export function useColorTheme() {
  const theme = useSyncExternalStore(subscribeColorTheme, getColorTheme);
  return { theme, toggleTheme: () => setColorTheme(theme === "dark" ? "light" : "dark") };
}
