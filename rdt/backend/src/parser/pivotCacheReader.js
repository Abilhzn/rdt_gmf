const fs = require('fs');
const JSZip = require('jszip');

// Reads Excel PivotTable "pivot cache" data directly out of the raw .xlsx zip — the source rows
// behind a pivot table, which Excel keeps internally (and uses for "double-click a cell to drill
// down") even when no visible worksheet carries that detail anymore. exceljs's worksheet API has
// no concept of this at all (it only sees xl/worksheets/*.xml), so this reads the OOXML
// xl/pivotCache/pivotCacheDefinition*.xml + pivotCacheRecords*.xml pair directly. Found 26 Jul via
// contoh_input/06. DT TJ - Jun 2026.xlsx: a file with only a pivot sheet visible, but whose
// pivot cache turned out to hold the full 490-row/59-column detail dataset (verified identical to
// contoh_input/06. DT TJ JUN 2026 R1.xlsx's visible detail sheet).

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // must run last, so decoded entities' own "&" isn't re-decoded
}

function attrVal(attrsStr, name) {
  const m = attrsStr.match(new RegExp(name + '="([^"]*)"'));
  return m ? decodeXmlEntities(m[1]) : null;
}

// Coerces one shared-item / inline-value tag (<s>, <n>, <d>, <b>, <e>, <m>) into a JS value.
function coerceTagValue(tag, attrs) {
  const v = attrVal(attrs, 'v');
  switch (tag) {
    case 's': return v === null ? '' : v;
    case 'n': return v === null ? null : Number(v);
    case 'd': return v === null ? null : new Date(v);
    case 'b': return v === '1';
    case 'e': return null; // formula error in source data — nothing usable to carry over
    case 'm': return null; // explicit missing/blank
    default: return null;
  }
}

// Parses <cacheField name="..."><sharedItems ...>[items]</sharedItems></cacheField> blocks (or
// self-closed <sharedItems .../> with zero items, which just means "this field stores values
// inline in every record, not by index" — both forms are legal and both appear in real files).
function parseCacheFields(defXml) {
  const fields = [];
  const fieldRe = /<cacheField\s+([^>]*?)>([\s\S]*?)<\/cacheField>/g;
  let fm;
  while ((fm = fieldRe.exec(defXml))) {
    const name = attrVal(fm[1], 'name');
    const inner = fm[2];
    let sharedItems = null; // null = no index table, this field's records carry inline values
    const siOpenMatch = inner.match(/<sharedItems\s+([^>]*?)(\/>|>)/);
    if (siOpenMatch && siOpenMatch[2] === '>') {
      const siStart = siOpenMatch.index + siOpenMatch[0].length;
      const siEndTag = inner.indexOf('</sharedItems>', siStart);
      const siInner = siEndTag === -1 ? '' : inner.slice(siStart, siEndTag);
      sharedItems = [];
      const itemRe = /<(s|n|d|b|e|m)\b([^>]*?)\/>/g;
      let im;
      while ((im = itemRe.exec(siInner))) {
        sharedItems.push(coerceTagValue(im[1], im[2]));
      }
    }
    fields.push({ name, sharedItems });
  }
  return fields;
}

// Parses <r>[values]</r> record blocks. Each value tag is either a direct typed value (<s>/<n>/
// <d>/<b>/<e>/<m>) or an <x v="N"/> index into that field's sharedItems array — resolved here so
// callers get a plain array of already-resolved values, one per field, in field-definition order.
function parseCacheRecords(recXml, fields) {
  const records = [];
  const recordRe = /<r>([\s\S]*?)<\/r>/g;
  let rm;
  while ((rm = recordRe.exec(recXml))) {
    const inner = rm[1];
    const valueRe = /<(x|s|n|d|b|e|m)\b([^>]*?)\/>/g;
    const values = [];
    let vm;
    while ((vm = valueRe.exec(inner))) {
      const [, tag, attrs] = vm;
      if (tag === 'x') {
        const idx = Number(attrVal(attrs, 'v'));
        const field = fields[values.length];
        values.push(field && field.sharedItems ? field.sharedItems[idx] : null);
      } else {
        values.push(coerceTagValue(tag, attrs));
      }
    }
    records.push(values);
  }
  return records;
}

// Returns an array of { fields: [{name}], records: [{ [fieldName]: value, ... }] } — one entry
// per pivot cache found in the workbook (real files have had exactly one so far, but a workbook
// could in principle carry more than one pivot table/cache).
async function readPivotCaches(filePath) {
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const defFiles = Object.keys(zip.files).filter((p) => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(p));

  const caches = [];
  for (const defPath of defFiles) {
    const n = defPath.match(/pivotCacheDefinition(\d+)\.xml$/)[1];
    const recPath = `xl/pivotCache/pivotCacheRecords${n}.xml`;
    if (!zip.files[recPath]) continue;

    const defXml = await zip.files[defPath].async('string');
    const recXml = await zip.files[recPath].async('string');

    const fields = parseCacheFields(defXml);
    const rawRecords = parseCacheRecords(recXml, fields);
    const records = rawRecords.map((values) => {
      const obj = {};
      fields.forEach((f, i) => { obj[f.name] = values[i]; });
      return obj;
    });

    caches.push({ fields, records });
  }
  return caches;
}

module.exports = { readPivotCaches };
