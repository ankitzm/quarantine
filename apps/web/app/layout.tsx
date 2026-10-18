import type { Metadata, Viewport } from 'next';
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const display = Archivo({
  subsets: ['latin'],
  weight: 'variable',
  axes: ['wdth'],
  variable: '--font-display',
});
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Quarantine — incident console',
  description:
    'Trace a memory-poisoning attack through an agent swarm, see what infected agents can still reach, and cut it at minimum cost.',
};

export const viewport: Viewport = { themeColor: '#eef1ef' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
