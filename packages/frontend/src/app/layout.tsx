import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: 'RTL-to-GDSII Workbench',
  description: 'Human-Agent Collaboration Workbench for RTL-to-GDSII Design',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full overflow-hidden bg-surface text-white antialiased font-sans" suppressHydrationWarning>
        {children}
        <Toaster position="bottom-right" toastOptions={{ className: 'font-mono text-xs' }} />
      </body>
    </html>
  );
}