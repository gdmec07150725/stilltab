import { build } from 'esbuild';
import sharp from 'sharp';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const name = '停一下 · 网页行为规则';
const icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon${size}.png`]));
await mkdir(path.join(dist, 'icons'), { recursive: true });
await mkdir(path.join(root, 'icons'), { recursive: true });
for (const [size, file] of Object.entries(icons)) {
  const pixels = Number(size);
  let mark = sharp(path.join(root, 'assets/icon.svg'), { density: 384 })
    .resize(pixels === 128 ? 96 : pixels, pixels === 128 ? 96 : pixels);
  // Chrome Web Store requires a 96 px square mark with 16 px transparent padding.
  if (pixels === 128) mark = mark.extend({top:16, bottom:16, left:16, right:16, background:{r:0,g:0,b:0,alpha:0}});
  await mark.png().toFile(path.join(dist, file));
  await copyFile(path.join(dist, file), path.join(root, file));
}
await build({
  absWorkingDir: root,
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/options.ts', 'src/popup.ts'],
  outdir: dist, bundle: true, format: 'iife', target: 'chrome120',
  minify: false, sourcemap: false, charset: 'utf8', legalComments: 'none',
});
for (const file of ['options.html', 'popup.html']) await copyFile(path.join(root, file), path.join(dist, file));
await copyFile(path.join(root, 'src/styles.css'), path.join(dist, 'styles.css'));
const manifest = {
  manifest_version: 3,
  name, short_name: '停一下', version: pkg.version,
  description: '为指定网站设置提醒、等待或拦截，按时段和每日额度管理浏览习惯。规则与记录仅保存在本机。',
  minimum_chrome_version: '120',
  icons,
  permissions: ['storage', 'scripting', 'alarms', 'webNavigation', 'idle'],
  host_permissions: ['http://*/*', 'https://*/*'],
  background: { service_worker: 'background.js' },
  action: { default_title: name, default_popup: 'popup.html', default_icon: icons },
  options_page: 'options.html',
  content_scripts: [{ matches: ['http://*/*', 'https://*/*'], js: ['content.js'], run_at: 'document_start' }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
};
await writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// Preserve the source HTML and make the previously installed source path loadable.
for (const file of ['manifest.json', 'background.js', 'content.js', 'options.js', 'popup.js', 'styles.css']) {
  await copyFile(path.join(dist, file), path.join(root, file));
}
console.log(`已构建 ${name} ${pkg.version}：${dist}（源码目录也可直接加载）`);