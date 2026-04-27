import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/context/CartContext";
import Navbar from "@/components/Navbar";
import CartBar from "@/components/CartBar";
import PWARegister from "./pwa-register";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "SeaQuest Ordering",
  description: "Fast mobile food ordering",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f97316",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} font-sans bg-gray-50 min-h-screen`}>
        <CartProvider>
          <Navbar />
          <main className="max-w-lg mx-auto px-4 pb-32 pt-4">{children}</main>
          <CartBar />
        </CartProvider>
        <PWARegister />
      </body>
    </html>
  );
}
