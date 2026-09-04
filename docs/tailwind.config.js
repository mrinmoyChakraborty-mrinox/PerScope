/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: { colors: { perscope: { bg: "#0a0a0f", card: "#14141c", border: "#23233a", accent: "#7c5cff", accent2: "#00e5a0" } } } },
  plugins: [],
};
