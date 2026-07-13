import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://honedtech.com',
  adapter: cloudflare({
    // No runtime image transforms needed; avoids auto-provisioning an Images binding.
    imageService: 'compile',
  }),
});
