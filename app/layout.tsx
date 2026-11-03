import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { RegisterServiceWorker } from "./_components/RegisterServiceWorker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Afterglow · Sunset forecast",
  description: "Will tonight's sunset be worth stepping out for? A sunset forecast for London.",
  applicationName: "Afterglow",
  appleWebApp: { capable: true, title: "Afterglow", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0d0b14",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Chrome offers to install the app once; keep that offer for the "Install" button (InstallApp.tsx),
// even when it arrives before the page has finished loading.
const KEEP_INSTALL_OFFER = `addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__installOffer=e;dispatchEvent(new Event("afterglow:installoffer"))});`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${geistSans.variable} h-full antialiased`}>
      <head>
        {/* Sent with cookies, so the manifest also loads while the site is behind Vercel's login. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <script dangerouslySetInnerHTML={{ __html: KEEP_INSTALL_OFFER }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
