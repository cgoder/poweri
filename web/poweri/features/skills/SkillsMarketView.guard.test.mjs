/**
 * Skills 面板行为守卫（回归防线）：
 * - 加载时序：mount 不得无条件 force check 更新；空闲懒加载 auto check；展开区按需限源拉取
 * - 源管理：添加/编辑/删除入口不限定 tab；默认源亦可删除
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "SkillsMarketView.tsx"), "utf8");

test("面板打开不再强制检查更新（mount 时的 bare refreshUpdates 已移除）", () => {
  assert.doesNotMatch(
    source,
    /void refreshUpdates\(\);/,
    "mount 时的无条件 force check 必须保持移除——它会绕过 TTL 强拉全部 git 源",
  );
});

test("首屏渲染完成后空闲触发 auto check（懒加载，非 force）", () => {
  assert.match(source, /refreshUpdates\(\{ mode: "auto" \}\)/, "必须存在 TTL 门控的懒加载触发");
  assert.match(
    source,
    /mode: opts\?\.mode/,
    "请求必须透传 mode 给服务端（auto = TTL 门控，缺省 force）",
  );
});

test("更新 badge 展开时按源按需拉取且按源合并（不清掉其他源数据）", () => {
  assert.match(
    source,
    /refreshUpdates\(\{ mode: "auto", subscriptionId: skill\.subscriptionId \}\)/,
    "展开区数据缺失时应限源 auto 拉取",
  );
  assert.match(
    source,
    /prev\.filter\(\(u\) => u\.subscriptionId !== sourceId\)/,
    "限源拉取必须按源合并写入",
  );
});

test("源管理入口不限定 tab（添加/编辑在 Installed 与 Discover 均可用）", () => {
  assert.doesNotMatch(
    source,
    /activeTab === "discover" && \(\s*\n\s*<button\s*\n\s*type="button"\s*\n\s*onClick=\{handleOpenAdd\}/,
    "添加源按钮不得限定在 Discover tab",
  );
  assert.doesNotMatch(
    source,
    /activeTab === "discover" && \(\s*\n\s*<button\s*\n\s*type="button"\s*\n\s*onClick=\{\(e\) => handleOpenEdit/,
    "编辑（内含删除）按钮不得限定在 Discover tab",
  );
});

test("默认源亦可删除（删除按钮不再排除 isDefault）", () => {
  assert.match(
    source,
    /\{isEdit && onDelete && \(/,
    "删除按钮不得带 !isDefault 条件——默认源收敛后仍允许用户删除",
  );
});

// ---- v0.2.4 反馈回归防线：WKWebView（macOS app）里 alert 是 no-op、confirm 恒返回 false ----
// 删除源静默失效、添加/安装报错不可见均由此而来；一律改应用内 UI，禁止回退原生对话框。
test("面板禁止使用 alert()/confirm()（WKWebView 里静默失效）", () => {
  assert.doesNotMatch(source, /\balert\(/, "alert 在 app 内是无声 no-op，必须用 actionError 横幅");
  assert.doesNotMatch(source, /\bconfirm\(/, "confirm 在 app 内恒返回 false，必须用两段式确认按钮");
});

test("操作错误走 actionError 横幅且自动消失", () => {
  assert.match(source, /const \[actionError, setActionError\] = useState/, "必须存在操作级错误状态");
  assert.match(source, /setActionError\(err instanceof Error \? err\.message : String\(err\)\)/, "catch 块必须写入 actionError");
  assert.match(source, /setTimeout\(\(\) => setActionError\(null\), 8000\)/, "错误横幅必须自动消失");
  // 横幅必须高于两个模态遮罩（SkillDetailModal z-1300 / SubscriptionFormModal z-1200），
  // 否则从弹窗内触发的错误（url 预检、保存/安装失败）完全不可见
  assert.match(
    source,
    /position: "fixed",\s*\n\s*top: 14,\s*\n\s*left: "50%",\s*\n\s*transform: "translateX\(-50%\)",\s*\n\s*zIndex: 1400/,
    "错误横幅必须 fixed 顶层且 z-index 高于全部模态",
  );
});

test("两段式删除确认态随弹窗关闭复位（防 4s 窗口内重开单击直删）", () => {
  assert.match(
    source,
    /setToken\(initialToken\);\s*\n[\s\S]{0,200}?setConfirmingDelete\(false\);/,
    "isOpen effect 必须复位 confirmingDelete",
  );
});

test("全新安装成功后关闭详情弹窗（遮罩会挡死重载按钮，导致装了无法生效）", () => {
  assert.match(
    source,
    /if \(nextEnabled && !skill\.installed\) \{\s*\n\s*setPreviewingSkill\(null\);/,
    "install 后必须关闭 z-1300 详情弹窗，让黄条与重载按钮可点",
  );
});

test("url 类型死源在添加/编辑入口被拦截（客户端 + 服务端双重）", () => {
  assert.match(
    source,
    /detectSubscriptionType\(form\.url\.trim\(\)\) === "url"/,
    "添加/编辑表单必须在 POST 前拦截 url 类型",
  );
  assert.match(
    source,
    /const urlUnchanged = modalState\.isEdit && modalState\.sub\?\.url === form\.url\.trim\(\)/,
    "编辑态必须放行 URL 未变的维护，仅拦截改成 url 型",
  );
  const route = readFileSync(join(here, "../../../app/poweri/api/skills/market/route.ts"), "utf8");
  // add 与 update 两个分支都必须有拒绝逻辑（错误文案与 status: 400 同段匹配，防松断言漏报）
  assert.match(
    route,
    /unsupported source type[^"]*"\s*\}\s*,\s*\n\s*\{ status: 400 \}/,
    "服务端必须以 400 + 明确文案拒绝 url 类型",
  );
  assert.ok(
    (route.match(/detectSubscriptionType\(url\) === "url"/g) || []).length >= 1
      && /detectSubscriptionType\(nextUrl\) === "url"/.test(route),
    "add 与 update 分支都要校验 url 类型",
  );
});
