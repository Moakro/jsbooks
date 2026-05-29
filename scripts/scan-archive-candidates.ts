#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * 세 경전 본문에서 archive (content/people, content/places) 에 **미등록인**
 * 인물·장소 후보를 자동 추출 → `content/_data/archive-candidate-queue.md` 로 출력.
 *
 * 추출 룰 (고정밀 우선):
 *   1) 장소(한자): `<한자 1-3>` + 장소 접미어 [山寺浦坪津]
 *   2) 장소(한글): `<한글 1-3>` + (산|포)  ← 사/평/진 은 일반어 충돌 ✗
 *   3) 인물(한글): `<한글 2-4>` + 호칭 (님|선생|선사|대선생|대선사)
 *   4) 인물(paired): `<한자 2-3>(<한글 2-3>)` 직후 (이|난) + 한자 verb (曰|問曰|告曰|對曰)
 *      — 천지개벽경 화자 패턴
 *
 * 각 후보:
 *   - 같은 line 안의 paired form `<한자>(<한글>)` 발견 시 hanja/hangeul 보강
 *   - count ≥ MIN_COUNT (기본 2), 기존 archive 토큰과 일치하면 제외
 *
 * 사용:
 *   node scripts/scan-archive-candidates.ts
 *   node scripts/scan-archive-candidates.ts --min-count=1
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
// vault root override(.env VAULT_PATH)를 plugin(load/apply)과 동일하게 존중 —
// scan 과 load/apply 가 서로 다른 vault 를 보던 불일치 차단.
const CONTENT = process.env.VAULT_PATH || join(ROOT, "content");
const SCRIPTURE_DIR = join(CONTENT, "scripture");
const OUT_FILE = join(CONTENT, "_data", "archive-candidate-queue.md");

const args = process.argv.slice(2);
const minCountArg = args.find((a) => a.startsWith("--min-count="));
const MIN_COUNT = minCountArg ? parseInt(minCountArg.slice("--min-count=".length), 10) : 2;

type Kind = "people" | "places";

const HANJA = "\\u4E00-\\u9FFF\\u3400-\\u4DBF";
const HANGEUL = "가-힯";

// ─── 룰 상수 ──────────────────────────────────────────────────────────────

const PLACE_HANJA_SUFFIXES = "山寺浦坪津";
const PLACE_HANGEUL_SUFFIXES = ["산", "포"]; // 사·평·진 일반어 충돌
const PERSON_TITLES = ["대선생", "대선사", "선생", "선사", "님"]; // 긴 것 우선

// 장소 false positive — 한자/한글 일반어
const PLACE_STOPWORDS = new Set([
  // 한자 일반어 (산수·풍경 일반명사, 장소 고유명 ✗)
  "泰山", "靑山", "羣山", "群山", "高山", "深山", "靈山", "聖山", "名山",
  "山山", "山", "古寺", "古浦", "海浦",
  "江山", "山河", "山川", "剛山", "天下之山", "指其山", "四國江山", "前山", "後山",
  "山寺", "本山", "他山", "此山", "何山", "其山", "曳曳山", "厥寺",
  // 한글 일반어 (산·포 접미어 일반명사)
  "산", "선산", "산림", "산악", "산맥", "산하", "산천", "산골", "산자락",
  "강산", "뒷산", "앞산", "포", "포구", "포함", "포함된",
  "동포", "우리동포", "이남포", "외남포",
]);

// 한자 장소 토큰 앞에 붙는 고전 처격·동작 접두 (在 = 에서, 入 = 들어가). 매치 후 제거.
const LOCATIVE_PREFIXES = new Set(["在", "入", "往", "過", "到", "自", "於", "向", "至", "抵"]);

function stripLocativePrefix(hanja: string): string {
  let s = hanja;
  while (s.length >= 3 && LOCATIVE_PREFIXES.has(s[0])) s = s.slice(1);
  return s;
}

// 인물 false positive — 한글 일반어 (base 가 호칭·일반어 ✗)
const PERSON_HANGEUL_STOPWORDS = new Set([
  "선생", "선사", "스승", "어른", "조상", "부모", "어머니", "아버지",
  "부친", "모친", "형제", "친구", "동지", "친지",
  "상제", "대선생", "대선사", "선생님", "선사님",
  "신명", "신선", "성인", "군자", "선현", "성현",
  "성부", "성모", "성령", "혈식", "그분", "당신",
  "이분", "저분", "유사", "유사이",
  // 일반 호칭·역할어 (고유 인물 ✗)
  "제자", "弟子", "이인", "二人", "일인", "一人", "천사", "증산천사",
  "부처", "대성부", "성부님", "성모님", "우리동포", "동포", "우리형제",
  // 호칭 `님` 절단으로 생긴 미완 토큰 (어머님→어머 등)
  "어머", "아버", "하느", "하늘", "할머", "할아",
]);

