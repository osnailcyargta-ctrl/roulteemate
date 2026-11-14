import type { NextConfig } from "next";

/**
 * Two build modes:
 *  - default    → standalone server (sandbox dev/preview)
 *  - GH_PAGES=1 → fully static export for GitHub Pages, served from the
 *                 project page https://<user>.github.io/roulteemate/
 *                 (the basePath makes every asset + link resolve under
 *                 /roulteemate/)
 */
const GH_PAGES = process.env.GH_PAGES === "1";
const REPO = "roulteemate";

const nextConfig: NextConfig = GH_PAGES
  ? {
      output: "export",
      basePath: `/${REPO}`,
      images: { unoptimized: true },
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
    }
  : {
      output: "standalone",
      /* config options here */
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
    };

export default nextConfig;
