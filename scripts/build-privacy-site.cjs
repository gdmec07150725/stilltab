const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'releases', 'extension', '1.0.1', 'privacy-site');
const source = fs.readFileSync(path.join(root, 'docs', 'store', '隐私政策.md'), 'utf8').replace(/^\uFEFF/, '').trim();
const product = '停一下 · 网页行为规则';
const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = text => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

const css = `
:root{color-scheme:light;--ink:#183b35;--muted:#61746b;--green:#147d72;--paper:#fbfcf8;--line:#dce5de}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.85}
a{color:var(--green);text-underline-offset:4px}a:focus-visible{outline:3px solid #5ea89d;outline-offset:5px;border-radius:2px}
.wrap{width:min(100% - 40px,820px);margin:0 auto}.masthead{padding:34px 0 28px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:13px}.mark{display:grid;place-items:center;flex:none;width:40px;height:40px;background:var(--green);border-radius:12px;color:#f8f8e9}.mark svg{width:26px;height:26px}.brand{font-size:16px;font-weight:650;letter-spacing:.015em}.brand small{display:block;font-size:12px;color:var(--muted);font-weight:400;letter-spacing:.04em}
main{padding:44px 0 38px}.eyebrow{font-size:12px;font-weight:650;color:var(--green);letter-spacing:.12em;margin:0 0 10px}h1{font-size:clamp(27px,4.2vw,37px);font-weight:700;letter-spacing:-.035em;line-height:1.35;margin:0 0 16px}h2{font-size:21px;line-height:1.5;margin:42px 0 15px;letter-spacing:-.02em}p{margin:0 0 18px;overflow-wrap:anywhere}.date{color:var(--muted);font-size:14px;margin-bottom:28px}.intro{font-size:17px;color:#425e55;max-width:650px}.choice-list{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:32px}.choice{display:block;padding:28px;border:1px solid var(--line);border-radius:14px;background:#fff;color:var(--ink);text-decoration:none}.choice:hover{border-color:var(--green);background:#f2f8f2}.choice strong{font-size:23px;display:block;margin-bottom:9px}.choice span{color:var(--muted);display:block;font-size:14px}.choice .go{margin-top:19px;font-weight:650;color:var(--green)}.note{padding:18px 21px;border-left:3px solid #77a794;background:#f0f5ed;color:#466358;margin:28px 0;font-size:14px}.back{font-size:14px;display:inline-block;margin-top:26px}.footer{border-top:1px solid var(--line);padding:24px 0 35px;color:var(--muted);font-size:12px}.footer p{margin:0}
@media(max-width:560px){.wrap{width:min(100% - 32px,820px)}.masthead{padding:24px 0 22px}main{padding-top:32px}.choice-list{grid-template-columns:1fr}.choice{padding:23px}h2{margin-top:34px;font-size:20px}body{font-size:15px;line-height:1.9}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
@media print{body{background:#fff;color:#111}.wrap{width:100%;max-width:none}.masthead{padding-top:0}.back{display:none}h2{break-after:avoid}p{orphans:3;widows:3}}
`;

const mark = '<span class="mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><rect x="3" y="4" width="26" height="24" rx="4" stroke="currentColor" stroke-width="2"/><path d="M4 11h24" stroke="currentColor" stroke-width="2"/><rect x="11" y="15" width="4" height="9" rx="1" fill="currentColor"/><rect x="18" y="15" width="4" height="9" rx="1" fill="currentColor"/></svg></span>';
function page(title, subtitle, body, description) {
  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="description" content="${escapeHtml(description)}">\n<meta name="color-scheme" content="light">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">\n<title>${escapeHtml(title)}</title>\n<style>${css}</style>\n</head>\n<body>\n<div class="wrap">\n<header class="masthead">${mark}<div class="brand">${product}<small>${escapeHtml(subtitle)}</small></div></header>\n<main>${body}</main>\n<footer class="footer"><p>${product} · 规则与记录在设备本机处理</p></footer>\n</div>\n</body>\n</html>\n`;
}
function markdownToHtml(markdown) {
  return markdown.split(/\r?\n\s*\r?\n/).map(block => {
    if (block.startsWith('# ')) return `<h1>${inline(block.slice(2))}</h1>`;
    if (block.startsWith('## ')) return `<h2>${inline(block.slice(3))}</h2>`;
    if (block.startsWith('更新日期：')) return `<p class="date">${inline(block)}</p>`;
    return `<p>${inline(block.replace(/\r?\n/g, ' '))}</p>`;
  }).join('\n');
}

