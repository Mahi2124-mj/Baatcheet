import type { Metadata, Viewport } from 'next';
import { UiProvider } from '@/components/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lottery Pao',
  description: 'Private messaging with real-time chat, voice calls and video calls.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

// Sets a theme chosen in Settings before the first paint (no flash); otherwise the phone's setting applies.
const themeScript = `try{var t=localStorage.getItem('bc-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <UiProvider>{children}</UiProvider>
      </body>
    </html>
  );
}
