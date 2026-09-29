import type { NextConfig } from "next";
import { assertLocalAuthBind } from "./src/lib/auth/config";

assertLocalAuthBind(process.argv);

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
