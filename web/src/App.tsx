import { useState } from 'react'
import { SendPage } from './SendPage.js'
import { ReceivePage } from './ReceivePage.js'

export function App() {
  // slug/code가 URL 경로에 있으면 받기 화면으로.
  const path = window.location.pathname.replace(/^\//, '')
  const [tab, setTab] = useState<'send' | 'receive'>(path ? 'receive' : 'send')

  return (
    <main className="min-h-screen bg-background text-foreground" style={{ maxWidth: 560, margin: '40px auto', fontFamily: 'system-ui', padding: 16 }}>
      <h1>Send Anywhere</h1>
      <nav style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button onClick={() => setTab('send')} disabled={tab === 'send'}>보내기</button>
        <button onClick={() => setTab('receive')} disabled={tab === 'receive'}>받기</button>
      </nav>
      {tab === 'send' ? <SendPage /> : <ReceivePage initialKey={path} />}
    </main>
  )
}
