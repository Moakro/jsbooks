/**
 * Dev-only Vite plugin: admin endpoints for canonical scripture editing & mapping.
 * Only runs in `astro dev` (apply: 'serve'); zero effect in production build.
 *
 * Endpoints (POST, JSON body):
 *   /api/admin/canonical-mapping/save  (legacy v1, hangeul=array)
 *   /api/admin/canonical-mapping/bulk  (legacy v1, hangeul=array)
 *   /api/admin/canonical-mapping/save-sentence  (v2, hangeul=string)
 *   /api/admin/scripture-editor/save-chapter
 *
 *   Sentence 구조 조작 (천지개벽경 평면 anchor 모델, X-Y-Z + sub X-Y-Z.N):
 *     /api/admin/sentence/merge-with-prev  { vol, chap, anchor }
 *     /api/admin/sentence/drop             { vol, chap, anchor }
 *     /api/admin/sentence/split-into-sub   { vol, chap, anchor, container_text, sub_texts, are_verses }
 *     /api/admin/sentence/toggle-verse     { vol, chap, anchor }
 *
 *   Sentence 액션 endpoint는 모두 호출 직전 변경 대상 파일을 .bak/<ts>/에 자동 백업하고,
 *   한자 markdown + canonical-mapping JSON + 한글본 백업 markdown 셋을 sync.
 *   anchor shift는 같은 장 안에서만 적용. sub-anchor X-Y-Z.N은 부모 Z가 시프트되면 함께 따라감.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

// Vault and content are now the same directory (repo `content/`). VAULT_PATH
// from .env can override; defaults to <cwd>/content.
const VAULT_ROOT = process.env.VAULT_PATH || path.join(process.cwd(), "content");
const MAPPING_PATH = path.join(
  VAULT_ROOT,
  "scripture/_mappings/cheonjigaebyeokgyeong-canonical.json",
);
const CHANGELOG_DISPLAY_PATH = path.join(
  VAULT_ROOT,
  "_data/changelog-display.json",
);

// ─── helpers ────────────────────────────────────────────────────────────────

async function readJson(p) {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}
async function writeJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}
async function readText(p) {
  return fs.readFile(p, "utf8");
}
async function writeText(p, text) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, "utf8");
}
async function backup(p) {
  try {
    const stat = await fs.stat(p);
    if (!stat.isFile()) return;
  } catch {
    return;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(VAULT_ROOT, ".bak", ts);
  const rel = path.relative(VAULT_ROOT, p);
  const dest = rel.startsWith("..")
    ? path.join(dir, "_external", path.basename(p))
    : path.join(dir, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(p, dest);
}
async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

// ─── mapping JSON ───────────────────────────────────────────────────────────

async function loadMapping() {
  try {
    return await readJson(MAPPING_PATH);
  } catch {
    return {
      version: 1,
      scripture: "cheonjigaebyeokgyeong-canonical",
      verses: {},
    };
  }
}
async function persistMapping(mapping) {
  await backup(MAPPING_PATH);
  await writeJson(MAPPING_PATH, mapping);
}
function applyMappingEntry(mapping, entry) {
  const { anchor, hangeul, reviewed, confidence } = entry;
  if (!anchor || !Array.isArray(hangeul)) return;
  if (hangeul.length === 0 && !reviewed) {
    delete mapping.verses[anchor];
    return;
  }
  mapping.verses[anchor] = {
    hangeul,
    reviewed: !!reviewed,
    ...(typeof confidence === "number" ? { confidence } : {}),
  };
}

// v2 (sentence-string) 단건 저장. 빈 string + 미검수 = entry 삭제 (v1 array 동작과 동일).
function applySentenceMapping(mapping, { anchor, hangeul, reviewed }) {
  if (!anchor || typeof hangeul !== "string") {
    throw new Error("anchor and hangeul (string) are required");
  }
  if (!hangeul && !reviewed) {
    delete mapping.verses[anchor];
    return;
  }
  mapping.verses[anchor] = {
    hangeul,
    reviewed: !!reviewed,
  };
}

// ─── markdown parsing/serializing ──────────────────────────────────────────

function splitFrontmatter(raw) {
  const m = raw.match(/^(---\n[\s\S]*?\n---)\n?([\s\S]*)$/);
  if (!m) return { frontmatter: "", body: raw };
  return { frontmatter: m[1], body: m[2] ?? "" };
}
function splitChapterHeading(body) {
  const m = body.match(/^\s*(#\s[^\n]+)\n+([\s\S]*)$/);
  if (!m) return { heading: "", rest: body };
  return { heading: m[1].trim(), rest: m[2] };
}
function parseFrontmatterAnchorPrefix(frontmatter) {
  const volM = frontmatter.match(/^권:\s*(\d+)\s*$/m);
  const chapM = frontmatter.match(/^장:\s*(\d+)\s*$/m);
  if (volM && chapM) return `${parseInt(volM[1], 10)}-${parseInt(chapM[1], 10)}`;
  if (/^section:\s*preface\s*$/m.test(frontmatter)) return "preface";
  return null;
}

function serializeChapter(verses, frontmatter, chapterHeading, anchorPrefix) {
  const lines = [];
  lines.push(frontmatter.trimEnd());
  lines.push("");
  if (chapterHeading) {
    lines.push(chapterHeading);
    lines.push("");
  }
  const migrations = new Map();
  const final = [];
  verses.forEach((v, i) => {
    const num = i + 1;
    const newId = `${anchorPrefix}-${num}`;
    if (v.id && v.id !== newId) migrations.set(v.id, newId);
    if (!v.id) migrations.set(`:new:${i}`, newId);
    final.push({ id: newId, num, text: v.text });
    lines.push(`## ${num}절 ^${newId}`);
    lines.push("");
    const t = (v.text ?? "").trim();
    if (t) {
      lines.push(t);
      lines.push("");
    } else {
      lines.push("");
    }
  });
  let md = lines.join("\n").replace(/\n{3,}$/, "\n");
  if (!md.endsWith("\n")) md += "\n";
  return { markdown: md, verses: final, migrations };
}

function parseExistingAnchors(body) {
  const re = /^## (\d+)절 \^(\S+)[^\n]*$/gm;
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) out.push(m[2]);
  return out;
}

// ─── save-chapter ──────────────────────────────────────────────────────────

function entryIdToPath(entryId) {
  return path.join(VAULT_ROOT, "scripture", `${entryId}.md`);
}

async function rewriteChapter(side) {
  const { entryId, verses } = side;
  const filePath = entryIdToPath(entryId);
  const raw = await readText(filePath);
  const { frontmatter, body } = splitFrontmatter(raw);
  const { heading, rest } = splitChapterHeading(body);
  const prevAnchors = parseExistingAnchors(rest || body);
  const prefix = parseFrontmatterAnchorPrefix(frontmatter);
  if (!prefix) throw new Error(`Cannot determine anchor prefix for ${entryId}`);
  const ser = serializeChapter(verses, frontmatter, heading, prefix);
  await backup(filePath);
  await writeText(filePath, ser.markdown);
  return {
    prevAnchors,
    newAnchors: ser.verses.map((v) => v.id),
    migrations: ser.migrations,
  };
}

function migrateMapping(mapping, hanjaResult, hangeulResult, mappingEdits) {
  if (hanjaResult) {
    const newVerses = {};
    for (const oldKey of Object.keys(mapping.verses)) {
      const isStill = hanjaResult.newAnchors.includes(oldKey);
      const moved = hanjaResult.migrations.get(oldKey);
      if (isStill) {
        newVerses[oldKey] = mapping.verses[oldKey];
      } else if (moved) {
        newVerses[moved] = mapping.verses[oldKey];
      } else if (hanjaResult.prevAnchors.includes(oldKey)) {
        // deleted/merged-away
      } else {
        newVerses[oldKey] = mapping.verses[oldKey];
      }
    }
    mapping.verses = newVerses;
  }

  if (hangeulResult) {
    const movedMap = hangeulResult.migrations;
    const newSet = new Set(hangeulResult.newAnchors);
    const prevSet = new Set(hangeulResult.prevAnchors);
    for (const key of Object.keys(mapping.verses)) {
      const v = mapping.verses[key];
      if (!v?.hangeul) continue;
      const updated = [];
      for (const h of v.hangeul) {
        if (newSet.has(h)) updated.push(h);
        else if (movedMap.has(h)) updated.push(movedMap.get(h));
        else if (prevSet.has(h)) continue;
        else updated.push(h);
      }
      v.hangeul = [...new Set(updated)];
    }
  }

  if (mappingEdits && Array.isArray(mappingEdits.entries)) {
    for (const e of mappingEdits.entries) applyMappingEntry(mapping, e);
  }
  return mapping;
}

async function saveChapterHandler(body) {
  if (!body?.hanja?.entryId || !Array.isArray(body?.hanja?.verses)) {
    throw new Error("hanja.entryId and hanja.verses are required");
  }
  const hanjaResult = await rewriteChapter(body.hanja);
  let hangeulResult = null;
  if (body.hangeul?.entryId && Array.isArray(body.hangeul.verses)) {
    hangeulResult = await rewriteChapter(body.hangeul);
  }
  const mapping = await loadMapping();
  migrateMapping(mapping, hanjaResult, hangeulResult, body.mappings);
  await persistMapping(mapping);
  return {
    ok: true,
    hanja: {
      migrations: [...hanjaResult.migrations],
      anchors: hanjaResult.newAnchors,
    },
    hangeul: hangeulResult
      ? {
          migrations: [...hangeulResult.migrations],
          anchors: hangeulResult.newAnchors,
        }
      : null,
  };
}

// ─── Sentence 구조 조작 (admin actions) ─────────────────────────────────────

const SENTENCE_ANCHOR_LINE_RE = /\^([\w.-]+)\s*$/;

function getAnchorParts(anchor) {
  // 반환: { kind, vol, chap, sent, subs[] }
  if (anchor.startsWith("preface-")) {
    const rest = anchor.slice("preface-".length);
    const parts = rest.split(".");
    return {
      kind: "preface",
      vol: 0,
      chap: 0,
      sent: Number(parts[0]),
      subs: parts.slice(1).map(Number),
    };
  }
  const parts = anchor.split(".");
  const main = parts[0].split("-");
  return {
    kind: "normal",
    vol: Number(main[0]),
    chap: Number(main[1]),
    sent: Number(main[2]),
    subs: parts.slice(1).map(Number),
  };
}
function buildAnchor(p) {
  const base = p.kind === "preface" ? `preface-${p.sent}` : `${p.vol}-${p.chap}-${p.sent}`;
  return p.subs.length ? `${base}.${p.subs.join(".")}` : base;
}
function compareAnchors(a, b) {
  const pa = getAnchorParts(a);
  const pb = getAnchorParts(b);
  if (pa.kind !== pb.kind) return pa.kind === "preface" ? -1 : 1;
  if (pa.vol !== pb.vol) return pa.vol - pb.vol;
  if (pa.chap !== pb.chap) return pa.chap - pb.chap;
  if (pa.sent !== pb.sent) return pa.sent - pb.sent;
  const n = Math.max(pa.subs.length, pb.subs.length);
  for (let i = 0; i < n; i++) {
    const va = pa.subs[i] ?? -1;
    const vb = pb.subs[i] ?? -1;
    if (va !== vb) return va - vb;
  }
  return 0;
}
function sameChapterAndAfter(anchor, refAnchor) {
  const a = getAnchorParts(anchor);
  const r = getAnchorParts(refAnchor);
  if (a.kind !== r.kind) return false;
  if (a.kind === "normal" && (a.vol !== r.vol || a.chap !== r.chap)) return false;
  return a.sent > r.sent;
}
function shiftAnchorSentBy(anchor, delta) {
  const p = getAnchorParts(anchor);
  return buildAnchor({ ...p, sent: p.sent + delta });
}

/** 한자 markdown body에서 paragraph 단위로 sentence 추출. 시구(`> ` 접두사) 인식. */
function parseHanjaSentences(body) {
  const lines = body.split("\n");
  // paragraph 시작/끝 indices와 본문 텍스트 + anchor + isVerse 추출
  const sentences = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) {
      i++;
      continue;
    }
    if (/^#\s/.test(lines[i])) {
      i++;
      continue;
    }
    if (/^---\s*$/.test(lines[i])) {
      i++;
      continue;
    }
    const start = i;
    const buf = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^#\s/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    const end = i - 1;
    const text = buf.join(" ").trim();
    const am = text.match(SENTENCE_ANCHOR_LINE_RE);
    if (!am) continue;
    const anchor = am[1];
    let innerText = text.replace(SENTENCE_ANCHOR_LINE_RE, "").trim();
    let isVerse = false;
    if (innerText.startsWith("> ")) {
      isVerse = true;
      innerText = innerText.slice(2).trim();
    }
    sentences.push({ start, end, anchor, text: innerText, isVerse });
  }
  return { lines, sentences };
}

