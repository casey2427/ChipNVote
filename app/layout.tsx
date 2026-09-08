import type { Metadata } from "next";
import "./globals.css";
import "./events.css";
import "./schedule-fix.css";

export const metadata: Metadata = {
  title: "ChipNVote — 100 chips. One group decision.",
  description: "Create an event, share the link, and let everyone spend 100 chips on the choices they want most. No signup required.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
