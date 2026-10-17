// app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import AccountNav from "./ui/account-nav";
import { AppFooter, PwaRegister } from "./ui/kit";
import { APP_NAME } from "./lib/app";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Raumpläne, Tischreservierung, Platzwahl und Sitzordnung",
  applicationName: APP_NAME,
  // iOS: als App vom Home-Bildschirm ohne Safari-Leiste starten (Icons: app/icon.svg, app/apple-icon.png,
  // app/favicon.ico und public/icons/ - Manifest in app/manifest.ts).
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Färbt die Statusleiste/Titelleiste der installierten App (passend zu manifest.ts).
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body className="antialiased min-h-screen flex flex-col">
        {/* Der Konto-Status liest Cookies (dynamisch) - in Suspense, damit er den Rest der Seite nicht aufhält. */}
        <Suspense fallback={null}>
          <AccountNav />
        </Suspense>
        <div className="grow">{children}</div>
        <AppFooter />
        <PwaRegister />
      </body>
    </html>
  );
}
