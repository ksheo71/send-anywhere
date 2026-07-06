# UI Tailwind + shadcn 리디자인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 인라인 스타일 React 프론트엔드를 Tailwind CSS v4 + shadcn/ui 컴포넌트로 리디자인한다 (WeTransfer식 히어로 + 드래그앤드롭 드롭존, 라이트/다크 토글, 에메랄드 포인트). 기능 로직은 무변경.

**Architecture:** Vite(root: `web/`) + React. Tailwind v4를 `@tailwindcss/vite` 플러그인으로 붙이고, shadcn 스타일 컴포넌트를 `web/src/components/ui/`에 직접 소스로 둔다(비표준 `root:'web'` 레이아웃에서 shadcn CLI 자동감지 리스크를 피하려고 수동 작성). 경로 별칭 `@ → web/src`. 검증된 업로드/다운로드/QR 로직(`api.ts`, tus, `metadata.fileId`, `relativeLocation`)은 마크업만 교체하고 그대로 유지한다.

**Tech Stack:** Vite 6, React 18, TypeScript, Tailwind CSS v4, `@tailwindcss/vite`, class-variance-authority, clsx, tailwind-merge, lucide-react, Radix UI(`react-slot`/`react-tabs`/`react-progress`). 기존: tus-js-client, qrcode.

## Global Constraints

- 프레젠테이션만 변경. `web/src/api.ts`와 백엔드 `src/**` 는 **절대 수정하지 않는다**. `npm test` 40/40 이 그대로 통과해야 한다.
- 업로드 로직 불변: tus `endpoint: '/files'`, `chunkSize` 50MB(52428800), `metadata: { fileId: <createTransfer가 준 그 파일의 id>, filename }`, 여러 파일 순차 업로드, 전체 완료 후 `finalizeTransfer`. 서버 `namingFunction`이 `metadata.fileId`를 uploadId로 쓰므로 이 매핑은 반드시 유지.
- QR은 `qrcode` 패키지로 **로컬 생성**(외부 서비스 금지 — 공유 링크는 비밀 URL).
- 공유 링크는 `${window.location.origin}/${slug}`. 다운로드는 평범한 `<a href>`(fetch 아님). 6자리 코드 입력 `maxLength=6`. 404(resolve null) → "없거나 만료된 코드입니다".
- 포인트 컬러 에메랄드. 라이트/다크 토글(localStorage 저장, 최초엔 `prefers-color-scheme`). 다크는 `<html>`에 `.dark` 클래스.
- vite root 는 `web/`. 모든 설정/별칭은 이 기준. 빌드 산출물은 `web/dist`.
- 검증: `npm run build:web` 그린 + `npm test` 40/40 + 실제 브라우저에서 업로드→코드→다운로드 왕복 + 라이트/다크/모바일.
- UI는 순수 프레젠테이션이라 vitest 단위테스트를 새로 만들지 않는다. 각 태스크의 "테스트"는 `npm run build:web` 성공 + 지정된 시각/동작 확인이다.
- 커밋 메시지는 한국어, 각 태스크 끝에 커밋.

---

## File Structure

```
send-anywhere/
├── vite.config.ts            # 수정: @tailwindcss/vite 플러그인 + '@'→web/src 별칭
├── package.json              # 수정: tailwind/shadcn 의존성 추가
├── web/
│   ├── tsconfig.json         # 신규: 에디터용 '@/*' paths (빌드는 vite alias가 담당)
│   ├── index.html            # 수정: <html> 기본 클래스/폰트
│   └── src/
│       ├── main.tsx          # 수정: import './index.css'
│       ├── index.css         # 신규: Tailwind v4 + shadcn 토큰(에메랄드, 라이트/다크)
│       ├── lib/utils.ts      # 신규: cn()
│       ├── theme.ts          # 신규: 테마 훅(localStorage + prefers-color-scheme)
│       ├── api.ts            # 무변경
│       ├── components/
│       │   ├── ui/
│       │   │   ├── button.tsx
│       │   │   ├── card.tsx
│       │   │   ├── input.tsx
│       │   │   ├── progress.tsx
│       │   │   ├── tabs.tsx
│       │   │   └── badge.tsx
│       │   ├── ThemeToggle.tsx
│       │   └── Dropzone.tsx  # 네이티브 DnD
│       ├── App.tsx           # 재작성: 셸(헤더/히어로/탭/푸터)
│       ├── SendPage.tsx      # 재작성: 마크업만 shadcn (로직 유지)
│       └── ReceivePage.tsx   # 재작성: 마크업만 shadcn (로직 유지)
```

