/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
        colors: {
            amazon: {
                DEFAULT: '#232f3e',
                light: '#37475a',
                orange: '#ff9900',
                blue: '#007185'
            }
        }
    },
  },
  plugins: [],
}
