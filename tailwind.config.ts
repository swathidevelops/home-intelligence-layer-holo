import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Single accent color for the internal-tool aesthetic (light theme).
        accent: {
          DEFAULT: "#0f766e",
          hover: "#0d5f58",
        },
      },
    },
  },
  plugins: [],
};

export default config;
