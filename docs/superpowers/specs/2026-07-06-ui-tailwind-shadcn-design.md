# UI 리디자인 — Tailwind + shadcn/ui

작성일: 2026-07-06
상태: 승인됨 (구현 계획 작성 대기)

## 1. 목적과 범위

현재 프론트엔드(`web/`)는 인라인 스타일의 최소 React 컴포넌트 3개다. 이를 **Tailwind CSS +
shadcn/ui** 기반으로 리디자인한다. WeTransfer 같은 인상의 히어로 + 큰 드래그앤드롭 드롭존
레이아웃, 라이트/다크 테마 토글, 에메랄드 포인트 컬러.

**핵심 원칙 — 프레젠테이션만 교체.** 검증된 동작 로직은 그대로 유지한다:
- `web/src/api.ts` (createTransfer/finalizeTransfer/resolve/downloadUrl)
- tus 업로드 흐름과 `metadata.fileId` 매핑(서버 namingFunction과 정합)
- 로컬 QR 생성(`qrcode`), resolve/download 흐름
- 백엔드(`src/`)는 **일절 변경하지 않는다** — 40개 테스트가 그대로 통과해야 한다.

바꾸는 것은 마크업/스타일/레이아웃뿐이다.

## 2. 기술 셋업

- **Tailwind CSS + shadcn/ui**를 `web/`에 도입.
- 경로 별칭 `@/*` → `web/src/*` (vite resolve alias + tsconfig paths). shadcn CLI가 요구.
- `components.json`(shadcn 설정), `web/src/index.css`(Tailwind + shadcn CSS 변수),
  `web/src/lib/utils.ts`(`cn` 헬퍼).
- shadcn 컴포넌트는 `web/src/components/ui/`에 소스로 복사(빌드 의존이 아니라 프로젝트 소스).
  사용 컴포넌트: Button, Card, Input, Progress, Tabs, Badge, Separator.
- 아이콘: `lucide-react`.
- vite root가 `web/`이므로 모든 설정은 `web/` 기준으로 배치한다.
- 구체적 Tailwind 버전/플러그인 조합은 구현 계획에서 안정 조합으로 확정한다(빌드가 깨지지
  않는 것이 우선).

## 3. 테마 (라이트 + 다크)

- 에메랄드를 `--primary`로 하는 CSS 변수 팔레트를 라이트/다크 각각 `web/src/index.css`에 정의
  (shadcn `.dark` 클래스 전략).
- **테마 토글**: 헤더 우측 해/달 버튼. 선택값을 `localStorage`에 저장, 최초 방문 시
  `prefers-color-scheme`를 따른다.
- 외부 테마 라이브러리(next-themes 등) 없이 작은 커스텀 훅(`web/src/theme.ts`)으로 구현:
  `document.documentElement.classList`에 `dark` 토글 + localStorage 영속.

## 4. 레이아웃

전체는 단일 페이지, 중앙 정렬 컨테이너(모바일 1열 반응형).

- **헤더**: "Send Anywhere" 로고 텍스트(좌) + 테마 토글(우).
- **히어로**: 큰 제목 + 한 줄 서브카피(익명 · 24시간 자동삭제 · 기기 무관).
- **메인 패널(Card)**: 상단 `보내기 / 받기` 탭(shadcn Tabs).
  - **보내기 흐름**:
    1. 큰 **드래그앤드롭 드롭존**(점선 테두리 + 업로드 아이콘, 클릭 시 파일 선택도 가능).
    2. 선택 파일 리스트(파일명 · 용량 · 삭제 버튼).
    3. "보내기" 버튼 → 업로드 중 **전체 진행률 바**(Progress) + % 텍스트.
    4. 완료 시 **결과 상태**: 대형 6자리 코드, 로컬 생성 QR 이미지, "링크 복사" 버튼,
       "24시간 후 자동 삭제" 뱃지, "새 전송" 버튼.
  - **받기 흐름**:
    1. 큰 6자리 코드 입력(Input) + "받기" 버튼. URL 경로 slug가 있으면 자동 조회.
    2. 조회 성공 시 파일 카드 리스트(이름 · 용량 · 개별 다운로드 링크).
    3. 파일이 2개 이상이면 "전체 zip 받기" 버튼.
    4. 없음/만료 시 "없거나 만료된 코드입니다" 메시지.
- **푸터**: 익명 · 자동삭제 안내 한 줄.
- **드래그앤드롭**은 외부 라이브러리 없이 네이티브 DnD 이벤트(onDragOver/onDragLeave/onDrop)로
  구현한다.

## 5. 파일 구조

신규:
- `web/src/index.css` (Tailwind 지시자 + shadcn CSS 변수 팔레트)
- `web/src/lib/utils.ts` (`cn`)
- `web/src/theme.ts` (테마 훅)
- `web/src/components/ui/*` (shadcn: button, card, input, progress, tabs, badge, separator)
- `web/src/components/ThemeToggle.tsx`
- `web/src/components/Dropzone.tsx` (네이티브 DnD 드롭존)
- `components.json`, tailwind 설정 파일

재작성(로직 유지, 마크업만 shadcn):
- `web/src/App.tsx` — 헤더/히어로/탭/푸터 셸 + 테마 프로바이더
- `web/src/SendPage.tsx` — 드롭존 + 진행률 + 결과 카드
- `web/src/ReceivePage.tsx` — 코드 입력 + 파일 카드 + 다운로드
- `web/src/main.tsx`, `web/index.html` — CSS import, 기본 클래스

무변경:
- `web/src/api.ts`, 백엔드 `src/**` 전체

## 6. 검증

- `npm run build:web` 그린(타입/빌드 에러 0).
- `npm test` 40/40 그대로 통과(백엔드 무변경 확인).
- **실제 브라우저 검증**: dev 서버(`dev:server` + `dev:web`)를 띄워
  - 업로드 → 6자리 코드/QR/링크 → 받기 탭에서 코드로 조회 → 다운로드 왕복이 리디자인 UI에서
    동작함을 확인.
  - 라이트/다크 토글, 모바일 뷰(반응형)를 스크린샷으로 확인.
- 프로덕션 배포는 확인 후 `main` push로(러너 자동 배포).

## 7. 범위에서 제외

- 백엔드/기능 로직 변경(순수 UI만).
- 2단계 P2P 기능(별도 프로젝트).
- 다국어, 접근성 대규모 개편(기본적인 시맨틱/포커스는 shadcn 기본 수준 유지).
