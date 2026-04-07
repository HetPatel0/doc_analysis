import type { Metadata } from "next";
import { IBM_Plex_Serif, Mona_Sans } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";

const ibmPlexSerif = IBM_Plex_Serif({
  variable: "--font-ibm-plex-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const mona_Sans = Mona_Sans({
  variable: "--font-mona-sans",
  subsets: ["latin"],
  display: "swap",
});
export const metadata: Metadata = {
  title: "Bookify",
  description:
    "Upload a PDF and chat with its contents through a clean, focused interface.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ibmPlexSerif.variable} ${mona_Sans.variable} h-full font-sans antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <Navbar />
        {children}
      </body>
    </html>
  );
}
