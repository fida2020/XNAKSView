import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XNAKView Admin",
  description: "Admin console for XNAKView — BALOCH SAHAB TECHNOLOGIES (SMC-PRIVATE) LIMITED",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