각 shadcn 컴포넌트 파일은 단일 프리미티브 하나만 담당한다.

---

## Task 1: Tailwind v4 + 별칭 + 토큰 기반 셋업

**Files:**
- Modify: `package.json`, `vite.config.ts`, `web/index.html`, `web/src/main.tsx`
- Create: `web/tsconfig.json`, `web/src/index.css`, `web/src/lib/utils.ts`

**Interfaces:**
- Produces: `cn(...inputs)` from `@/lib/utils` (clsx + tailwind-merge).
- Produces: `@` 별칭 → `web/src`; Tailwind v4 유틸리티 클래스가 빌드에서 동작; shadcn CSS 변수 토큰(`--background`, `--foreground`, `--primary`(에메랄드), `--card`, `--border`, `--input`, `--ring`, `--muted`, `--muted-foreground`, `--destructive`, `--radius`)이 라이트/`.dark` 양쪽에 정의됨.

- [ ] **Step 1: 의존성 설치**

Run:
```bash
npm install -D tailwindcss@^4 @tailwindcss/vite@^4
npm install clsx tailwind-merge class-variance-authority lucide-react
```
Expected: 설치 성공, package.json 갱신.

- [ ] **Step 2: vite.config.ts 수정 (tailwind 플러그인 + 별칭)**

`vite.config.ts` 전체를 다음으로 교체:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'web/src') },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://localhost:4500',
      '/files': 'http://localhost:4500',
    },
  },
})
```
주의: `import.meta.dirname`은 Node 22 + ESM에서 vite.config.ts 파일이 있는 디렉터리(레포 루트)를 가리킨다 → `@`는 `<repo>/web/src`.

- [ ] **Step 3: web/tsconfig.json 생성 (에디터용 별칭)**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```
(빌드는 vite/esbuild가 하므로 이 파일은 타입/에디터 편의용. 루트 `tsconfig.json`(백엔드)은 건드리지 않는다.)

- [ ] **Step 4: web/src/index.css 생성 (Tailwind v4 + 에메랄드 토큰)**

`web/src/index.css`:
```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.75rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.696 0.17 162.48);        /* emerald */
  --primary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.696 0.17 162.48);
  --destructive: oklch(0.577 0.245 27.325);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --primary: oklch(0.696 0.17 162.48);
  --primary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.696 0.17 162.48);
  --destructive: oklch(0.704 0.191 22.216);
}

@theme inline {
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-destructive: var(--destructive);
}

* { border-color: var(--color-border); }
body {
  background-color: var(--color-background);
  color: var(--color-foreground);
  font-family: system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 5: web/src/lib/utils.ts 생성**

`web/src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 6: main.tsx 및 index.html 수정**

`web/src/main.tsx`에 CSS import 추가(첫 줄):
```tsx
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
```

`web/index.html`의 `<body>` 태그 클래스에 antialiasing 추가(선택), `<html lang="ko">` 유지. 최소 변경으로 다음처럼:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Send Anywhere</title>
  </head>
  <body class="antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: 임시 Tailwind 클래스로 빌드 검증**

`web/src/App.tsx`의 최상위 `<main>`에 임시로 Tailwind 클래스를 하나 넣어 빌드가 유틸리티를 처리하는지 확인한다(예: 기존 `style` 대신 `className="min-h-screen bg-background text-foreground"`를 추가). 이 변경은 Task 4에서 최종 셸로 대체된다.

