/** @type {import('next').NextConfig} */
const nextConfig = {
  // Removes the "X-Powered-By: Next.js" response header. Pure hardening —
  // no effect on routing, rendering, or application behavior.
  poweredByHeader: false,
};

module.exports = nextConfig;
