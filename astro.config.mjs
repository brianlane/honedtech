import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://honedtech.com',
  integrations: [
    sitemap({
      // The thanks page is a post-submit interstitial, not a landing page.
      filter: (page) => !page.includes('/thanks'),
    }),
  ],
  adapter: cloudflare({
    // No runtime image transforms needed; avoids auto-provisioning an Images binding.
    imageService: 'compile',
  }),
});
