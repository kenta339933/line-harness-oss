'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login') {
    return <>{children}</>
  }

  // チャットページはフルスクリーン化のため余白0にする（チャット側で自前管理）
  const isFullscreen = pathname === '/chats'

  return (
    <AuthGuard>
      <AccountProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <main
            className={
              isFullscreen
                ? 'flex-1 pt-12 px-0 pb-[calc(56px+env(safe-area-inset-bottom))] lg:pt-8 lg:px-8 lg:pb-8 overflow-auto'
                : 'flex-1 pt-[60px] px-4 pb-[calc(72px+env(safe-area-inset-bottom))] sm:px-6 lg:pt-8 lg:px-8 lg:pb-8 overflow-auto'
            }
          >
            {children}
          </main>
        </div>
      </AccountProvider>
    </AuthGuard>
  )
}
