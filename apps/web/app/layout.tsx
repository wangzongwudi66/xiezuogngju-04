import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIGC 协作工具 M1",
  description: "多项目、成员角色、集数分配、我的集和通知的 M1 原型"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
