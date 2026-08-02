/**
 * 轻量 Markdown 解析器（无外部依赖）
 * 由 edit.html 的预览功能使用，也可在其它页面通过 <script src> 引入。
 *
 * 暴露的全局函数：
 *   - parseMarkdown(md)  将 Markdown 文本解析为 HTML 字符串
 *   - parseInline(text)  解析行内语法（加粗/斜体/代码/链接/图片）
 *   - escapeHtml(s)      HTML 转义
 *   - inlineAndBr(text)  行内解析 + 换行处理（\n 转为 <br>）
 *
 * 同时挂载到 window.MarkdownParser，便于命名空间调用。
 *
 * 行为约定：
 *   - 文本中的 <br> / <br/> 等同普通文字，不做特殊处理（保持转义，安全显示）
 *   - 空行不拆分独立段落，直接按换行符处理（即原样保留为换行 <br>）
 */
(function (global) {
    'use strict';

    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function parseInline(text) {
        // text 已做 HTML 转义
        text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
            (m, alt, url) => `<img src="${url}" alt="${alt}">`);
        text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
            (m, t, url) => `<a href="${url}" target="_blank" rel="noopener">${t}</a>`);
        text = text.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
        text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        text = text.replace(/_([^_]+)_/g, '<em>$1</em>');
        return text;
    }

    /**
     * 行内解析 + 软换行处理：
     *  - 文本中的 <br> / <br/> 不做特殊处理，保持转义（按普通文字显示，避免 XSS）
     *  - 文本内的 \n 转为 <br>（所见即所得）
     */
    function inlineAndBr(text) {
        let s = escapeHtml(text);
        s = s.replace(/\n/g, '<br>');
        return parseInline(s);
    }

    function parseMarkdown(md) {
        const lines = md.replace(/\r\n/g, '\n').split('\n');
        let html = '';
        let i = 0;
        let para = [];
        // 嵌套列表栈，元素为 { indent, type, liOpen }
        let listStack = [];

        function flushPara() {
            if (para.length) {
                const joined = para.join('\n');
                // 纯空行不输出空段落
                if (joined.trim() === '') { para = []; return; }
                html += '<p>' + inlineAndBr(joined) + '</p>';
                para = [];
            }
        }

        // 关闭一层列表（含其未闭合的 li）
        function closeOneLevel() {
            const t = listStack.pop();
            if (t.liOpen) html += '</li>';
            html += `</${t.type}>`;
        }

        function closeList() {
            while (listStack.length) closeOneLevel();
        }

        while (i < lines.length) {
            const line = lines[i];

            // 代码块 ```
            if (/^```/.test(line)) {
                flushPara(); closeList();
                const code = [];
                i++;
                while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
                i++;
                html += '<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>';
                continue;
            }

            // 分隔线
            if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
                flushPara(); closeList();
                html += '<hr>';
                i++; continue;
            }

            // 标题
            const h = line.match(/^(#{1,6})\s+(.*)$/);
            if (h) {
                flushPara(); closeList();
                const level = h[1].length;
                html += `<h${level}>${inlineAndBr(h[2])}</h${level}>`;
                i++; continue;
            }

            // 引用
            if (/^>\s?/.test(line)) {
                flushPara(); closeList();
                const quote = [];
                while (i < lines.length && /^>\s?/.test(lines[i])) {
                    quote.push(lines[i].replace(/^>\s?/, ''));
                    i++;
                }
                html += '<blockquote>' + inlineAndBr(quote.join('\n')) + '</blockquote>';
                continue;
            }

            // 列表项（支持嵌套层级，缩进决定层级）
            const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
            if (listMatch) {
                flushPara();
                const indent = listMatch[1].length;
                const marker = listMatch[2];
                const content = listMatch[3];
                const type = /\d+\./.test(marker) ? 'ol' : 'ul';

                // 1) 关闭所有比当前缩进更深的层级
                while (listStack.length && listStack[listStack.length - 1].indent > indent) {
                    closeOneLevel();
                }

                const top = listStack[listStack.length - 1];

                if (!top) {
                    // 全新列表
                    html += `<${type}>`;
                    listStack.push({ indent, type, liOpen: false });
                } else if (top.indent === indent) {
                    // 同级：先闭合上一层级的当前 li
                    if (top.liOpen) { html += '</li>'; top.liOpen = false; }
                    if (top.type !== type) {
                        // 同级但类型不同：换列表
                        closeOneLevel();
                        html += `<${type}>`;
                        listStack.push({ indent, type, liOpen: false });
                    }
                } else {
                    // top.indent < indent：嵌套子列表
                    html += `<${type}>`;
                    listStack.push({ indent, type, liOpen: false });
                }

                // 开启新的列表项
                const cur = listStack[listStack.length - 1];
                html += `<li>${inlineAndBr(content)}`;
                cur.liOpen = true;
                i++; continue;
            }

            // 空行：列表区内结束当前列表；普通文本区内按换行符处理（不拆分段落）
            if (/^\s*$/.test(line)) {
                if (listStack.length) {
                    closeList();
                } else {
                    para.push('');
                }
                i++; continue;
            }

            // 普通段落文本（段内换行会被 inlineAndBr 保留为 <br>）
            para.push(line.trim());
            i++;
        }
        flushPara(); closeList();
        return html;
    }

    // 暴露为全局函数（兼容直接调用 parseMarkdown(...)）
    global.escapeHtml = escapeHtml;
    global.parseInline = parseInline;
    global.parseMarkdown = parseMarkdown;
    global.inlineAndBr = inlineAndBr;
    global.MarkdownParser = { escapeHtml, parseInline, parseMarkdown, inlineAndBr };
})(typeof window !== 'undefined' ? window : this);
