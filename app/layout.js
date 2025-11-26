import './globals.css';

export const metadata = {
  title: 'Mafuyu Sekai: Neon Remake',
  description: 'HTML5 canvas shooter packaged for the web with Next.js.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: 'no',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/css/main.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
