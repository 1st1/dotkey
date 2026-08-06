import { readKeynoteFile } from '../packages/core/src/node.js';

const doc = await readKeynoteFile(process.argv[2] ?? 'backends_gtm.key');
const { deck } = doc;
console.log('size', deck.size, 'slides', deck.slides.length);
console.log('fonts', deck.fonts);
console.log('metadata', deck.metadata);
console.log('resources', Object.keys(deck.resources).length, 'unavailable', Object.values(deck.resources).filter(r=>!r.available).length);
console.log('warnings', doc.warnings.length);

const summarize = (e: any, d = 1): string => {
  const pad = '  '.repeat(d);
  const f = e.frame;
  const geo = `[${f.x.toFixed(0)},${f.y.toFixed(0)} ${f.width.toFixed(0)}x${f.height.toFixed(0)}${f.autoWidth?' aw':''}${f.autoHeight?' ah':''}]${e.rotation?` rot${e.rotation.toFixed(0)}`:''}`;
  let line = `${pad}${e.kind} ${geo}`;
  if (e.kind === 'shape') {
    if (e.fill) line += ` fill:${e.fill.type}`;
    if (e.stroke) line += ` stroke:${e.stroke.width}`;
    line += ` path:${e.path.type}`;
    if (e.text) {
      line += ` va:${e.text.verticalAlign} pad:${e.text.padding.left}`;
      for (const p of e.text.paragraphs) {
        line += `\n${pad}  ¶ ${p.align} lvl${p.listLevel}${p.bullet?` bullet:${p.bullet.kind}${p.bullet.text?JSON.stringify(p.bullet.text):p.bullet.label??''}`:''} ls:${p.lineSpacing.mode}=${p.lineSpacing.amount}`;
        for (const r of p.runs) line += `\n${pad}    "${r.text.slice(0,60)}" ${r.style.fontFamily}/${r.style.fontWeight}/${r.style.fontStyle} ${r.style.fontSize}pt ${r.style.color?`rgba(${[r.style.color.r,r.style.color.g,r.style.color.b].map(v=>Math.round(v*255)).join(',')},${r.style.color.a})`:'-'}`;
      }
    }
  }
  if (e.kind === 'image') line += ` res:${e.resource} nat:${e.naturalSize.width}x${e.naturalSize.height}${e.crop?` crop[${e.crop.x.toFixed(0)},${e.crop.y.toFixed(0)} ${e.crop.width.toFixed(0)}x${e.crop.height.toFixed(0)}]`:''}`;
  if (e.kind === 'movie') line += ` res:${e.resource} poster:${e.poster} loop:${e.loop}`;
  if (e.kind === 'unsupported') line += ` <${e.archive}>`;
  if (e.kind === 'group') for (const c of e.children) line += '\n' + summarize(c, d + 1);
  return line;
};

const only = process.argv[3] ? Number(process.argv[3]) : null;
for (const s of deck.slides) {
  if (only !== null && s.index !== only) continue;
  console.log(`\n=== slide ${s.index} (#${s.number}) bg=${s.background?.type ?? 'none'} master=${s.masterElements.length} elems=${s.elements.length}${s.notes?' notes':''}`);
  for (const e of s.masterElements) console.log('M' + summarize(e).slice(1));
  for (const e of s.elements) console.log(summarize(e));
}
