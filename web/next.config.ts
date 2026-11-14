import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // the SDK is TypeScript source in this workspace, compiled by Next
  transpilePackages: ["@tally-near/sdk"],
  turbopack: { root: path.resolve(__dirname, "..") },
  outputFileTracingRoot: path.resolve(__dirname, ".."),
};

export default nextConfig;