fs.mkdirSync(output, {recursive: true});
for (const browser of [{id:'chrome', label:'Chrome', store:'Chrome Web Store'}, {id:'edge', label:'Microsoft Edge', store:'Microsoft Edge Add-ons'}]) {
  let markdown = source.replace(/^# .+$/m, '# 隐私政策').replace('适用于该扩展在桌面 Microsoft Edge 和 Chrome 中提供的功能。', `适用于该扩展在桌面 ${browser.label} 中提供的功能。`);
  if (browser.id === 'edge') {
    markdown = markdown.replace('本扩展对用户数据的使用仅限于上述用户可见功能，遵守 Chrome Web Store 用户数据政策，包括其 Limited Use 要求。开发者不会通过扩展远程读取你的本地数据。', '本扩展对用户数据的使用仅限于上述用户可见功能，并遵守 Microsoft Edge Add-ons 开发者政策的数据使用要求。开发者不会通过扩展远程读取你的本地数据。');
  }
  markdown = markdown.replace('如需联系开发者，请使用本扩展商店详情页中列出的开发者或支持联系方式。', `如需联系开发者，请使用本扩展在 ${browser.store} 商店详情页中列出的开发者或支持联系方式。`);
  const body = `<p class="eyebrow">${escapeHtml(browser.label)} 扩展</p>\n${markdownToHtml(markdown)}\n<a class="back" href="./index.html">返回隐私政策首页</a>`;
  const html = page(`${product}隐私政策 · ${browser.label}`, `${browser.label} · 隐私政策`, body, `${product}在${browser.label}中的隐私政策：本机处理规则、网页地址与用时，不向开发者上传浏览记录。`);
  assert(!/<script\b/i.test(html), 'Privacy pages must not include scripts');
  assert(!/https?:\/\//i.test(html), 'Privacy pages must not include external resources or placeholder domains');
  assert(!/待填写|待提供|TODO|example\.com/.test(html), 'Privacy pages must not include placeholders');
  if (browser.id === 'edge') assert(!/Chrome|Limited Use/i.test(html), 'Edge page must be specific to Microsoft Edge');
  if (browser.id === 'chrome') assert(!/Microsoft Edge/i.test(html), 'Chrome page must be specific to Chrome');
  for (const phrase of ['最多 300 条', '最近 8 个', '查询参数和锚点', '未对本地存储', '触发记录', '政策更新与联系']) assert(html.includes(phrase), `Missing policy content: ${phrase}`);
  fs.writeFileSync(path.join(output, `${browser.id}.html`), html, 'utf8');
}
const landing = `<p class="eyebrow">隐私政策</p>\n<h1>你的浏览规则，<br>留在你的设备上。</h1>\n<p class="intro">「停一下」会在本机处理网页地址、浏览用时和你设置的规则。选择所使用的浏览器，查看完整的数据处理说明。</p>\n<div class="choice-list"><a class="choice" href="./chrome.html"><strong>Chrome</strong><span>适用于桌面 Chrome 扩展</span><span class="go">查看隐私政策 →</span></a><a class="choice" href="./edge.html"><strong>Microsoft Edge</strong><span>适用于桌面 Microsoft Edge 扩展</span><span class="go">查看隐私政策 →</span></a></div>\n<p class="note">不需要注册账号。规则、用时和触发记录由扩展在本机保存，不上传给开发者。</p>`;
fs.writeFileSync(path.join(output, 'index.html'), page(`${product} · 隐私政策`, '隐私政策', landing, '停一下 · 网页行为规则隐私政策。选择 Chrome 或 Microsoft Edge，查看本地数据处理与用户控制方式。'), 'utf8');
console.log(`Generated privacy pages: ${output}`);
console.log('Verified: three static HTML pages; complete policy text; browser-specific wording; no scripts, external resources, or placeholder contact details.');
