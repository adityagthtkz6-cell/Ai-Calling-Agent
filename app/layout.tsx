import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mission Control — Voice Intelligence Platform",
  description: "Real-time dashboard for AI voice agent operations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[hsl(0,0%,4%)] text-[hsl(0,0%,96%)]">
        {children}
      </body>
    </html>
  );
}
