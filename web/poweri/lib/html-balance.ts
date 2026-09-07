/**
 * PowerI 产品层：HTML 标签配对校验
 *
 * 模型输出（尤其描述代码改动的文本）常含未闭合的 HTML 标签字面，
 * 例如 `from <a href download> to <button onClick downloadFile>`。
 * rehype-raw 会宽容解析这些标签：未闭合的 `<a>` 吞掉后续段落，
 * 产生 `<p>` 嵌套等结构破坏（React p-in-p 警告、整段变链接样式）。
 *
 * escapeUnbalancedHtml 把未配对的 HTML 开标签转成 inline code
 * （`<a href download>` → `` `<a href download>` ``），既保留原文本
 * 可读性，又避免 rehype-raw 的结构破坏。成对标签与 void 标签不动。
 */

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*?)?\/?>/g;

interface TagEvent {
  index: number;
  raw: string;
  tag: string;
  isClose: boolean;
  isSelfClose: boolean;
}

/** 收集所有标签事件（跳过 ``` 代码围栏内的内容） */
function collectTags(markdown: string): { events: TagEvent[]; fenceRanges: Array<[number, number]> } {
  const events: TagEvent[] = [];
  const fenceRanges: Array<[number, number]> = [];
  const lines = markdown.split(/\r?\n/);
  let offset = 0;
  let fence: { marker: string; size: number } | null = null;
  let fenceStart = 0;

  for (const line of lines) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const size = fenceMatch[1].length;
      if (!fence) {
        fence = { marker, size };
        fenceStart = offset;
      } else if (marker === fence.marker && size >= fence.size) {
        fenceRanges.push([fenceStart, offset + line.length]);
        fence = null;
      }
    }
    if (!fence) {
      TAG_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TAG_RE.exec(line)) !== null) {
        const raw = m[0];
        const isClose = raw.startsWith("</");
        const isSelfClose = /\/\s*>$/.test(raw);
        const tag = raw.match(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/)?.[1] ?? "";
        events.push({ index: offset + m.index, raw, tag, isClose, isSelfClose });
      }
    }
    offset += line.length + 1;
  }
  if (fence) fenceRanges.push([fenceStart, offset]);
  return { events, fenceRanges };
}

/** 找出未配对的开标签（栈匹配；void/自闭合不入栈） */
function findUnbalanced(events: TagEvent[]): Set<number> {
  const unbalanced = new Set<number>();
  const stack: TagEvent[] = [];
  for (const ev of events) {
    if (VOID_TAGS.has(ev.tag) || ev.isSelfClose) continue;
    if (ev.isClose) {
      // 从栈顶找同名开标签（容错跨标签闭合）
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === ev.tag) {
          stack.splice(i, 1);
          break;
        }
      }
    } else {
      stack.push(ev);
    }
  }
  for (const ev of stack) unbalanced.add(ev.index);
  return unbalanced;
}

/**
 * 把未配对的 HTML 开标签转义为 inline code。
 * 跳过 ``` 代码围栏内的内容。
 */
export function escapeUnbalancedHtml(markdown: string): string {
  const { events, fenceRanges } = collectTags(markdown);
  if (events.length === 0) return markdown;

  const unbalanced = findUnbalanced(events);
  const inFence = (index: number) => fenceRanges.some(([s, e]) => index >= s && index < e);

  // 从后往前替换，保持 index 有效
  let out = markdown;
  for (const ev of [...events].reverse()) {
    if (!unbalanced.has(ev.index) || inFence(ev.index)) continue;
    const code = ev.raw;
    const escaped = `\`${code}\``;
    out = out.slice(0, ev.index) + escaped + out.slice(ev.index + ev.raw.length);
  }
  return out;
}
