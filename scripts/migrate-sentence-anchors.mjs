#!/usr/bin/env node
// 천지개벽경 markdown 절 단위 anchor → 문장 단위 anchor 마이그레이션
//
// 변환 규칙:
//   - "## N절 ^anchor" 헤딩의 anchor 제거 (헤딩은 절 그룹 표시로 유지)
//   - 절 본문 paragraph를 마침표/?/! 기준으로 문장 분리
//   - 각 문장에 ^권-장-N (또는 preface-N) 일련번호 부착
//   - 일련번호는 장 단위 (한 파일 안에서 1, 2, 3, ...)
//   - 텍스트 절대 수정 X (마침표 추가 X, 어법 수정 X), 분리만
//
// 사용법:
//   node scripts/migrate-sentence-anchors.mjs --dry-run --target=path
//   node scripts/migrate-sentence-anchors.mjs --target=content/scripture/cheonjigaebyeokgyeong
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

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseFrontmatter(content);
  if (!parsed) return { filePath, skipped: true, reason: 'no frontmatter' };

  const { fm, raw, body } = parsed;

  // 천지개벽경 외 다른 경전은 frontmatter 형식이 다를 수 있음 → canonical만 처리
  if (fm.canonical !== 'true') {
    return { filePath, skipped: true, reason: 'not canonical' };
  }

  const isPreface = fm.section === 'preface';
  const anchorPrefix = isPreface
    ? 'preface'
    : `${fm['권']}-${fm['장']}`;

  if (!isPreface && (!fm['권'] || !fm['장'])) {
    return { filePath, skipped: true, reason: 'missing 권/장' };
  }

  const lines = body.split('\n');
  const out = [];
  const reviewQueue = [];
  let sentenceCounter = 0;
  let totalSentences = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

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

      // 각 paragraph를 문장 단위로 분리
      for (const para of paragraphs) {
        const sentences = splitSentences(para);
        for (const s of sentences) {
          sentenceCounter++;
          totalSentences++;
          const anchor = `${anchorPrefix}-${sentenceCounter}`;
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

for (const f of targets) {
  const result = processFile(f);
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
    console.log('--- TRANSFORMED ---');
    console.log(result.transformed);
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
  let md = `# 천지개벽경 문장 단위 anchor 마이그레이션 — 마침표 누락 검수 큐\n\n`;
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
