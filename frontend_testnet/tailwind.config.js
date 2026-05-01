/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: "#F5A623",
          light: "#FFD07A",
          dark: "#C47D0E",
        },
        casino: {
          bg:      "#0A0A0F",
          surface: "#111118",
          card:    "#16161F",
          border:  "#2A2A3A",
          muted:   "#3A3A4A",
        },
      },
      fontFamily: {
        display: ["'Bebas Neue'", "cursive"],
        body:    ["'DM Sans'", "sans-serif"],
        mono:    ["'JetBrains Mono'", "monospace"],
      },
      animation: {
        "roll-in":   "rollIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
        "fade-up":   "fadeUp 0.3s ease-out",
        "pulse-gold":"pulseGold 1.5s ease-in-out infinite",
        "spin-fast": "spin 0.5s linear",
      },
      keyframes: {
        rollIn: {
          "0%":   { transform: "scale(0.5) rotate(-10deg)", opacity: "0" },
          "100%": { transform: "scale(1) rotate(0deg)",     opacity: "1" },
        },
        fadeUp: {
          "0%":   { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)",   opacity: "1" },
        },
        pulseGold: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(245,166,35,0.4)" },
          "50%":      { boxShadow: "0 0 0 8px rgba(245,166,35,0)" },
        },
      },
    },
  },
  plugins: [],
};
