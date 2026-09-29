/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        brand: {
          50: "#eef2fa",
          100: "#dce4f4",
          200: "#b9c8e8",
          300: "#8fa6d6",
          400: "#6583c3",
          500: "#4a6db5",
          600: "#3b5eaa",
          700: "#314f93",
          800: "#2a437f",
          900: "#243c77",
          950: "#182850",
        },
        accent: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
        },
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
        },
        border: {
          DEFAULT: "var(--border-color)",
          light: "var(--border-light)",
        },
      },
      borderRadius: {
        DEFAULT: "0.5rem",
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
        elevated: "0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.04)",
        modal: "0 25px 50px -12px rgb(0 0 0 / 0.15), 0 0 0 1px rgb(0 0 0 / 0.05)",
        dropdown: "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)",
        toast: "0 8px 16px -4px rgb(0 0 0 / 0.08), 0 4px 8px -4px rgb(0 0 0 / 0.04)",
      },
      keyframes: {
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateX(100%)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "shortcut-flash": {
          "0%": { opacity: "0", transform: "translateX(-50%) translateY(8px) scale(0.95)" },
          "15%": { opacity: "1", transform: "translateX(-50%) translateY(0) scale(1)" },
          "75%": { opacity: "1", transform: "translateX(-50%) translateY(0) scale(1)" },
          "100%": { opacity: "0", transform: "translateX(-50%) translateY(-4px) scale(0.98)" },
        },
        "milestone-enter": {
          from: { opacity: "0", transform: "translateY(-6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "check-draw": {
          from: { strokeDashoffset: "20", opacity: "0" },
          to: { strokeDashoffset: "0", opacity: "1" },
        },
        "hint-lifecycle": {
          "0%": { opacity: "0", transform: "translateY(-4px)" },
          "10%": { opacity: "1", transform: "translateY(0)" },
          "80%": { opacity: "1", transform: "translateY(0)" },
          "100%": { opacity: "0", transform: "translateY(-2px)" },
        },
      },
      animation: {
        "slide-in": "slide-in-right 0.3s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "toast-in": "toast-in 0.3s ease-out",
        "shortcut-flash": "shortcut-flash 1.2s ease-out forwards",
        "milestone-enter": "milestone-enter 0.35s ease-out both",
        "check-draw": "check-draw 0.4s ease-out both",
        "hint-lifecycle": "hint-lifecycle 3.5s ease-out forwards",
      },
    },
  },
  plugins: [],
};