Run: `npm run build:web`
Expected: `web/dist/index.html` + CSS 에셋 생성, 에러 0. 생성된 CSS에 배경/텍스트 유틸리티가 포함됨.

- [ ] **Step 8: 백엔드 무변경 확인**

Run: `npm test`
Expected: 40/40 통과(백엔드 파일 미변경).

- [ ] **Step 9: 커밋**

```bash
git add package.json package-lock.json vite.config.ts web/tsconfig.json web/index.html web/src/index.css web/src/lib/utils.ts web/src/main.tsx web/src/App.tsx
git commit -m "UI: Tailwind v4 + 별칭 + 에메랄드 토큰 셋업"
```

---

## Task 2: shadcn UI 프리미티브

**Files:**
- Create: `web/src/components/ui/{button,card,input,progress,tabs,badge}.tsx`
- Modify: `package.json` (Radix 의존성)

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`.
- Produces (import 경로 `@/components/ui/...`):
  - `Button` (props: `variant?: 'default'|'outline'|'ghost'|'secondary'`, `size?: 'default'|'sm'|'lg'|'icon'`, `asChild?`), `buttonVariants`
  - `Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter`
  - `Input`
  - `Progress` (props: `value?: number`)
  - `Tabs, TabsList, TabsTrigger, TabsContent`
  - `Badge` (props: `variant?: 'default'|'secondary'|'outline'`)

- [ ] **Step 1: Radix 의존성 설치**

Run:
```bash
npm install @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-progress
```
Expected: 설치 성공.

- [ ] **Step 2: button.tsx 생성**

`web/src/components/ui/button.tsx`:
```tsx
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border bg-background hover:bg-muted',
        secondary: 'bg-muted text-foreground hover:opacity-90',
        ghost: 'hover:bg-muted',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
```

- [ ] **Step 3: card.tsx 생성**

`web/src/components/ui/card.tsx`:
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...props} />
  ),
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-xl font-semibold leading-none tracking-tight', className)} {...props} />
  ),
)
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
)
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
```

- [ ] **Step 4: input.tsx 생성**

`web/src/components/ui/input.tsx`:
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
```

- [ ] **Step 5: progress.tsx 생성**

`web/src/components/ui/progress.tsx`:
```tsx
import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/lib/utils'

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
```

- [ ] **Step 6: tabs.tsx 생성**

`web/src/components/ui/tabs.tsx`:
```tsx
import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex h-11 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground', className)}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-6 focus-visible:outline-none', className)}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

- [ ] **Step 7: badge.tsx 생성**

`web/src/components/ui/badge.tsx`:
```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-muted text-muted-foreground',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
```

- [ ] **Step 8: 빌드 검증**

임시로 `web/src/App.tsx`에서 `Button` 하나를 import·렌더해 프리미티브가 컴파일되는지 확인(Task 4에서 최종 셸로 대체).

Run: `npm run build:web`
Expected: 빌드 성공, 에러 0.

- [ ] **Step 9: 커밋**

```bash
git add web/src/components/ui package.json package-lock.json web/src/App.tsx
git commit -m "UI: shadcn 프리미티브(button/card/input/progress/tabs/badge)"
```

---

## Task 3: 테마 훅 + 토글

**Files:**
- Create: `web/src/theme.ts`, `web/src/components/ThemeToggle.tsx`

**Interfaces:**
- Consumes: `Button` (`@/components/ui/button`), lucide `Sun`/`Moon`.
- Produces: `useTheme(): { theme: 'light'|'dark'; toggle: () => void }` from `@/theme` — 최초 마운트 시 localStorage(`sa-theme`) 값 또는 `prefers-color-scheme`로 `<html>`에 `.dark` 반영, `toggle`은 전환+저장.
- Produces: `<ThemeToggle />` — 해/달 아이콘 버튼.

- [ ] **Step 1: theme.ts 생성**

`web/src/theme.ts`:
```ts
import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'sa-theme'

function initial(): Theme {
  const saved = localStorage.getItem(KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(KEY, theme)
  }, [theme])

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}
```

