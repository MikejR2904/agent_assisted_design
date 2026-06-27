/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark workbench theme
        surface: {
          DEFAULT: '#0f1117',
          raised: '#161b27',
          elevated: '#1d2436',
          overlay: '#242c3d',
        },
        accent: {
          DEFAULT: '#4f8ef7',
          hover: '#6ba3ff',
          muted: '#1e3a6a',
        },
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#ef4444',
        gate: {
          active: '#4f8ef7',
          complete: '#22c55e',
          pending: '#374151',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'thinking': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'stream': 'fadeIn 0.1s ease-in',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};