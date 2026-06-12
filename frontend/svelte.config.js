import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Enables <script lang="ts"> in .svelte files. SKELETON — extend if you add
// PostCSS, aliases, etc. NOTE(verify): confirm the preprocess import path on the
// @sveltejs/vite-plugin-svelte version you install.
export default {
  preprocess: vitePreprocess(),
};
