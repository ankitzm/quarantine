import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@quarantine/graph'],
  serverExternalPackages: ['falkordb'],
};

export default config;