- [ ] **Step 2: ThemeToggle.tsx 생성**

`web/src/components/ThemeToggle.tsx`:
```tsx
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ThemeToggle({ theme, onToggle }: { theme: 'light' | 'dark'; onToggle: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={onToggle} aria-label="테마 전환">
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}
```

- [ ] **Step 3: 빌드 검증**

Run: `npm run build:web`
Expected: 성공(아직 App에 연결 전이므로 tree-shake될 수 있음 — 컴파일 에러가 없으면 OK).

- [ ] **Step 4: 커밋**

```bash
git add web/src/theme.ts web/src/components/ThemeToggle.tsx
git commit -m "UI: 라이트/다크 테마 훅 + 토글"
```

---

## Task 4: 앱 셸 재작성 (헤더/히어로/탭/푸터)

**Files:**
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useTheme` (`@/theme`), `ThemeToggle`, `Tabs/TabsList/TabsTrigger/TabsContent` (`@/components/ui/tabs`), `Card/CardContent` (`@/components/ui/card`), `SendPage`, `ReceivePage`.
- Produces: 셸 레이아웃. 기존 동작 유지 — URL 경로 slug가 있으면 기본 탭이 '받기', 그 slug를 `ReceivePage`의 `initialKey`로 전달.

- [ ] **Step 1: App.tsx 재작성**

`web/src/App.tsx` 전체 교체:
```tsx
import { useState } from 'react'
import { SendPage } from './SendPage.js'
import { ReceivePage } from './ReceivePage.js'
import { useTheme } from '@/theme'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'

