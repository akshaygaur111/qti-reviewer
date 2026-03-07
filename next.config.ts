import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow larger request bodies for QTI XML uploads
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

export default nextConfig;
