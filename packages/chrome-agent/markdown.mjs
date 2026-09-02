export function parseMarkdown(source) {
  const lines = String(source ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^ {0,3}```([\w-]*)\s*$/);
    if (fence) {
      const content = [];
      index += 1;
      while (index < lines.length && !/^ {0,3}```\s*$/.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        type: "code",
        language: fence[1],
        value: content.join("\n"),
      });
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2]),
      });
      index += 1;
      continue;
    }

    if (isRule(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^ {0,3}> ?/, ""));
        index += 1;
      }
      blocks.push({
        type: "quote",
        children: parseMarkdown(quoted.join("\n")),
      });
      continue;
    }

    const firstItem = listItem(line);
    if (firstItem) {
      const items = [];
      const ordered = firstItem.ordered;
      while (index < lines.length) {
        const item = listItem(lines[index]);
        if (!item || item.ordered !== ordered) break;
        items.push(parseInline(item.value));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({
      type: "paragraph",
      children: parseInline(paragraph.join(" ")),
    });
  }

  return blocks;
}

export function parseInline(source) {
  const value = String(source ?? "");
  const tokens = [];
  const pattern =
    /`([^`\n]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(value))) {
    if (match.index > cursor)
      tokens.push({ type: "text", value: value.slice(cursor, match.index) });
    if (match[1] !== undefined) {
      tokens.push({ type: "code", value: match[1] });
    } else if (match[2] !== undefined || match[3] !== undefined) {
      tokens.push({
        type: "strong",
        children: parseInline(match[2] ?? match[3]),
      });
    } else if (match[4] !== undefined) {
      tokens.push({ type: "strike", children: parseInline(match[4]) });
    } else if (match[5] !== undefined) {
      tokens.push({ type: "image", alt: match[5], url: match[6] });
    } else if (match[7] !== undefined) {
      tokens.push({
        type: "link",
        children: parseInline(match[7]),
        url: match[8],
      });
    } else {
      tokens.push({
        type: "emphasis",
        children: parseInline(match[9] ?? match[10]),
      });
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < value.length)
    tokens.push({ type: "text", value: value.slice(cursor) });
  return tokens;
}

export function resolveMarkdownUrl(value, baseUrl) {
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function renderMarkdown(container, source, { baseUrl } = {}) {
  const document = container.ownerDocument;
  const fragment = document.createDocumentFragment();
  renderBlocks(document, fragment, parseMarkdown(source), baseUrl);
  container.replaceChildren(fragment);
}

function renderBlocks(document, parent, blocks, baseUrl) {
  for (const block of blocks) {
    if (block.type === "rule") {
      parent.append(document.createElement("hr"));
      continue;
    }
    if (block.type === "quote") {
      const quote = document.createElement("blockquote");
      renderBlocks(document, quote, block.children, baseUrl);
      parent.append(quote);
      continue;
    }
    if (block.type === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const listItem = document.createElement("li");
        renderInline(document, listItem, item, baseUrl);
        list.append(listItem);
      }
      parent.append(list);
      continue;
    }
    if (block.type === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.value;
      if (block.language) code.dataset.language = block.language;
      pre.append(code);
      parent.append(pre);
      continue;
    }
    const element = document.createElement(
      block.type === "heading" ? `h${block.level}` : "p",
    );
    renderInline(document, element, block.children, baseUrl);
    parent.append(element);
  }
}

function renderInline(document, parent, tokens, baseUrl) {
  for (const token of tokens) {
    if (token.type === "text") {
      parent.append(document.createTextNode(token.value));
      continue;
    }
    if (token.type === "code") {
      const code = document.createElement("code");
      code.textContent = token.value;
      parent.append(code);
      continue;
    }
    if (token.type === "image") {
      parent.append(document.createTextNode(token.alt));
      continue;
    }
    const tag = {
      emphasis: "em",
      strong: "strong",
      strike: "s",
      link: "a",
    }[token.type];
    const element = document.createElement(tag);
    if (token.type === "link") {
      const href = resolveMarkdownUrl(token.url, baseUrl);
      if (!href) {
        renderInline(document, parent, token.children, baseUrl);
        continue;
      }
      element.href = href;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
    renderInline(document, element, token.children, baseUrl);
    parent.append(element);
  }
}

function isBlockStart(line) {
  return (
    /^ {0,3}```/.test(line) ||
    /^ {0,3}#{1,6}\s+/.test(line) ||
    /^ {0,3}>/.test(line) ||
    isRule(line) ||
    Boolean(listItem(line))
  );
}

function isRule(line) {
  return /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line);
}

function listItem(line) {
  const unordered = line.match(/^\s{0,3}[-+*]\s+(.+)$/);
  if (unordered) return { ordered: false, value: unordered[1] };
  const ordered = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
  return ordered ? { ordered: true, value: ordered[1] } : undefined;
}