export function App() {
  const path = window.location.pathname.replace(/^\//, '')
  const { theme, toggle } = useTheme()
  const [tab, setTab] = useState<'send' | 'receive'>(path ? 'receive' : 'send')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
        <span className="text-lg font-bold tracking-tight">Send Anywhere</span>
        <ThemeToggle theme={theme} onToggle={toggle} />
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-16">
        <section className="py-8 text-center sm:py-12">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">파일을 어디로든 보내세요</h1>
          <p className="mt-3 text-muted-foreground">
            로그인 없이 · 6자리 코드나 링크로 · 24시간 뒤 자동 삭제
          </p>
        </section>

        <Card>
          <CardContent className="pt-6">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'send' | 'receive')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="send">보내기</TabsTrigger>
                <TabsTrigger value="receive">받기</TabsTrigger>
              </TabsList>
              <TabsContent value="send">
                <SendPage />
              </TabsContent>
              <TabsContent value="receive">
                <ReceivePage initialKey={path} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <footer className="mt-8 text-center text-xs text-muted-foreground">
          익명 · 파일은 24시간 후 자동 삭제됩니다.
        </footer>
      </main>
    </div>
  )
}
```
주의: 이 시점에 `SendPage`/`ReceivePage`는 아직 기존(인라인 스타일) 마크업일 수 있다. 탭 안에서 렌더만 되면 OK(다음 태스크에서 재작성). `import './SendPage.js'` 확장자 스타일은 기존과 동일하게 유지.

- [ ] **Step 2: 빌드 + 브라우저 확인**

Run: `npm run build:web`
Expected: 성공.

Run(수동): 터미널 2개 — `npm run dev:server` 와 `npm run dev:web`. 브라우저에서:
- 헤더/히어로/탭/푸터가 보이고, 탭 전환 동작.
- 테마 토글 클릭 시 라이트↔다크 전환되고 새로고침 후 유지(localStorage).
Expected: 셸 레이아웃 정상, 테마 토글 동작.

- [ ] **Step 3: 커밋**

```bash
git add web/src/App.tsx
git commit -m "UI: 앱 셸(헤더/히어로/탭/푸터) + 테마 연결"
```

---

## Task 5: 네이티브 드래그앤드롭 Dropzone

**Files:**
- Create: `web/src/components/Dropzone.tsx`

**Interfaces:**
- Consumes: `cn` (`@/lib/utils`), lucide `Upload`.
- Produces: `<Dropzone onFiles={(files: File[]) => void} disabled?: boolean />` — 클릭 시 파일 선택 다이얼로그, 드래그 오버 시 하이라이트, 드롭 시 `onFiles(droppedFiles)` 호출. 여러 파일 허용.

- [ ] **Step 1: Dropzone.tsx 생성**

`web/src/components/Dropzone.tsx`:
```tsx
import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Dropzone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function pick(list: FileList | null) {
    if (list && list.length) onFiles(Array.from(list))
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click() }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) pick(e.dataTransfer.files) }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors',
        over ? 'border-primary bg-primary/5' : 'border-input hover:border-primary/50',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <Upload className="size-8 text-muted-foreground" />
      <div>
        <p className="font-medium">여기로 파일을 끌어다 놓거나 클릭</p>
        <p className="text-sm text-muted-foreground">여러 파일도 한 번에</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => { pick(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
```

- [ ] **Step 2: 빌드 검증**

Run: `npm run build:web`
Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/Dropzone.tsx
git commit -m "UI: 네이티브 드래그앤드롭 Dropzone"
```

---

## Task 6: SendPage 재작성 (드롭존 + 진행률 + 결과 카드)

**Files:**
- Modify: `web/src/SendPage.tsx`

**Interfaces:**
- Consumes: `createTransfer`, `finalizeTransfer` (`./api.js`), `tus`, `QRCode`, `Dropzone`, `Button`, `Progress`, `Badge`, lucide `Copy`/`Check`/`X`/`File`.
- 로직은 기존과 동일(아래 코드에 그대로 반영됨): 순차 tus 업로드, `metadata.fileId` 매핑, 전체 진행률, finalize, 로컬 QR, 결과 표시.

- [ ] **Step 1: SendPage.tsx 재작성**

`web/src/SendPage.tsx` 전체 교체(로직 동일, 마크업만 shadcn):
```tsx
import { useEffect, useState } from 'react'
import * as tus from 'tus-js-client'
import QRCode from 'qrcode'
import { Check, Copy, File as FileIcon, X } from 'lucide-react'
import { createTransfer, finalizeTransfer } from './api.js'
import { Dropzone } from '@/components/Dropzone'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'

const CHUNK = 50 * 1024 * 1024

function fmtSize(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export function SendPage() {
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ code: string; slug: string } | null>(null)
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)

  async function send() {
    if (files.length === 0) return
    setBusy(true); setError(''); setProgress(0)
    try {
      const meta = files.map((f) => ({ filename: f.name, size: f.size }))
      const t = await createTransfer(meta)
      const totals = files.reduce((s, f) => s + f.size, 0)
      let uploaded = 0
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileId = t.files[i].id
        await new Promise<void>((resolve, reject) => {
          const upload = new tus.Upload(file, {
            endpoint: '/files',
            chunkSize: CHUNK,
            retryDelays: [0, 1000, 3000, 5000],
            metadata: { fileId, filename: file.name },
            onError: reject,
            onProgress: (sent) => setProgress(Math.round(((uploaded + sent) / totals) * 100)),
            onSuccess: () => { uploaded += file.size; resolve() },
          })
          upload.start()
        })
      }
      await finalizeTransfer(t.transferId)
      setResult({ code: t.code, slug: t.slug })
    } catch (e: any) {
      setError(e?.message ?? '업로드 실패')
    } finally {
      setBusy(false)
    }
  }

  const link = result ? `${window.location.origin}/${result.slug}` : ''

  useEffect(() => {
    if (!link) { setQrDataUrl(''); return }
    let cancelled = false
    QRCode.toDataURL(link, { margin: 1, width: 200 })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => { if (!cancelled) setQrDataUrl('') })
    return () => { cancelled = true }
  }, [link])

  function copy() {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function reset() {
    setResult(null); setFiles([]); setProgress(0); setError('')
  }

  if (result) {
    return (
      <div className="flex flex-col items-center gap-5 py-4 text-center">
        <p className="text-sm text-muted-foreground">받는 사람에게 이 코드나 링크를 전달하세요</p>
        <div className="font-mono text-5xl font-bold tracking-[0.2em]">{result.code}</div>
        {qrDataUrl && (
          <img src={qrDataUrl} alt="QR" width={200} height={200} className="rounded-lg border p-2" />
        )}
        <div className="flex w-full max-w-md items-center gap-2">
          <div className="flex-1 truncate rounded-md border bg-muted px-3 py-2 text-left text-sm">{link}</div>
          <Button variant="outline" size="icon" onClick={copy} aria-label="링크 복사">
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <Badge variant="secondary">24시간 후 자동 삭제</Badge>
        <Button variant="ghost" onClick={reset}>새 전송</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <Dropzone onFiles={(fs) => setFiles((prev) => [...prev, ...fs])} disabled={busy} />

      {files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <FileIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-muted-foreground">{fmtSize(f.size)}</span>
              {!busy && (
                <button aria-label="제거" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                  <X className="size-4 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <div className="flex flex-col gap-1">
          <Progress value={progress} />
          <span className="text-right text-xs text-muted-foreground">{progress}%</span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button size="lg" onClick={send} disabled={busy || files.length === 0}>
        {busy ? `업로드 중… ${progress}%` : '보내기'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: 빌드 검증**

Run: `npm run build:web`
Expected: 성공.

- [ ] **Step 3: 브라우저 업로드 확인**

Run(수동): `npm run dev:server` + `npm run dev:web`. 보내기 탭에서 작은 파일을 드롭 → 진행률 → 6자리 코드 + QR + 링크 복사 확인.
Expected: 업로드 성공, 코드/QR/링크 표시, 복사 동작.

- [ ] **Step 4: 커밋**

```bash
git add web/src/SendPage.tsx
git commit -m "UI: 보내기 화면 재작성(드롭존/진행률/결과 카드)"
```

---

## Task 7: ReceivePage 재작성 (코드 입력 + 파일 카드 + 다운로드)

**Files:**
- Modify: `web/src/ReceivePage.tsx`

**Interfaces:**
- Consumes: `resolve`, `downloadUrl`, `FileMeta` (`./api.js`), `Input`, `Button`, lucide `Download`/`File`.
- 로직 동일: `initialKey` 있으면 자동 조회, 6자리 입력, null→"없거나 만료된 코드입니다", 개별 다운로드 링크, >1이면 전체 zip.

- [ ] **Step 1: ReceivePage.tsx 재작성**

`web/src/ReceivePage.tsx` 전체 교체:
```tsx
import { useEffect, useState } from 'react'
import { Download, File as FileIcon } from 'lucide-react'
import { resolve, downloadUrl, type FileMeta } from './api.js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

function fmtSize(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export function ReceivePage({ initialKey }: { initialKey: string }) {
  const [key, setKey] = useState(initialKey)
  const [data, setData] = useState<{ transferId: string; files: FileMeta[] } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function lookup(k: string) {
    if (!k) return
    setLoading(true); setError(''); setData(null)
    try {
      const r = await resolve(k)
      if (!r) setError('없거나 만료된 코드입니다')
      else setData(r)
    } catch { setError('조회 실패') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (initialKey) lookup(initialKey) }, [initialKey])

  return (
    <div className="flex flex-col gap-4 py-2">
      {!data && (
        <div className="flex flex-col items-center gap-4 py-6">
          <Input
            placeholder="6자리 코드"
            value={key}
            onChange={(e) => setKey(e.target.value.trim())}
            onKeyDown={(e) => { if (e.key === 'Enter') lookup(key) }}
            maxLength={6}
            inputMode="numeric"
            className="h-14 w-52 text-center font-mono text-2xl tracking-[0.3em]"
          />
          <Button size="lg" onClick={() => lookup(key)} disabled={loading || !key}>
            {loading ? '조회 중…' : '받기'}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {data.files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{f.filename}</span>
                <span className="text-muted-foreground">{fmtSize(f.size)}</span>
                <a href={downloadUrl(data.transferId, f.id)} aria-label="내려받기">
                  <Download className="size-4 text-muted-foreground hover:text-foreground" />
                </a>
              </li>
            ))}
          </ul>
          {data.files.length > 1 && (
            <a href={downloadUrl(data.transferId)}>
              <Button className="w-full" size="lg">전체 zip 받기</Button>
            </a>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 빌드 검증**

Run: `npm run build:web`
Expected: 성공.

- [ ] **Step 3: 브라우저 받기 확인**

Run(수동): dev 서버 2개. Task 6에서 받은 코드로 받기 탭 조회 → 파일 카드 + 다운로드 동작. 링크(`/<slug>`)로 접속 시 자동 조회 확인.
Expected: 조회·다운로드 왕복 성공.

- [ ] **Step 4: 커밋**

```bash
git add web/src/ReceivePage.tsx
git commit -m "UI: 받기 화면 재작성(코드 입력/파일 카드/다운로드)"
```

---

## Task 8: 전체 검증 + 배포

**Files:** 없음(검증·배포만). 필요 시 사소한 스타일 보정.

**Interfaces:** 없음.

- [ ] **Step 1: 전체 빌드 + 백엔드 테스트**

Run: `npm run build && npm test`
Expected: 서버(tsc) + 웹(vite) 빌드 성공, 백엔드 40/40 통과(무변경 확인).

- [ ] **Step 2: 브라우저 종합 스모크(라이트/다크/모바일)**

Run(수동): dev 서버 2개. 확인 항목:
- 업로드→코드/QR/링크→받기 코드 조회→개별/전체 다운로드 왕복.
- 테마 토글 라이트↔다크, 새로고침 유지.
- 드래그앤드롭(파일 끌어다 놓기)과 클릭 선택 모두 동작.
- 모바일 폭(예: 375px)에서 레이아웃 1열로 정상.
Expected: 전 항목 정상. (스크린샷으로 라이트/다크/모바일 기록.)

- [ ] **Step 3: 배포(main push → 러너 자동 배포)**

Run:
```bash
git push origin main
```
그 후 배포 확인:
```bash
gh run watch "$(gh run list --repo ksheo71/send-anywhere --limit 1 --json databaseId -q '.[0].databaseId')" --repo ksheo71/send-anywhere --exit-status
```
Expected: 배포 성공.

- [ ] **Step 4: 프로덕션 확인**

Run:
```bash
curl -sS https://sendfile.myazit.kr/ | grep -o '<title>[^<]*</title>'
curl -sS https://sendfile.myazit.kr/api/health
```
Expected: 타이틀 노출 + `{"status":"ok"}`. 브라우저로 https://sendfile.myazit.kr 접속해 리디자인 UI 확인.

---

## 최종 검증 체크리스트
- [ ] `npm run build:web` 그린, `npm test` 40/40.
- [ ] 업로드→다운로드 왕복(리디자인 UI)에서 동작.
- [ ] 라이트/다크 토글 + 유지, 반응형(모바일 1열).
- [ ] 프로덕션 배포 후 https://sendfile.myazit.kr 정상.

## 자기 검토 메모(작성자)
- 스펙 커버리지: §2 셋업(T1,2) · §3 테마(T3,4) · §4 레이아웃(T4,5,6,7) · §5 파일구조(전 태스크) · §6 검증(T8). 전부 매핑됨.
- 로직 무변경 원칙: SendPage/ReceivePage의 업로드·조회·다운로드·QR 코드는 기존과 동일하게 태스크에 그대로 실려 있음(마크업만 교체). `api.ts`·백엔드 미변경.
- 주의: (1) `@` 별칭은 vite `resolve.alias`가 빌드에서 담당(웹 tsconfig는 에디터용). (2) Tailwind v4는 `@tailwindcss/vite` 플러그인 + `@import "tailwindcss"` + `@custom-variant dark`. (3) 다크는 `<html>.dark` 클래스. (4) 기존 `.js` 확장자 상대 import(`./api.js`, `./SendPage.js`)는 유지, 신규 컴포넌트는 `@/...` 별칭 사용.