function renderHanjaParagraph(text, anchor, isVerse) {
  const prefix = isVerse ? "> " : "";
  return `${prefix}${text} ^${anchor}`;
}

/** 한자 markdown frontmatter 유지 + 새 sentence 배열로 body 재구성. */
function rebuildHanjaMarkdown(originalBody, newSentences) {
  // # N장 (또는 # 서) heading은 첫 sentence 전에 한 번만.
  // 본문 body는 frontmatter 다음에 빈 줄로 시작 — 원본과 동일한 leading newline 유지.
  const lines = originalBody.split("\n");
  let headingLine = "";
  for (const ln of lines) {
    if (/^#\s/.test(ln)) {
      headingLine = ln;
      break;
    }
  }
  const out = [""]; // leading blank line (frontmatter 다음)
  if (headingLine) {
    out.push(headingLine);
    out.push("");
  }
  for (const s of newSentences) {
    out.push(renderHanjaParagraph(s.text, s.anchor, s.isVerse));
    out.push("");
  }
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

function splitFmAndBody(raw) {
  const m = raw.match(/^(---\n[\s\S]*?\n---)\n?([\s\S]*)$/);
  if (!m) return { frontmatter: "", body: raw };
  return { frontmatter: m[1], body: m[2] ?? "" };
}

function chapterHanjaPath({ vol, chap, isPreface }) {
  if (isPreface) {
    return path.join(VAULT_ROOT, "scripture/cheonjigaebyeokgyeong/00_서.md");
  }
  // Find by 권 — content dirs are 01_신축편, 02_임인편 등. 우리는 frontmatter로 매칭 안 하고
  // 파일명 패턴으로 찾음: XX_*편/XX-YY_장.md (XX, YY는 zero-padded vol/chap)
  const xx = String(vol).padStart(2, "0");
  const yy = String(chap).padStart(2, "0");
  // 권 디렉토리는 XX_*편 형식 — 글롭 대신 디렉토리 스캔
  const base = path.join(VAULT_ROOT, "scripture/cheonjigaebyeokgyeong");
  for (const d of fsSync.readdirSync(base)) {
    if (d.startsWith(`${xx}_`)) {
      return path.join(base, d, `${xx}-${yy}_장.md`);
    }
  }
  throw new Error(`hanja chapter file not found for vol=${vol} chap=${chap}`);
}
function chapterHangeulPath({ vol, chap, isPreface }) {
  if (isPreface) {
    return path.join(VAULT_ROOT, "scripture/cheonjigaebyeokgyeong-hangeul/00_서.md");
  }
  const xx = String(vol).padStart(2, "0");
  const yy = String(chap).padStart(2, "0");
  const base = path.join(VAULT_ROOT, "scripture/cheonjigaebyeokgyeong-hangeul");
  if (!fsSync.existsSync(base)) return null;
  for (const d of fsSync.readdirSync(base)) {
    if (d.startsWith(`${xx}_`)) {
      return path.join(base, d, `${xx}-${yy}_장.md`);
    }
  }
  return null; // 한글본 백업은 best-effort
}

/** 한글본 백업 markdown에서 `## N절 ^anchor` 헤딩과 본문을 파싱. */
function parseHangeulBackup(body) {
  // 헤딩 라인 인덱스 + body 텍스트 + anchor 추출
  const re = /^## (\d+)절 \^(\S+)\s*$/;
  const lines = body.split("\n");
  const items = []; // [{ headingIdx, bodyStart, bodyEnd, num, anchor }]
  let last = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) {
      if (last) last.bodyEnd = i - 1;
      last = {
        headingIdx: i,
        bodyStart: i + 1,
        bodyEnd: lines.length - 1,
        num: parseInt(m[1], 10),
        anchor: m[2],
      };
      items.push(last);
    }
  }
  return { lines, items };
}
function rebuildHangeulBackup(originalBody, newItems) {
  // newItems: [{ num, anchor, bodyText }]. headingLine 유지 (frontmatter는 외부 처리).
  // leading blank line (frontmatter 다음) 유지.
  const origLines = originalBody.split("\n");
  let headingLine = "";
  for (const ln of origLines) {
    if (/^#\s/.test(ln)) {
      headingLine = ln;
      break;
    }
  }
  const out = [""];
  if (headingLine) {
    out.push(headingLine);
    out.push("");
  }
  for (const it of newItems) {
    out.push(`## ${it.num}절 ^${it.anchor}`);
    out.push("");
    if (it.bodyText) {
      out.push(it.bodyText);
      out.push("");
    }
  }
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

/** anchor를 가진 sentence의 인덱스를 sentences 배열에서 찾는다. */
function findSentenceIdx(sentences, anchor) {
  return sentences.findIndex((s) => s.anchor === anchor);
}

/** 같은 부모 sentence(컨테이너)에 속한 sub-anchor 목록 */
function getSubAnchors(sentences, parentAnchor) {
  const parent = getAnchorParts(parentAnchor);
  return sentences.filter((s) => {
    const p = getAnchorParts(s.anchor);
    if (p.kind !== parent.kind) return false;
    if (p.kind === "normal" && (p.vol !== parent.vol || p.chap !== parent.chap)) return false;
    if (p.sent !== parent.sent) return false;
    return p.subs.length > 0;
  });
}

// ─── 액션 핸들러 ─────────────────────────────────────────────────────────────

async function loadChapter({ vol, chap, isPreface }) {
  const hanjaPath = chapterHanjaPath({ vol, chap, isPreface });
  const hangeulPath = chapterHangeulPath({ vol, chap, isPreface });
  const hanjaRaw = await readText(hanjaPath);
  const { frontmatter: hanjaFm, body: hanjaBody } = splitFmAndBody(hanjaRaw);
  let hangeulRaw = null, hangeulFm = "", hangeulBody = "";
  if (hangeulPath) {
    try {
      hangeulRaw = await readText(hangeulPath);
      const split = splitFmAndBody(hangeulRaw);
      hangeulFm = split.frontmatter;
      hangeulBody = split.body;
    } catch {
      hangeulRaw = null;
    }
  }
  return { hanjaPath, hangeulPath, hanjaFm, hanjaBody, hangeulPath_exists: !!hangeulRaw, hangeulFm, hangeulBody };
}

async function writeChapter({ hanjaPath, hangeulPath, hanjaFm, hanjaBody, hangeulFm, hangeulBody, hangeulPath_exists }) {
  await backup(hanjaPath);
  await writeText(hanjaPath, `${hanjaFm}\n${hanjaBody}`);
  const changed = [hanjaPath];
  if (hangeulPath && hangeulPath_exists) {
    await backup(hangeulPath);
    await writeText(hangeulPath, `${hangeulFm}\n${hangeulBody}`);
    changed.push(hangeulPath);
  }
  return changed;
}

function isPrefaceTarget({ vol, chap }) {
  return vol === 0 || vol === undefined || vol === null;
}

/** A. merge-with-prev: 현재 anchor sentence를 직전 anchor sentence와 합치고 현재 제거. */
async function handleMergeWithPrev(body) {
  const { vol, chap, anchor } = body;
  if (!anchor) throw new Error("anchor required");
  const isPreface = anchor.startsWith("preface-");
  const ctx = await loadChapter({ vol, chap, isPreface });

  const { sentences } = parseHanjaSentences(ctx.hanjaBody);
  const idx = findSentenceIdx(sentences, anchor);
  if (idx < 0) throw new Error(`anchor not found in hanja chapter: ${anchor}`);
  if (idx === 0) throw new Error("cannot merge first sentence with prev");
  const prev = sentences[idx - 1];
  const cur = sentences[idx];

  // hanja: prev.text += " " + cur.text; remove cur
  const merged = `${prev.text} ${cur.text}`.replace(/\s+/g, " ").trim();
  const newSentences = sentences.slice();
  newSentences[idx - 1] = { ...prev, text: merged };
  newSentences.splice(idx, 1);
  const newHanjaBody = rebuildHanjaMarkdown(ctx.hanjaBody, newSentences);

  // mapping JSON: prev.hangeul += " " + cur.hangeul; delete cur key
  const mapping = await loadMapping();
  const prevM = mapping.verses[prev.anchor];
  const curM = mapping.verses[cur.anchor];
  if (prevM || curM) {
    const prevH = prevM?.hangeul ?? "";
    const curH = curM?.hangeul ?? "";
    const mergedH = `${prevH} ${curH}`.replace(/\s+/g, " ").trim();
    mapping.verses[prev.anchor] = {
      hangeul: mergedH,
      reviewed: !!(prevM?.reviewed && curM?.reviewed),
    };
    delete mapping.verses[cur.anchor];
  }

  // 한글본 백업: prev 본문에 cur 본문 합치고 cur 헤딩 제거 + N 시프트 (cur 이후 N -1)
  let newHangeulBody = ctx.hangeulBody;
  if (ctx.hangeulPath_exists) {
    const parsed = parseHangeulBackup(ctx.hangeulBody);
    const itemsByAnchor = new Map(parsed.items.map((it) => [it.anchor, it]));
    const prevItem = itemsByAnchor.get(prev.anchor);
    const curItem = itemsByAnchor.get(cur.anchor);
    if (prevItem && curItem) {
      const prevBody = parsed.lines.slice(prevItem.bodyStart, curItem.headingIdx).join("\n").trim();
      const curBody = parsed.lines
        .slice(curItem.bodyStart, curItem.bodyEnd + 1)
        .join("\n")
        .trim();
      const newItems = parsed.items
        .filter((it) => it.anchor !== cur.anchor)
        .map((it) => {
          if (it.anchor === prev.anchor) {
            return { num: it.num, anchor: it.anchor, bodyText: `${prevBody}\n\n${curBody}`.trim() };
          }
          // cur 이후의 절은 num -1
          const bodyText = parsed.lines.slice(it.bodyStart, it.bodyEnd + 1).join("\n").trim();
          const shiftedNum = it.num > curItem.num ? it.num - 1 : it.num;
          return { num: shiftedNum, anchor: it.anchor, bodyText };
        });
      newHangeulBody = rebuildHangeulBackup(ctx.hangeulBody, newItems);
    }
  }

  await persistMapping(mapping);
  const changed = await writeChapter({ ...ctx, hanjaBody: newHanjaBody, hangeulBody: newHangeulBody });
  changed.push(MAPPING_PATH);
  return { ok: true, action: "merge-with-prev", merged_into: prev.anchor, removed: cur.anchor, changed };
}

/** B. drop: 현재 anchor sentence 제거 + 같은 장 내 이후 anchor sent 인덱스 -1 시프트. */
async function handleDrop(body) {
  const { vol, chap, anchor } = body;
  if (!anchor) throw new Error("anchor required");
  const isPreface = anchor.startsWith("preface-");
  const ctx = await loadChapter({ vol, chap, isPreface });

  const { sentences } = parseHanjaSentences(ctx.hanjaBody);
  const idx = findSentenceIdx(sentences, anchor);
  if (idx < 0) throw new Error(`anchor not found in hanja chapter: ${anchor}`);
  const target = sentences[idx];
  const targetParts = getAnchorParts(target.anchor);
  if (targetParts.subs.length > 0) {
    throw new Error("sub-anchor (X-Y-Z.N) drop은 미지원 — 컨테이너 anchor만 drop 가능");
  }

  // sentences 시프트
  const newSentences = sentences
    .filter((s, i) => i !== idx)
    .map((s) => {
      if (sameChapterAndAfter(s.anchor, target.anchor)) {
        return { ...s, anchor: shiftAnchorSentBy(s.anchor, -1) };
      }
      return s;
    });
  const newHanjaBody = rebuildHanjaMarkdown(ctx.hanjaBody, newSentences);

  // mapping JSON: 키 시프트
  const mapping = await loadMapping();
  const shiftedVerses = {};
  for (const [k, v] of Object.entries(mapping.verses)) {
    if (k === target.anchor) continue; // drop
    if (sameChapterAndAfter(k, target.anchor)) {
      shiftedVerses[shiftAnchorSentBy(k, -1)] = v;
    } else {
      shiftedVerses[k] = v;
    }
  }
  mapping.verses = shiftedVerses;

  // 한글본 백업: 동일 시프트
  let newHangeulBody = ctx.hangeulBody;
  if (ctx.hangeulPath_exists) {
    const parsed = parseHangeulBackup(ctx.hangeulBody);
    const newItems = parsed.items
      .filter((it) => it.anchor !== target.anchor)
      .map((it) => {
        const bodyText = parsed.lines.slice(it.bodyStart, it.bodyEnd + 1).join("\n").trim();
        let newAnchor = it.anchor;
        let newNum = it.num;
        if (sameChapterAndAfter(it.anchor, target.anchor)) {
          newAnchor = shiftAnchorSentBy(it.anchor, -1);
          newNum = it.num - 1;
        }
        return { num: newNum, anchor: newAnchor, bodyText };
      });
    newHangeulBody = rebuildHangeulBackup(ctx.hangeulBody, newItems);
  }

  await persistMapping(mapping);
  const changed = await writeChapter({ ...ctx, hanjaBody: newHanjaBody, hangeulBody: newHangeulBody });
  changed.push(MAPPING_PATH);
  return { ok: true, action: "drop", removed: target.anchor, changed };
}

/** C. split-into-sub: 현재 anchor sentence를 컨테이너 + sub로 분리. */
async function handleSplitIntoSub(body) {
  const { vol, chap, anchor, container_text, sub_texts, are_verses } = body;
  if (!anchor) throw new Error("anchor required");
  if (!container_text || typeof container_text !== "string") {
    throw new Error("container_text (string) required");
  }
  if (!Array.isArray(sub_texts) || sub_texts.length === 0) {
    throw new Error("sub_texts (non-empty array) required");
  }
  const verses = Array.isArray(are_verses) ? are_verses : sub_texts.map(() => false);
  const isPreface = anchor.startsWith("preface-");
  const ctx = await loadChapter({ vol, chap, isPreface });

  const { sentences } = parseHanjaSentences(ctx.hanjaBody);
  const idx = findSentenceIdx(sentences, anchor);
  if (idx < 0) throw new Error(`anchor not found: ${anchor}`);
  const targetParts = getAnchorParts(anchor);
  if (targetParts.subs.length > 0) {
    throw new Error("이미 sub-anchor임 — split 미지원");
  }

  // 기존 sentence를 컨테이너(같은 anchor)로 텍스트 교체 + 그 뒤에 sub 삽입
  const containerSentence = { ...sentences[idx], text: container_text.trim(), isVerse: false };
  const subSentences = sub_texts.map((t, i) => ({
    start: -1,
    end: -1,
    anchor: `${anchor}.${i + 1}`,
    text: t.trim(),
    isVerse: !!verses[i],
  }));
  const newSentences = [
    ...sentences.slice(0, idx),
    containerSentence,
    ...subSentences,
    ...sentences.slice(idx + 1),
  ];
  const newHanjaBody = rebuildHanjaMarkdown(ctx.hanjaBody, newSentences);

  // mapping JSON: 컨테이너 hangeul은 그대로 (혹은 빈) + sub-anchor 빈 entry 추가
  const mapping = await loadMapping();
  for (const sub of subSentences) {
    if (!mapping.verses[sub.anchor]) {
      mapping.verses[sub.anchor] = { hangeul: "", reviewed: false };
    }
  }

  // 한글본 백업: 컨테이너 + sub 절을 같은 헤딩 묶음으로 분리. 같은 num + sub 헤딩 안 만들고
  // 단순히 컨테이너 헤딩 1개 + sub 헤딩 N개로 (## N절 ^A.1, ## N절 ^A.2 같은 형태로 N 재사용)
  let newHangeulBody = ctx.hangeulBody;
  if (ctx.hangeulPath_exists) {
    const parsed = parseHangeulBackup(ctx.hangeulBody);
    const targetItem = parsed.items.find((it) => it.anchor === anchor);
    if (targetItem) {
      const idxItem = parsed.items.indexOf(targetItem);
      const before = parsed.items.slice(0, idxItem);
      const after = parsed.items.slice(idxItem + 1);
      const newItems = [
        ...before.map((it) => ({
          num: it.num,
          anchor: it.anchor,
          bodyText: parsed.lines.slice(it.bodyStart, it.bodyEnd + 1).join("\n").trim(),
        })),
        { num: targetItem.num, anchor, bodyText: "" }, // container 본문 비움 (mapping JSON 본 hangeul 보존)
        ...subSentences.map((sub) => ({ num: targetItem.num, anchor: sub.anchor, bodyText: "" })),
        ...after.map((it) => ({
          num: it.num,
          anchor: it.anchor,
          bodyText: parsed.lines.slice(it.bodyStart, it.bodyEnd + 1).join("\n").trim(),
        })),
      ];
      newHangeulBody = rebuildHangeulBackup(ctx.hangeulBody, newItems);
    }
  }

  await persistMapping(mapping);
  const changed = await writeChapter({ ...ctx, hanjaBody: newHanjaBody, hangeulBody: newHangeulBody });
  changed.push(MAPPING_PATH);
  return {
    ok: true,
    action: "split-into-sub",
    container: anchor,
    subs: subSentences.map((s) => s.anchor),
    changed,
  };
}

/** D. toggle-verse: 현재 anchor sentence 앞에 `> ` toggle. */
async function handleToggleVerse(body) {
  const { vol, chap, anchor } = body;
  if (!anchor) throw new Error("anchor required");
  const isPreface = anchor.startsWith("preface-");
  const ctx = await loadChapter({ vol, chap, isPreface });

  const { sentences } = parseHanjaSentences(ctx.hanjaBody);
  const idx = findSentenceIdx(sentences, anchor);
  if (idx < 0) throw new Error(`anchor not found: ${anchor}`);
  const newSentences = sentences.slice();
  newSentences[idx] = { ...newSentences[idx], isVerse: !newSentences[idx].isVerse };
  const newHanjaBody = rebuildHanjaMarkdown(ctx.hanjaBody, newSentences);

  // mapping JSON·한글본은 변경 X
  const changed = await writeChapter({ ...ctx, hanjaBody: newHanjaBody, hangeulBody: ctx.hangeulBody });
  return { ok: true, action: "toggle-verse", anchor, isVerse: newSentences[idx].isVerse, changed };
}

// ─── Vite plugin ────────────────────────────────────────────────────────────

/** @returns {import('vite').Plugin} */
export default function canonicalMappingDev() {
  let viteServer = null;
  function triggerReload(changedPaths = []) {
    if (!viteServer) return;
    try {
      // 1) Notify Vite's file watcher about each changed path so any module
      //    that depends on the file (e.g., Astro content collection loader)
      //    invalidates its cache.
      for (const p of changedPaths) {
        try {
          viteServer.watcher.emit("change", p);
        } catch {
          // best-effort
        }
      }
      // 2) Tell connected browsers to do a full page reload — picks up content
      //    collection changes that Astro might otherwise serve from cache.
      viteServer.ws.send({ type: "full-reload", path: "*" });
    } catch {
      // ignore
    }
  }
  return {
    name: "jsbooks-canonical-mapping-dev",
    apply: "serve",
    configureServer(server) {
      viteServer = server;
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        if (req.method !== "POST") return next();
        const isMappingSaveSentence = req.url.startsWith("/api/admin/canonical-mapping/save-sentence");
        // 주의: save-sentence가 save로 시작하므로 먼저 체크. isMappingSave는 그 외 v1 /save만 잡도록.
        const isMappingSave = !isMappingSaveSentence && req.url.startsWith("/api/admin/canonical-mapping/save");
        const isMappingBulk = req.url.startsWith("/api/admin/canonical-mapping/bulk");
        const isChapterSave = req.url.startsWith("/api/admin/scripture-editor/save-chapter");
        const isChangelogSave = req.url.startsWith("/api/admin/changelog/save");
        const isSentenceMerge = req.url.startsWith("/api/admin/sentence/merge-with-prev");
        const isSentenceDrop = req.url.startsWith("/api/admin/sentence/drop");
        const isSentenceSplit = req.url.startsWith("/api/admin/sentence/split-into-sub");
        const isSentenceToggleVerse = req.url.startsWith("/api/admin/sentence/toggle-verse");
        if (
          !isMappingSave &&
          !isMappingSaveSentence &&
          !isMappingBulk &&
          !isChapterSave &&
          !isChangelogSave &&
          !isSentenceMerge &&
          !isSentenceDrop &&
          !isSentenceSplit &&
          !isSentenceToggleVerse
        ) {
          return next();
        }
        try {
          const body = await readBody(req);
          if (isSentenceMerge) {
            const out = await handleMergeWithPrev(body);
            console.log(`[admin] merge-with-prev`, body, "→", out);
            triggerReload(out.changed ?? []);
            return json(res, 200, out);
          }
          if (isSentenceDrop) {
            const out = await handleDrop(body);
            console.log(`[admin] drop`, body, "→", out);
            triggerReload(out.changed ?? []);
            return json(res, 200, out);
          }
          if (isSentenceSplit) {
            const out = await handleSplitIntoSub(body);
            console.log(`[admin] split-into-sub`, body, "→", out);
            triggerReload(out.changed ?? []);
            return json(res, 200, out);
          }
          if (isSentenceToggleVerse) {
            const out = await handleToggleVerse(body);
            console.log(`[admin] toggle-verse`, body, "→", out);
            triggerReload(out.changed ?? []);
            return json(res, 200, out);
          }
          if (isMappingSaveSentence) {
            const mapping = await loadMapping();
            applySentenceMapping(mapping, body);
            await persistMapping(mapping);
            triggerReload([MAPPING_PATH]);
            return json(res, 200, {
              ok: true,
              count: Object.keys(mapping.verses).length,
            });
          }
          if (isMappingSave) {
            const mapping = await loadMapping();
            applyMappingEntry(mapping, body);
            await persistMapping(mapping);
            triggerReload([MAPPING_PATH]);
            return json(res, 200, { ok: true, count: Object.keys(mapping.verses).length });
          }
          if (isMappingBulk) {
            const entries = Array.isArray(body?.entries) ? body.entries : [];
            const mapping = await loadMapping();
            for (const e of entries) applyMappingEntry(mapping, e);
            await persistMapping(mapping);
            triggerReload([MAPPING_PATH]);
            return json(res, 200, { ok: true, count: Object.keys(mapping.verses).length });
          }
          if (isChapterSave) {
            const out = await saveChapterHandler(body);
            // Markdown was rewritten — invalidate Astro content collection cache.
            const changed = [entryIdToPath(body.hanja.entryId)];
            if (body.hangeul?.entryId) {
              changed.push(entryIdToPath(body.hangeul.entryId));
            }
            triggerReload(changed);
            return json(res, 200, out);
          }
          if (isChangelogSave) {
            // body: { hash, visible?: boolean, message?: string|null, clear?: boolean }
            const hash = String(body?.hash ?? "").trim();
            if (!hash) return json(res, 400, { error: "hash required" });
            let store;
            try {
              store = await readJson(CHANGELOG_DISPLAY_PATH);
            } catch {
              store = { overrides: {} };
            }
            if (!store.overrides) store.overrides = {};
            if (body.clear) {
              delete store.overrides[hash];
            } else {
              const ovr = store.overrides[hash] ?? {};
              if (typeof body.visible === "boolean") ovr.visible = body.visible;
              if (typeof body.message === "string") {
                const trimmed = body.message.trim();
                if (trimmed) ovr.message = trimmed;
                else delete ovr.message;
              } else if (body.message === null) {
                delete ovr.message;
              }
              if (
                ovr.visible === undefined &&
                (ovr.message === undefined || ovr.message === "")
              ) {
                delete store.overrides[hash];
              } else {
                store.overrides[hash] = ovr;
              }
            }
            await writeJson(CHANGELOG_DISPLAY_PATH, store);
            triggerReload([CHANGELOG_DISPLAY_PATH]);
            return json(res, 200, { ok: true, overrides: store.overrides });
          }
        } catch (err) {
          return json(res, 500, { error: String(err?.message ?? err) });
        }
      });
    },
  };
}
