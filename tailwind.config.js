/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      width: { sidebar: '240px' },
      height: { toolbar: '48px' },
      colors: {
        surface: {
          50:  'var(--surface-50)',
          100: 'var(--surface-100)',
          200: 'var(--surface-200)',
          800: 'var(--surface-800)',
          900: 'var(--surface-900)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          soft: 'var(--ink-soft)',
        },
        paper: 'var(--paper)',
      }
    }
  },
  plugins: []
}
