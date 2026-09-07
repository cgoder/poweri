// PowerI 产品层入口（app/ 下唯一新增文件）。
// 上游 main 分支无此文件，合并零冲突；app/ 其余文件一律跟随上游，禁止修改。
// 渲染链：AppShell(poweri/layout) → ChatWindow(poweri/components) → MessageView(poweri/components) → MarkdownBody(poweri/components)。
import { Suspense } from "react";
import { AppShell } from "@/poweri/layout/AppShell";
import { I18nProvider } from "@/hooks/useI18n";

export default function PowerIPage() {
  return (
    <Suspense>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </Suspense>
  );
}
