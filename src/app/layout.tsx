import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Inter_Tight } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme-provider";
import { publicOrigin } from "@/lib/app-url";
import { appName } from "@/lib/brand";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
});

export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin()),
  title: appName(),
  description:
    "Credits and open-mic voting for build nights that already have a Luma list.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${interTight.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-paper font-sans text-ink">
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var d=localStorage.getItem("theme")==="dark";document.documentElement.classList.toggle("dark",d);}catch(e){}})();`}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
