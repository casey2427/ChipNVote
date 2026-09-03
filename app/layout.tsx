import type { Metadata } from "next";
import "./globals.css";
import "./events.css";

export const metadata: Metadata = {
  title: "ChipNVote — Put your chips where your plans are",
  description: "Group decisions with daily chips, blind voting, scheduling, and transparent results after the reveal.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
