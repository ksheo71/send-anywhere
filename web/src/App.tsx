import { useState } from 'react'
import { SendPage } from './SendPage.js'
import { ReceivePage } from './ReceivePage.js'
import { useTheme } from '@/theme'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'

export function App() {
  const path = window.location.pathname.replace(/^\//, '')
  const p2pCode = (location.hash.match(/^#p2p=(\d+)$/) || [])[1] || ''
  const { theme, toggle } = useTheme()
  const [tab, setTab] = useState<'send' | 'receive'>(path || p2pCode ? 'receive' : 'send')

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
                <ReceivePage initialKey={path} p2pCode={p2pCode} />
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
