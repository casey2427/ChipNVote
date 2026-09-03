import type { Metadata } from "next";
import "./globals.css";
import "./events.css";
import GuestAccountPrompt from "./GuestAccountPrompt";

export const metadata: Metadata = {
  title: "ChipNVote — Put your chips where your plans are",
  description: "A fair, limited-resource voting game for making plans with friends.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <GuestAccountPrompt />
      </body>
    </html>
  );
}
