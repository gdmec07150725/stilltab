import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from '../node_modules/sharp/lib/index.js';
import { fileURLToPath } from 'node:url';
const project = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const extension = path.join(project, 'apps/extension');
const out = path.join(project, 'releases/extension/1.0.1/store-assets');
await fs.mkdir(out, {recursive:true});
const iconSource = await fs.readFile(path.join(extension, 'assets/icon.svg'));
const iconData = `data:image/svg+xml;base64,${iconSource.toString('base64')}`;
const textStyle = `font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif"`;
for (const size of [128, 300, 512]) {
  let mark = sharp(iconSource, {density:384}).resize(size === 128 ? 96 : size, size === 128 ? 96 : size);
  if (size === 128) mark = mark.extend({top:16,bottom:16,left:16,right:16,background:{r:0,g:0,b:0,alpha:0}});
  await mark.png().toFile(path.join(out, `logo-${size}.png`));
}
const small = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280"><rect width="440" height="280" fill="#F6F7F4"/><rect x="0" y="256" width="440" height="24" fill="#206B5D"/><image href="${iconData}" x="35" y="64" width="100" height="100"/><text x="157" y="115" ${textStyle} font-size="46" font-weight="700" fill="#206B5D">停一下</text><text x="159" y="153" ${textStyle} font-size="19" fill="#52756B">网页行为规则</text><text x="35" y="218" ${textStyle} font-size="20" fill="#344F47">提醒 · 等待 · 拦截</text></svg>`;
const large = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="560"><rect width="1400" height="560" fill="#F6F7F4"/><rect x="0" y="536" width="1400" height="24" fill="#206B5D"/><image href="${iconData}" x="90" y="120" width="280" height="280"/><text x="440" y="240" ${textStyle} font-size="88" font-weight="700" fill="#206B5D">停一下</text><text x="445" y="303" ${textStyle} font-size="32" fill="#52756B">网页行为规则</text><text x="445" y="389" ${textStyle} font-size="29" fill="#344F47">提醒 · 等待 · 拦截</text><text x="445" y="439" ${textStyle} font-size="23" fill="#60786D">自己定规则，让每次打开都更有意识。</text></svg>`;
for (const [name, svg] of [['promo-440x280',small], ['marquee-1400x560',large]]) {
 await fs.writeFile(path.join(out, `${name}.svg`), svg);
 await sharp(Buffer.from(svg)).flatten({background:'#F6F7F4'}).png().toFile(path.join(out, `${name}.png`));
}
const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#F6F7F4"/><image href="${iconData}" x="48" y="60" width="200" height="200"/><text x="292" y="124" ${textStyle} font-size="45" font-weight="700" fill="#206B5D">停一下</text><text x="294" y="168" ${textStyle} font-size="23" fill="#52756B">网页行为规则</text><text x="294" y="224" ${textStyle} font-size="20" fill="#344F47">提醒、等待或拦截。规则由你来定。</text><line x1="48" y1="300" x2="752" y2="300" stroke="#D9E3DD"/><text x="48" y="349" ${textStyle} font-size="15" fill="#688074">工具栏尺寸</text><image href="${iconData}" x="169" y="327" width="16" height="16"/><image href="${iconData}" x="215" y="321" width="32" height="32"/><image href="${iconData}" x="280" y="313" width="48" height="48"/><rect x="416" y="315" width="168" height="44" rx="8" fill="#30333B"/><image href="${iconData}" x="435" y="329" width="16" height="16"/><image href="${iconData}" x="475" y="321" width="32" height="32"/></svg>`;
await sharp(Buffer.from(preview)).png().toFile(path.join(out, 'brand-preview.png'));
console.log(out);