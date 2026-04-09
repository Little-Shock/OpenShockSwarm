import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Noto_Sans_SC, Space_Grotesk } from "next/font/google";

import { LivePhaseZeroProvider } from "@/lib/live-phase0";

import "./globals.css";

const cjkSans = Noto_Sans_SC({
  variable: "--font-cjk-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
  subsets: ["latin"],
  fallback: ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", "sans-serif"],
});

const display = Space_Grotesk({
  variable: "--font-display",
  display: "swap",
  subsets: ["latin"],
  fallback: ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", "sans-serif"],
});

const body = Inter({
  variable: "--font-body",
  display: "swap",
  subsets: ["latin"],
  fallback: ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", "sans-serif"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  display: "swap",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  fallback: ["Sarasa Mono SC", "Microsoft YaHei UI", "Noto Sans Mono CJK SC", "monospace"],
});

export const metadata: Metadata = {
  title: "OpenShock MVP",
  description: "OpenShock 的 Agent 优先协作壳层",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${display.variable} ${body.variable} ${mono.variable} ${cjkSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LivePhaseZeroProvider>{children}</LivePhaseZeroProvider>
      </body>
    </html>
  );
}