// ─── frontmatter / manifest ─────────────────────────────────────────────────

function parseFrontmatter(raw: string): { fm: Record<string, unknown>; bodyOffset: number } {
  if (!raw.startsWith("---\n")) return { fm: {}, bodyOffset: 0 };
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return { fm: {}, bodyOffset: 0 };
  const block = raw.slice(4, end);
  const after = raw.indexOf("\n", end + 4);
  const bodyOffset = after < 0 ? raw.length : after + 1;
  const fm: Record<string, unknown> = {};
  let currentArray: string[] | null = null;
  for (const line of block.split("\n")) {
    const itemMatch = line.match(/^\s+-\s+(.+)$/);
    if (itemMatch && currentArray) {
      currentArray.push(itemMatch[1].trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    const kvMatch = line.match(/^([\w가-힣_]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === "") {
        const arr: string[] = [];
        fm[key] = arr;
        currentArray = arr;
      } else {
        fm[key] = value.replace(/^["']|["']$/g, "");
        currentArray = null;
      }
    }
  }
  return { fm, bodyOffset };
}

/** 기존 archive 등록 토큰 — name·name_hanja·aliases·slug 전부. */
function buildExclusionSet(): Set<string> {
  const exclude = new Set<string>();
  for (const kind of ["people", "places"] as const) {
    const dir = join(CONTENT, kind);
    let files: string[];
    try {
      files = readdirSync(dir).filter((n) => n.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of files) {
      const slug = f.replace(/\.md$/, "");
      exclude.add(slug);
      const raw = readFileSync(join(dir, f), "utf8");
      const { fm } = parseFrontmatter(raw);
      for (const k of ["name", "name_hanja"] as const) {
        const v = fm[k];
        if (typeof v === "string" && v) exclude.add(v);
      }
      const aliases = Array.isArray(fm.aliases) ? (fm.aliases as string[]) : [];
      for (const a of aliases) exclude.add(a);
    }
  }
  return exclude;
}

// ─── file walk ─────────────────────────────────────────────────────────────

function walkMarkdown(dir: string, out: string[]) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) walkMarkdown(p, out);
    else if (n.endsWith(".md")) out.push(p);
  }
}

function findScriptureFiles(): string[] {
  const out: string[] = [];
  for (const slug of readdirSync(SCRIPTURE_DIR)) {
    if (slug.startsWith("_")) continue;
    if (slug === "cheonjigaebyeokgyeong-hangeul") continue; // admin 백업
    const dir = join(SCRIPTURE_DIR, slug);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    walkMarkdown(dir, out);
  }
  return out;
}

// ─── 보조: gloss map / wikilink mask ────────────────────────────────────────

const PAIRED_RE = new RegExp(`([${HANJA}]{1,4})\\(([${HANGEUL}]{1,6})\\)`, "g");

function buildGlossMap(line: string): {
  hanjaToHangeul: Map<string, string>;
  hangeulToHanja: Map<string, string>;
} {
  const h2k = new Map<string, string>();
  const k2h = new Map<string, string>();
  PAIRED_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAIRED_RE.exec(line))) {
    if (!h2k.has(m[1])) h2k.set(m[1], m[2]);
    if (!k2h.has(m[2])) k2h.set(m[2], m[1]);
  }
  return { hanjaToHangeul: h2k, hangeulToHanja: k2h };
}

// 한자 음독 병기 `한자(한글)` 의 `(한글)` 내부 — 한글 룰(장소 한글/인물 호칭)에서
// 마스킹. 4자 한자어구의 음독("유아대선생"·"구대선생지언")이 호칭·접미어 룰에 잡혀
// 가짜 토큰(유아대·구대·비대…)을 만들던 문제 차단. 길이 제한 없는 넓은 매치.
const GLOSS_MASK_RE = new RegExp(`[${HANJA}]+\\(([${HANGEUL}]+)\\)`, "g");

// 전 경전 음독 병기에서 모은 한자↔한글 매핑 (cross-line dedup 용).
// 어떤 줄은 `益山`(한자만), 다른 줄은 `익산`(한글) 또는 `益山(익산)` 으로 나타남 →
// 전역 맵으로 한자 후보를 한글 primary 로 정규화해 益山/익산 중복을 1건으로 합침.
const globalH2K = new Map<string, string>();
const globalK2H = new Map<string, string>();

function buildGlobalGlossMap(files: string[]) {
  const re = new RegExp(`([${HANJA}]{1,4})\\(([${HANGEUL}]{1,6})\\)`, "g");
  for (const filePath of files) {
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      if (!globalH2K.has(m[1])) globalH2K.set(m[1], m[2]);
      if (!globalK2H.has(m[2])) globalK2H.set(m[2], m[1]);
    }
  }
}

function maskedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /\[\[[^\]]*\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ranges.push([m.index, m.index + m[0].length]);
  // 음독 괄호 내부(한글 부분)도 마스킹. m.index 는 한자 시작 → 괄호 시작은
  // m[0].length - (한글길이 + 2) 위치부터. 한자 시작 자체는 마스킹 안 함(인물
  // paired-speaker 룰이 한자 위치에서 동작하므로 영향 없음).
  GLOSS_MASK_RE.lastIndex = 0;
  while ((m = GLOSS_MASK_RE.exec(text))) {
    const parenStart = m.index + (m[0].length - (m[1].length + 2));
    ranges.push([parenStart, m.index + m[0].length]);
  }
  return ranges;
}

function inRange(pos: number, ranges: Array<[number, number]>): boolean {
  for (const [s, e] of ranges) if (pos >= s && pos < e) return true;
  return false;
}

// ─── extraction ────────────────────────────────────────────────────────────

interface FoundCandidate {
  kind: Kind;
  primary: string;
  hanja?: string;
  hangeul?: string;
}

interface Sample {
  file: string;
  line: number;
  context: string;
}

interface Aggregated extends FoundCandidate {
  count: number;
  samples: Sample[];
  suggestedSlug: string;
}

// 한자 장소: 접미어(山寺浦坪津) + 앞에 한자 없음(연속 한자열의 선두에서만 매치).
// lookbehind 로 `金剛山`·`金山寺` 같은 복합어를 통째로 잡고, 그 부분열(剛山·山寺)이
// 별도 후보로 새는 것을 막음.
const HANJA_PLACE_RE = new RegExp(
  `(?<![${HANJA}])([${HANJA}]{1,3}[${PLACE_HANJA_SUFFIXES}])`,
  "g",
);
const HANGEUL_PLACE_RE = new RegExp(
  `(?<![${HANGEUL}])([${HANGEUL}]{1,3}(?:${PLACE_HANGEUL_SUFFIXES.join("|")}))(?![${HANGEUL}])`,
  "g",
);
const PERSON_TITLE_RE = new RegExp(
  `(?<![${HANGEUL}])([${HANGEUL}]{2,4})(${PERSON_TITLES.join("|")})`,
  "g",
);
const PERSON_PAIRED_SPEAKER_RE = new RegExp(
  `([${HANJA}]{2,3})\\(([${HANGEUL}]{2,3})\\)(?:이|난|난\\s)\\s*(?:曰|問曰|告曰|對曰)`,
  "g",
);

function extractFromLine(
  line: string,
  exclude: Set<string>,
): FoundCandidate[] {
  const found: FoundCandidate[] = [];
  const masks = maskedRanges(line);
  const { hanjaToHangeul, hangeulToHanja } = buildGlossMap(line);

  // (1) 장소 한자+접미어
  HANJA_PLACE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HANJA_PLACE_RE.exec(line))) {
    if (inRange(m.index, masks)) continue;
    const hanja = stripLocativePrefix(m[1]);
    if (exclude.has(hanja)) continue;
    if (PLACE_STOPWORDS.has(hanja)) continue;
    const hangeul = hanjaToHangeul.get(hanja) ?? globalH2K.get(hanja);
    if (hangeul && exclude.has(hangeul)) continue;
    if (hangeul && PLACE_STOPWORDS.has(hangeul)) continue;
    found.push({ kind: "places", primary: hangeul ?? hanja, hanja, hangeul });
  }

  // (2) 장소 한글+접미어
  HANGEUL_PLACE_RE.lastIndex = 0;
  while ((m = HANGEUL_PLACE_RE.exec(line))) {
    if (inRange(m.index, masks)) continue;
    const hangeul = m[1];
    if (exclude.has(hangeul)) continue;
    if (PLACE_STOPWORDS.has(hangeul)) continue;
    const hanja = hangeulToHanja.get(hangeul) ?? globalK2H.get(hangeul);
    if (hanja && exclude.has(hanja)) continue;
    found.push({ kind: "places", primary: hangeul, hanja, hangeul });
  }

  // (3) 인물 한글+호칭
  PERSON_TITLE_RE.lastIndex = 0;
  while ((m = PERSON_TITLE_RE.exec(line))) {
    if (inRange(m.index, masks)) continue;
    const base = m[1];
    if (exclude.has(base)) continue;
    if (PERSON_HANGEUL_STOPWORDS.has(base)) continue;
    const hanja = hangeulToHanja.get(base) ?? globalK2H.get(base);
    if (hanja && exclude.has(hanja)) continue;
    found.push({ kind: "people", primary: base, hangeul: base, hanja });
  }

  // (4) 인물 paired-speaker
  PERSON_PAIRED_SPEAKER_RE.lastIndex = 0;
  while ((m = PERSON_PAIRED_SPEAKER_RE.exec(line))) {
    if (inRange(m.index, masks)) continue;
    const hanja = m[1];
    const hangeul = m[2];
    if (exclude.has(hanja) || exclude.has(hangeul)) continue;
    if (PERSON_HANGEUL_STOPWORDS.has(hangeul)) continue;
    found.push({ kind: "people", primary: hangeul, hanja, hangeul });
  }

  return found;
}

