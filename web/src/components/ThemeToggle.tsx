import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ThemeToggle({ theme, onToggle }: { theme: 'light' | 'dark'; onToggle: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={onToggle} aria-label="테마 전환">
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}
