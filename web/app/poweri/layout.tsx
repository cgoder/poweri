import type { Metadata } from "next";

// PowerI 产品层路由的元数据覆盖。
//
// 分层架构（ADR-0002）要求界面改动一律落 poweri/、不改上游 app/layout.tsx
// （ownership.md §4 断言上游 UI 当前 0 修改）。Next.js App Router 中，子段
// 导出的 metadata 会对该子路由覆盖父级，因此这里把 `/poweri`（桌面壳加载的
// 入口）可见的标签标题 / 应用名从上游的 “Pi Web” 覆盖为 “PowerI”，
// 而上游根路由 `/` 保持原样。
export const metadata: Metadata = {
  title: "PowerI",
  description: "PowerI — desktop coding agent interface",
  applicationName: "PowerI",
  // 覆盖上游 app/layout.tsx 的 appleWebApp（其 title 仍为 “Pi Web”），
  // 否则 /poweri 页面的 apple-mobile-web-app-title 元标签会残留 Pi Web。
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PowerI",
  },
};

export default function PowerIRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
