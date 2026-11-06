import type { Metadata, Viewport } from "next";
import { Archivo_Black, IBM_Plex_Mono } from "next/font/google";
import InfoSheet from "@/components/InfoSheet";
import "./globals.css";

const display = Archivo_Black({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const receipt = IBM_Plex_Mono({
  variable: "--font-receipt",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SplitSnap",
  description: "Scan the bill, tap what you ate, pay your friend back over UPI.",
  appleWebApp: { capable: true, title: "SplitSnap", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#f4e9d3", viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${receipt.variable}`}>
      <body>
        <div className="printer" aria-hidden="true" />
        <InfoSheet />
        <main>{children}</main>
      </body>
    </html>
  );
}
