#!/usr/bin/env node
// 경전 markdown 절 단위 anchor → 문장 단위 anchor 마이그레이션
//
// 변환 규칙:
//   - "## N절 ^anchor" 헤딩의 anchor 제거 (헤딩은 절 그룹 표시로 유지)
//   - 절 본문 paragraph를 마침표/?/! 기준으로 문장 분리
//   - 각 문장에 ^<prefix>-N 일련번호 부착
//   - 일련번호는 기본 파일 단위. 슬러그가 sharedCounter 면 인접 파일과 연속.
//   - 텍스트 절대 수정 X (마침표 추가 X, 어법 수정 X), 분리만
//
// 지원 경전 (슬러그 기반 자동 분기):
//   cheonjigaebyeokgyeong — canonical 한자본, 권/장 계층, preface 별도, 파일별 카운터
//   donggokbiseo          — 단일 권·단일 장 평면(`1-1`), 본문+후기 카운터 공유
//   hwaeundang-silgi      — 단일 권(`1-${장}`), 장 frontmatter 만, 장별 카운터
//
// 사용법:
//   node scripts/migrate-sentence-anchors.mjs --dry-run --target=path
//   node scripts/migrate-sentence-anchors.mjs --target=content/scripture/donggokbiseo
//   node scripts/migrate-sentence-anchors.mjs --target=... --report=path/to/queue.md

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const VAULT = process.env.VAULT_PATH || path.resolve(__dirname, '../content');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const targetArg = args.find((a) => a.startsWith('--target='));
const reportArg = args.find((a) => a.startsWith('--report='));
const target = targetArg ? targetArg.replace('--target=', '') : null;
const reportPath = reportArg ? reportArg.replace('--report=', '') : null;

// 한글 음독 끝에 등장하는 진짜 종결 어미 후보 (검수 큐 추출용).
// `이오`/`이라`는 한문 병렬에서 연결로도 자주 쓰여 false positive가 많아 제외.
// 연결 어미(`하사`, `시고`, `시며`, `하며`, `하시고`)도 제외.
const ENDING_PATTERNS = [
  '하시니라', '이시니라', '시니라',
  '하니라', '이니라', '니라',
  '노라', '하라',
];

const sortedEndings = [...ENDING_PATTERNS].sort((a, b) => b.length - a.length);
const endingRegex = new RegExp(`\\)(${sortedEndings.join('|')})`, 'g');
// 문장 끝이 종결어미인지 검사 (마침표 없이 끝났는지 별도 체크)
const tailEndingRegex = new RegExp(`\\)(${sortedEndings.join('|')})\\s*$`);

