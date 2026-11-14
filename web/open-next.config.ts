import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// The whole Next.js app (pages + /api routes) runs as one Cloudflare Worker.
export default defineCloudflareConfig();
