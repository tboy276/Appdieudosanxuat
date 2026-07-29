import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg-canvas)",
        sidebar: "var(--bg-sidebar)",
        subtle: "var(--bg-subtle)",
        border: "var(--border-default)",
        "txt-primary": "var(--text-primary)",
        "txt-secondary": "var(--text-secondary)",
        accent: "var(--accent)",
        warning: "var(--state-warning)",
        success: "var(--state-success)",
      },
      borderRadius: {
        DEFAULT: "0.375rem", // 6px
        sm: "0.25rem",    // 4px
        md: "0.375rem",   // 6px
        lg: "0.5rem",     // 8px
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
