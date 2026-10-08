import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: new URL("./index.html", import.meta.url).pathname,
        battle: new URL("./battle.html", import.meta.url).pathname,
      },
    },
  },
});