// 한자 paragraph를 마침표/?/! 단위로 분리.
// 텍스트는 1바이트도 수정하지 않고 분할만.
function splitSentences(text) {
  const sentences = [];
  let buf = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    buf += ch;
    if (ch === '.' || ch === '?' || ch === '!') {
      const next = text[i + 1];
      // 다음 문자가 공백이거나 끝이면 문장 종료
      if (next === undefined || /\s/.test(next)) {
        sentences.push(buf.trim());
        buf = '';
        // 후속 공백 스킵
        while (i + 1 < text.length && /\s/.test(text[i + 1])) i++;
      }
    }
    i++;
  }
  const tail = buf.trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function detectEndings(sentence) {
  return [...sentence.matchAll(endingRegex)].map((m) => m[1]);
}

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const [, raw, body] = m;
  const fm = {};
  for (const line of raw.split('\n')) {
    const km = line.match(/^([^:]+):\s*(.*)$/);
    if (km) fm[km[1].trim()] = km[2].replace(/^["']|["']$/g, '').trim();
  }
  return { fm, raw, body };
}

// 슬러그별 마이그 정책. 새 경전 추가 시 이 객체에 항목 추가.
//
//   slug             — content/scripture/<slug>/ 디렉토리 이름
//   sharedCounter    — true 면 같은 슬러그의 파일들이 마이그 sentence 카운터를 공유
//                      (예: 동곡비서 본문→후기. 평면 anchor 네임스페이스가 파일 경계를 넘음.)
//   anchorPrefix(fm) — 한 파일의 anchor prefix. preface 분기는 fm 으로 판단.
//   shouldSkip(fm)   — true 면 그 파일 전체 skip (preface/appendix 본문 평면 그대로 유지)
const SCRIPTURE_CONFIGS = {
  cheonjigaebyeokgyeong: {
    requireCanonical: true,
    sharedCounter: false,
    anchorPrefix: (fm) =>
      fm.section === 'preface' ? 'preface' : `${fm['권']}-${fm['장']}`,
    shouldSkip: (fm) =>
      fm.section !== 'preface' && (!fm['권'] || !fm['장']),
  },
  donggokbiseo: {
    requireCanonical: false,
    sharedCounter: true,
    anchorPrefix: () => '1-1',
    // type: preface 인 00_서.md 는 본문 평면(anchor 없음) → 손대지 않음.
    // type: verses (본문) / type: afterword (후기) 만 카운터 공유로 처리.
    shouldSkip: (fm) => fm.type === 'preface',
  },
  'hwaeundang-silgi': {
    requireCanonical: false,
    sharedCounter: false,
    anchorPrefix: (fm) => `1-${fm['장']}`,
    // section: preface / appendix 는 anchor 없는 평면 → 손대지 않음.
    shouldSkip: (fm) =>
      fm.section === 'preface' || fm.section === 'appendix' || !fm['장'],
  },
};

function detectScripture(filePath) {
  const rel = path.relative(VAULT, filePath);
  const m = rel.match(/^scripture[\\/]([^\\/]+)[\\/]/);
  if (!m) return null;
  return m[1];
}

function processFile(filePath, sharedCounterRef) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseFrontmatter(content);
  if (!parsed) return { filePath, skipped: true, reason: 'no frontmatter' };

  const { fm, raw, body } = parsed;
  const slug = detectScripture(filePath);
  const config = slug ? SCRIPTURE_CONFIGS[slug] : null;

  if (!config) {
    // 미등록 슬러그 — 기존 canonical 게이트로 fallback
    if (fm.canonical !== 'true') {
      return { filePath, skipped: true, reason: 'no config + not canonical' };
    }
    return processCanonicalFallback(filePath, content, fm, raw, body);
  }

  if (config.requireCanonical && fm.canonical !== 'true') {
    return { filePath, skipped: true, reason: 'not canonical' };
  }
  if (config.shouldSkip(fm)) {
    return { filePath, skipped: true, reason: 'preface/appendix or missing hierarchy' };
  }

  const anchorPrefix = config.anchorPrefix(fm);
  if (!anchorPrefix) {
    return { filePath, skipped: true, reason: 'no anchor prefix derivable' };
  }

  const lines = body.split('\n');
  const out = [];
  const reviewQueue = [];
  // 카운터: sharedCounter 모드면 ref.value 누적. 아니면 파일별 0 리셋.
  const localCounter = { value: 0 };
  const counter = config.sharedCounter ? sharedCounterRef : localCounter;
  let totalSentences = 0;
  let i = 0;

  // 평면 모드 감지: body 전체에 `## N절` (anchor 유무 무관) heading 이 있는지.
  // 마이그 후엔 `## N절` 만 남고, 마이그 전엔 `## N절 ^anchor` 형태. 둘 다 매치.
  const hasGroupHeadings = /^##\s+\d+절(\s+\^[\w-]+)?\s*$/m.test(body);

  function flushParagraphs(paragraphs) {
    for (const para of paragraphs) {
      // 기존 anchor가 paragraph 끝에 있을 수 있으니 stripping 후 재분리
      const stripped = para.replace(/\s+\^[\w-]+\s*$/, '').trim();
      const sentences = splitSentences(stripped);
      for (const s of sentences) {
        counter.value++;
        totalSentences++;
        const anchor = `${anchorPrefix}-${counter.value}`;
        out.push(`${s} ^${anchor}`);
        out.push('');

        const endings = detectEndings(s);
        const endsWithoutPeriod = tailEndingRegex.test(s) && !/[.?!]\s*$/.test(s);
        const reasons = [];
        if (endsWithoutPeriod) reasons.push('end-no-period');
        if (endings.length >= 2) reasons.push(`multi-ending(${endings.length})`);
        if (reasons.length) {
          reviewQueue.push({
            file: filePath,
            anchor,
            sentence: s,
            endings,
            reasons,
          });
        }
      }
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // 평면 모드: # N장 heading 통과 직후 body 전체를 한 그룹처럼 처리.
    if (!hasGroupHeadings && /^#\s/.test(line)) {
      out.push(line);
      i++;
      out.push('');
      while (i < lines.length && lines[i].trim() === '') i++;

      const paragraphs = [];
      let buf = [];
      while (i < lines.length && !/^---\s*$/.test(lines[i])) {
        if (lines[i].trim() === '') {
          if (buf.length) {
            paragraphs.push(buf.join(' ').trim());
            buf = [];
          }
        } else {
          buf.push(lines[i]);
        }
        i++;
      }
      if (buf.length) paragraphs.push(buf.join(' ').trim());
      flushParagraphs(paragraphs);
      continue;
    }

    // ## N절 ^anchor 패턴 — anchor 제거하고 헤딩만 남김
    const headingMatch = line.match(/^(##\s+\d+절)\s*(\^[\w-]+)?\s*$/);
    if (headingMatch) {
      out.push(headingMatch[1]);
      i++;
      // 빈 줄 1줄 보장
      out.push('');
      while (i < lines.length && lines[i].trim() === '') i++;

      // paragraph 수집 (다음 ## 헤딩, # 헤딩, --- 구분선 전까지)
      const paragraphs = [];
      let buf = [];
      while (
        i < lines.length &&
        !/^##\s/.test(lines[i]) &&
        !/^#\s/.test(lines[i]) &&
        !/^---\s*$/.test(lines[i])
      ) {
        if (lines[i].trim() === '') {
          if (buf.length) {
            paragraphs.push(buf.join(' ').trim());
            buf = [];
          }
        } else {
          buf.push(lines[i]);
        }
        i++;
      }
      if (buf.length) paragraphs.push(buf.join(' ').trim());

      flushParagraphs(paragraphs);
      continue;
    }

    out.push(line);
    i++;
  }

  // trailing 빈 줄 정리
  while (out.length && out[out.length - 1] === '') out.pop();

  const newBody = `---\n${raw}\n---\n${out.join('\n')}\n`;

  return {
    filePath,
    original: content,
    transformed: newBody,
    sentenceCount: totalSentences,
    reviewQueue,
    changed: content !== newBody,
  };
}

// 슬러그 config 가 없을 때 (테스트 디렉토리 등): 기존 canonical 게이트 로직 그대로.
// 사실상 사용되지 않음 — 모든 등록 경전은 SCRIPTURE_CONFIGS 에 포함.
function processCanonicalFallback(filePath, content, fm, raw, body) {
  const isPreface = fm.section === 'preface';
  const anchorPrefix = isPreface ? 'preface' : `${fm['권']}-${fm['장']}`;
  if (!isPreface && (!fm['권'] || !fm['장'])) {
    return { filePath, skipped: true, reason: 'missing 권/장' };
  }
  // simplified single-file processing (per-file counter), same as legacy.
  const lines = body.split('\n');
  const out = [];
  const reviewQueue = [];
  let counter = 0;
  let totalSentences = 0;
  let i = 0;
  const hasGroupHeadings = /^##\s+\d+절(\s+\^[\w-]+)?\s*$/m.test(body);

  const flush = (paragraphs) => {
    for (const para of paragraphs) {
      const stripped = para.replace(/\s+\^[\w-]+\s*$/, '').trim();
      const sentences = splitSentences(stripped);
      for (const s of sentences) {
        counter++;
        totalSentences++;
        const anchor = `${anchorPrefix}-${counter}`;
        out.push(`${s} ^${anchor}`);
        out.push('');
        const endings = detectEndings(s);
        const endsWithoutPeriod = tailEndingRegex.test(s) && !/[.?!]\s*$/.test(s);
        const reasons = [];
        if (endsWithoutPeriod) reasons.push('end-no-period');
        if (endings.length >= 2) reasons.push(`multi-ending(${endings.length})`);
        if (reasons.length) {
          reviewQueue.push({ file: filePath, anchor, sentence: s, endings, reasons });
        }
      }
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!hasGroupHeadings && /^#\s/.test(line)) {
      out.push(line);
      i++;
      out.push('');
      while (i < lines.length && lines[i].trim() === '') i++;
      const paragraphs = [];
      let buf = [];
      while (i < lines.length && !/^---\s*$/.test(lines[i])) {
        if (lines[i].trim() === '') {
          if (buf.length) { paragraphs.push(buf.join(' ').trim()); buf = []; }
        } else buf.push(lines[i]);
        i++;
      }
      if (buf.length) paragraphs.push(buf.join(' ').trim());
      flush(paragraphs);
      continue;
    }
    const headingMatch = line.match(/^(##\s+\d+절)\s*(\^[\w-]+)?\s*$/);
    if (headingMatch) {
      out.push(headingMatch[1]);
      i++;
      out.push('');
      while (i < lines.length && lines[i].trim() === '') i++;
      const paragraphs = [];
      let buf = [];
      while (i < lines.length && !/^##\s/.test(lines[i]) && !/^#\s/.test(lines[i]) && !/^---\s*$/.test(lines[i])) {
        if (lines[i].trim() === '') {
          if (buf.length) { paragraphs.push(buf.join(' ').trim()); buf = []; }
        } else buf.push(lines[i]);
        i++;
      }
      if (buf.length) paragraphs.push(buf.join(' ').trim());
      flush(paragraphs);
      continue;
    }
    out.push(line);
    i++;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  const newBody = `---\n${raw}\n---\n${out.join('\n')}\n`;
  return { filePath, original: content, transformed: newBody, sentenceCount: totalSentences, reviewQueue, changed: content !== newBody };
}

function findMarkdownFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findMarkdownFiles(full));
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files.sort();
}

// === main ===

let targets;
if (target) {
  const full = path.isAbsolute(target) ? target : path.resolve(target);
  if (!fs.existsSync(full)) {
    console.error(`Target not found: ${full}`);
    process.exit(1);
  }
  targets = fs.statSync(full).isDirectory()
    ? findMarkdownFiles(full)
    : [full];
} else {
  console.error('--target= required');
  process.exit(1);
}

const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')
  .replace('T', '_')
  .slice(0, 19);
const backupDir = path.join(VAULT, '.bak', `sentence-anchor-${timestamp}`);

const allReviewQueue = [];
let totalSentences = 0;
let changedFiles = 0;
let skippedFiles = 0;

// sharedCounter 슬러그별로 누적 카운터 ref 유지.
const sharedCounters = new Map();

for (const f of targets) {
  const slug = detectScripture(f);
  if (!sharedCounters.has(slug)) sharedCounters.set(slug, { value: 0 });
  const result = processFile(f, sharedCounters.get(slug));
  if (result.skipped) {
    skippedFiles++;
    if (isDryRun) console.log(`SKIP ${path.relative(VAULT, f)}: ${result.reason}`);
    continue;
  }

  totalSentences += result.sentenceCount;
  allReviewQueue.push(...result.reviewQueue);

  if (!result.changed) {
    if (isDryRun) console.log(`UNCHANGED ${path.relative(VAULT, f)}`);
    continue;
  }

  changedFiles++;

  if (isDryRun) {
    console.log(`\n=== DRY RUN: ${path.relative(VAULT, f)} ===`);
    console.log(`Sentences: ${result.sentenceCount}`);
    console.log(`Review queue: ${result.reviewQueue.length}`);
  } else {
    const rel = path.relative(VAULT, f);
    const bakPath = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(bakPath), { recursive: true });
    fs.writeFileSync(bakPath, result.original);
    fs.writeFileSync(f, result.transformed);
    console.log(`UPDATED ${rel} (${result.sentenceCount} sentences)`);
  }
}

if (reportPath) {
  let md = `# 문장 단위 anchor 마이그레이션 — 마침표 누락 검수 큐\n\n`;
  md += `생성일: ${new Date().toISOString().slice(0, 10)}\n\n`;
  md += `**총 의심 케이스: ${allReviewQueue.length}개**\n\n`;
  md += `## 룰\n\n`;
  md += `다음 두 조건 중 하나라도 해당하면 의심 케이스로 표시:\n\n`;
  md += `- **end-no-period**: 분리된 문장이 마침표(\`.\`/\`?\`/\`!\`) 없이 종결 어미로 끝남 → 종결 마침표 누락 가능성\n`;
  md += `- **multi-ending(N)**: 분리된 한 문장 안에 종결 어미가 2개 이상 등장 → 안에 마침표 누락 가능성\n\n`;
  md += `종결 어미 후보: ${ENDING_PATTERNS.join(', ')}\n\n`;
  md += `## 검토 가이드\n\n`;
  md += `- 진짜 종결인데 마침표 누락 → 원본 markdown에 마침표 추가 후 재실행\n`;
  md += `- 양보(\`이라도\`)·인용 연결(\`라 하고\`) → 그대로 두기 (false positive)\n\n`;
  md += `---\n\n`;

  if (allReviewQueue.length === 0) {
    md += `의심 케이스 없음.\n`;
  } else {
    const byFile = new Map();
    for (const item of allReviewQueue) {
      const rel = path.relative(VAULT, item.file);
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel).push(item);
    }
    for (const [file, items] of byFile) {
      md += `## ${file}\n\n`;
      for (const item of items) {
        const tags = item.reasons.join(', ');
        const endingsLabel = item.endings.length
          ? ` 종결어 ${item.endings.length}개 (${item.endings.join(', ')})`
          : '';
        md += `- [ ] **${item.anchor}** — ${tags}${endingsLabel}\n`;
        md += `  > ${item.sentence}\n\n`;
      }
    }
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, md);
  console.log(`\nReview queue saved to ${path.relative(process.cwd(), reportPath)}`);
}

console.log(`\n=== Summary ===`);
console.log(`Files processed: ${targets.length}`);
console.log(`Files changed:   ${changedFiles}`);
console.log(`Files skipped:   ${skippedFiles}`);
console.log(`Total sentences: ${totalSentences}`);
console.log(`Review queue:    ${allReviewQueue.length}`);
if (!isDryRun && changedFiles > 0) {
  console.log(`Backup:          ${path.relative(process.cwd(), backupDir)}`);
}
