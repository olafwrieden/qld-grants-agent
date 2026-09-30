// Tiny, safe markdown renderer for agent answers: builds DOM nodes (never innerHTML) so model output can't inject markup.
// Supports headings, paragraphs, bullet/numbered lists (nested by indent), **bold**, *italic*, `code`, [links](url) and bare URLs.
(() => {
  const CITATION = /\s*【[^】]*】/g;
  const INLINE = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"])|(`([^`]+)`)|(\*([^*\s][^*]*)\*)/g;

  function inline(parent, text, onLink) {
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      if (m[1]) {
        const b = document.createElement('strong');
        inline(b, m[2], onLink);
        parent.append(b);
      } else if (m[3]) {
        parent.append(link(m[4], m[5], onLink));
      } else if (m[6]) {
        parent.append(link(prettyUrl(m[6]), m[6], onLink));
      } else if (m[7]) {
        const c = document.createElement('code');
        c.textContent = m[8];
        parent.append(c);
      } else if (m[9]) {
        const i = document.createElement('em');
        i.textContent = m[10];
        parent.append(i);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  function prettyUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\/$/, '');
      const tail = path.split('/').filter(Boolean).pop();
      return u.hostname.replace(/^www\./, '') + (tail ? ` › ${tail.replace(/[-_]/g, ' ')}` : '');
    } catch {
      return url;
    }
  }

  function link(label, href, onLink) {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    onLink?.(a, href);
    return a;
  }

  function render(markdown, { onLink } = {}) {
    const root = document.createDocumentFragment();
    const lines = String(markdown ?? '')
      .replace(CITATION, '')
      .split(/\r?\n/)
      // Drop "Source:"/"Cite:" stubs left behind once citation markers are removed.
      .filter((l) => !/^\s*(?:[-*+]|\d+[.)])?\s*(?:\*\*)?(?:sources?|cite|citations?):?(?:\*\*)?:?\s*$/i.test(l));
    let para = null;
    const stack = []; // [{ el, indent }]

    const closeLists = () => (stack.length = 0);
    const flushPara = () => (para = null);

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) {
        flushPara();
        closeLists();
        continue;
      }
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      const item = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
      if (heading) {
        flushPara();
        closeLists();
        const h = document.createElement('h4');
        inline(h, heading[2], onLink);
        root.append(h);
      } else if (item) {
        flushPara();
        const indent = item[1].replace(/\t/g, '  ').length;
        const ordered = /\d/.test(item[2]);
        if (!stack.length && indent > 0 && /^(OL|UL)$/.test(root.lastChild?.tagName)) stack.push({ el: root.lastChild, indent: 0 });
        while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
        let top = stack[stack.length - 1];
        if (!top || indent > top.indent) {
          const tag = ordered ? 'OL' : 'UL';
          // Loose lists (blank lines between items) continue the previous top-level list instead of restarting at 1.
          const prev = !top && root.lastChild?.tagName === tag ? root.lastChild : null;
          const list = prev ?? document.createElement(tag.toLowerCase());
          const parentLi = top?.el.lastElementChild;
          if (!prev) (parentLi ?? root).append(list);
          stack.push((top = { el: list, indent }));
        }
        const li = document.createElement('li');
        inline(li, item[3], onLink);
        top.el.append(li);
      } else if (stack.length && /^\s+/.test(line)) {
        // continuation line of a list item
        const li = stack[stack.length - 1].el.lastElementChild;
        li.append(document.createElement('br'));
        inline(li, line.trim(), onLink);
      } else {
        closeLists();
        if (!para) {
          para = document.createElement('p');
          root.append(para);
        } else {
          para.append(document.createElement('br'));
        }
        inline(para, line.trim(), onLink);
      }
    }
    return root;
  }

  globalThis.GCMarkdown = { render, stripCitations: (s) => String(s ?? '').replace(CITATION, '') };
})();
