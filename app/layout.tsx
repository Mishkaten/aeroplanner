import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AeroPlanner | Phasis Air Cargo demo",
  description:
    "Demo: a messy Excel schedule becomes a validated schedule, a cleared conflict list and a flight packet. Fictional operator, fictional data.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Sets the theme before first paint so there is no flash.
const themeScript = `try{var q=new URLSearchParams(location.search).get('theme');if(q==='light'||q==='dark'){localStorage.setItem('aeroplanner.theme',q)}var t=localStorage.getItem('aeroplanner.theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
