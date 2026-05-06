# jsbooks

증산계열 경전 디지털 라이브러리. Astro + Svelte islands.

## 콘텐츠

옵시디언 vault root = 이 리포의 `content/` 디렉터리. 별도 sync 단계 없이 옵시디언/IDE에서 편집한 markdown이 곧바로 빌드 입력이 됩니다.

```bash
git add content
git commit -m "content: ..."
git push              # Cloudflare Pages가 자동 빌드·배포
```

`.env`의 `VAULT_PATH`로 admin 도구가 쓸 vault 경로를 지정합니다 (기본: `<repo>/content`).

## 스택

- **Astro 6** — 정적 페이지 + content collections
- **Svelte 5 islands** — SideCard 사이드바, SearchBox 검색
- **Pagefind** — 한글 키워드 검색 (빌드 시 인덱싱)
- **marked** — 마크다운 → HTML

## 개발

```bash
nvm use               # .nvmrc 따라 Node 22
pnpm install
pnpm dev              # http://localhost:4321
pnpm build            # dist/ + dist/pagefind/
pnpm preview          # 빌드 결과 미리보기 (검색 동작 확인)
```

## 데이터 모델

- 권/장 단위 1파일 (`content/scripture/cheonjigaebyeokgyeong/<vol>_<name>/<vol>-<chap>_장.md`)
- 절은 `## N절 ^vol-chap-num` 옵시디언 block ID
- 위키링크 `[[X]]` / `[[X|alias]]` 자동 변환
- 카드: people / places / dosu / terms / dates
- 본문 안 `[[01-07_장]]`은 `/scripture/1/7/`로 해석

## 라이선스

본문 텍스트의 권리는 각 자료의 원 권리자에게 있습니다.
