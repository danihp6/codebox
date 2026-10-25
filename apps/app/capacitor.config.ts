import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.codebox.app',
  appName: 'Codebox',
  webDir: 'dist/browser',
  server: {
    androidScheme: 'https',
  },
};

export default config;