// ─── main ──────────────────────────────────────────────────────────────────

const exclude = buildExclusionSet();
console.log(`Exclusion set: ${exclude.size} tokens (existing archive)`);

const files = findScriptureFiles();
console.log(`Scanning ${files.length} scripture files...`);

buildGlobalGlossMap(files);
console.log(`Global gloss map: ${globalH2K.size} hanja→hangeul pairs.`);

const agg = new Map<string, Aggregated>();

for (const filePath of files) {
  const raw = readFileSync(filePath, "utf8");
  const { bodyOffset } = parseFrontmatter(raw);
  const body = raw.slice(bodyOffset);
  const fmLines = raw.slice(0, bodyOffset).split("\n").length - 1;
  const lines = body.split("\n");
  const relFile = relative(ROOT, filePath);

  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    if (/^(#{1,6}\s|>\s|\s*```)/.test(line)) return;
    const cands = extractFromLine(line, exclude);
    for (const c of cands) {
      const key = `${c.kind}:${c.primary}`;
      let a = agg.get(key);
      if (!a) {
        a = { ...c, count: 0, samples: [], suggestedSlug: c.hangeul ?? c.hanja ?? c.primary };
        agg.set(key, a);
      }
      if (!a.hanja && c.hanja) a.hanja = c.hanja;
      if (!a.hangeul && c.hangeul) {
        a.hangeul = c.hangeul;
        a.suggestedSlug = c.hangeul;
      }
      a.count += 1;
      if (a.samples.length < 3) {
        const ctx = line.trim().length > 140 ? line.trim().slice(0, 140) + "…" : line.trim();
        a.samples.push({ file: relFile, line: fmLines + idx + 1, context: ctx });
      }
    }
  });
}

console.log(`Aggregated ${agg.size} unique candidates (pre-filter).`);

const candidates = Array.from(agg.values()).filter((c) => c.count >= MIN_COUNT);
console.log(`After min-count=${MIN_COUNT} filter: ${candidates.length} candidates.`);

const byKind = { people: [] as Aggregated[], places: [] as Aggregated[] };
for (const c of candidates) byKind[c.kind].push(c);
for (const k of ["people", "places"] as const) {
  byKind[k].sort((a, b) => b.count - a.count || a.primary.localeCompare(b.primary));
}

let md = "# Archive Candidate Queue\n\n";
md += "세 경전(천지개벽경·동곡비서·화은당실기) 본문에서 자동 추출된 archive(인물·장소) 후보. 기존 `content/people/` · `content/places/` 에 미등록인 것만 적재.\n\n";
md += "## 사용법\n\n";
md += "- 추가할 후보: 체크박스 `- [x]` 로 표시\n";
md += "- false positive: `- [ ]` 유지하거나 스캐너 STOPWORDS 갱신 후 재실행\n";
md += "- admin UI(`/admin/archive-candidates/`) 에서 체크·적용 가능\n";
md += "- 적용 시 `content/{kind}/<slug>.md` 가 minimal frontmatter 로 자동 생성됨\n\n";
md += "## 통계\n\n";
md += `- 생성: ${new Date().toISOString()}\n`;
md += `- 스캔 파일: ${files.length}\n`;
md += `- 제외 토큰(기존 archive): ${exclude.size}\n`;
md += `- min-count 임계: ${MIN_COUNT}\n`;
md += `- 후보 총: ${candidates.length} 건 (인물 ${byKind.people.length} · 장소 ${byKind.places.length})\n`;
md += "\n---\n\n";

for (const kind of ["people", "places"] as const) {
  md += `## ${kind}\n\n`;
  if (byKind[kind].length === 0) {
    md += "*(없음)*\n\n";
    continue;
  }
  for (const c of byKind[kind]) {
    const label = c.hanja && c.hangeul ? `${c.hangeul} (${c.hanja})` : c.primary;
    md += `- [ ] **${label}** (${c.count}건) — slug: \`${c.suggestedSlug}\`\n`;
    for (const s of c.samples) {
      md += `  - \`${s.file}:L${s.line}\` — ${s.context}\n`;
    }
    md += "\n";
  }
}

writeFileSync(OUT_FILE, md);
console.log(`→ ${OUT_FILE}`);
