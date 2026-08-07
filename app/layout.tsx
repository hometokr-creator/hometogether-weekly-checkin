import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "홈투게더 공동생활 주간 체크인",
    template: "%s | 홈투게더",
  },
  description: "함께 사는 일상을 더 편안하게 만드는 홈투게더 주간 체크인",
  applicationName: "홈투게더",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#176b52",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
