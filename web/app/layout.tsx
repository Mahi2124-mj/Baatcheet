import type { Metadata, Viewport } from 'next';
import { UiProvider } from '@/components/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'Baatcheet — chat, voice and video calls',
  description: 'Private messaging with real-time chat, voice calls and video calls.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: '#0d1016',
};

// Sets the saved theme before the first paint (no flash).
const themeScript = `try{var t=localStorage.getItem('bc-theme');if(t==='light')document.documentElement.dataset.theme='light'}catch(e){}`;

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
