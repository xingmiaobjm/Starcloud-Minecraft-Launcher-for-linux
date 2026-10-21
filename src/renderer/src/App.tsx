/// 应用壳：窗口骨架 + 自绘标题栏 + 侧边导航 + 内容区。
/// 主题跟随系统（Win 端 nativeTheme → 这里 data-theme）。
import { useEffect, useState } from 'react'

import { appVersion as readAppVersion } from './bridge'

import Nav, { PAGE_LABEL, type PageKey } from './nav'
import { useTheme } from './theme'
import { loadAndApplyVisualSettings } from './visualSettings'
import TitleBar from './titlebar'
import LaunchOverlay from './launchOverlay'
import { ErrorBoundary } from './ui'
import { useGameSession } from './state/session'
import { useTaskCenter } from './state/tasks'
import TaskDrawer from './TaskDrawer'
import { IconUser } from './icons'
import HomePage from './pages/Home'
import VersionsPage from './pages/Versions'
import DownloadPage from './pages/Download'
import SavesPage from './pages/Saves'
import FriendsPage from './pages/Friends'
import LabPage from './pages/Lab'
import ProjectionsPage from './pages/Projections'
import RunningPage from './pages/Running'
import AccountsPage from './pages/Accounts'
import PluginsPage from './pages/Plugins'
import NovaPage from './pages/Nova'
import SettingsPage from './pages/Settings'
import LogsPage from './pages/Logs'

import brandMark from './assets/brand/starcloud-mark-small.svg'


export default function App(props: { initialTheme: import("./theme").ResolvedTheme }): JSX.Element {
  const theme = useTheme(props.initialTheme)
  const [page, setPage] = useState<PageKey>('home')
  const session = useGameSession()
  const taskCenter = useTaskCenter()
  const [tasksOpen, setTasksOpen] = useState(false)
  // 「问 Nova」的预填文本（版本行菜单 → Nova 页自动填入输入框）
  const [novaSeed, setNovaSeed] = useState('')

  // 启动时应用一次视觉设置（动效档位 / 背景），之后由设置页即时更新
  useEffect(() => {
    void loadAndApplyVisualSettings()
  }, [])
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    void readAppVersion()
      .then(setAppVersion)
      .catch(() => undefined)
  }, [])
  const running = session.pid !== undefined && session.pid > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      const order: PageKey[] = [
        'home',
        'versions',
        'download',
        'saves',
        'friends',
        'lab',
        'projections',
        'running',
        'accounts',
        'plugins'
      ]
      if (e.key >= '1' && e.key <= '9') {
        const target = order[Number(e.key) - 1]
        if (target !== undefined) {
          e.preventDefault()
          setPage(target)
        }
      } else if (e.key === '0') {
        e.preventDefault()
        setPage('settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const render = (): React.ReactNode => {
    switch (page) {
      case 'home':
        return (
          <HomePage
            session={session}
            onNavigate={(target) => setPage(target)}
          />
        )
      case 'versions':
        return (
          <VersionsPage
            onLaunch={(id) => {
              // Win 同款：菜单「启动」= 选中该版本回首页，由首页的启动按钮发起
              session.setVersion(id)
              setPage('home')
            }}
            onAskNova={(id) => {
              setNovaSeed(`帮我给 ${id} 做一次游戏体检，有隐患直接说`)
              setPage('nova')
            }}
          />
        )
      case 'download':
        return <DownloadPage />
      case 'saves':
        return <SavesPage />
      case 'friends':
        return <FriendsPage onGoLogin={() => setPage('accounts')} />
      case 'lab':
        return <LabPage />
      case 'projections':
        return <ProjectionsPage />
      case 'running':
        return <RunningPage session={session} onGoHome={() => setPage('home')} />
      case 'accounts':
        return <AccountsPage />
      case 'plugins':
        return <PluginsPage />
      case 'nova':
        return <NovaPage seed={novaSeed} />
      case 'logs':
        return <LogsPage session={session} />
      case 'settings':
        return <SettingsPage theme={theme} />
      default:
        return <HomePage session={session} onNavigate={(t) => setPage(t)} />
    }
  }

  return (
    <div className="win mica">
      <div className="bg-layer" aria-hidden />
      <TitleBar
        title={PAGE_LABEL[page]}
        themeMode={theme.mode}
        onCycleTheme={theme.cycle}
        actions={
          <>
            {/* 自绘标题栏快捷入口（Win 端：Nova / 调度中心 / 账户） */}
            <button
              className="tb-action-btn"
              title="Nova 助手"
              aria-label="Nova 助手"
              onClick={() => setPage('nova')}
            >
              {/* Nova = 品牌标记（多色，画不出字形） */}
              <img src={brandMark} alt="" width={16} height={16} />
            </button>
            <button
              className="tb-action-btn"
              title="调度中心"
              aria-label="调度中心"
              onClick={() => setTasksOpen(true)}
            >
              {/* Win 端同字形：ic_message_allread U+EC89（鸿蒙图标库） */}
              <span style={{ fontFamily: 'var(--font-icon)', fontSize: 15, lineHeight: 1 }}>
                {String.fromCharCode(0xec89)}
              </span>
            </button>
            <button
              className="tb-action-btn"
              title="账户"
              aria-label="账户"
              onClick={() => setPage('accounts')}
            >
              <IconUser size={16} />
            </button>
            {/* 主题切换在「设置 → 通用」里，标题栏不放 */}
          </>
        }
      >
        <span className="tb-brand">
          <img src={brandMark} alt="" width={18} height={18} />
        </span>
        <span className="tb-appname">Starcloud</span>
        <span className="tb-ver">{appVersion !== '' ? `开发版 V${appVersion}` : 'Linux'}</span>
      </TitleBar>
      <div className="win-body">
        <Nav page={page} dark={theme.resolved === 'dark'} running={running} onNavigate={setPage} />
        <main className="content">
          <LaunchOverlay
            session={session}
            versionId={session.launchVersion}
            onCancel={session.dismissLaunchError}
          />
          <ErrorBoundary key={page} label={PAGE_LABEL[page]}>
            <div className="page" key={page}>
              {render()}
            </div>
          </ErrorBoundary>
        </main>
      </div>
      {/* 调度中心抽屉（标题栏 ⊜ 按钮）：挂在 win-body 外，盖住内容区但不盖标题栏 */}
      <TaskDrawer
        open={tasksOpen}
        tasks={taskCenter.tasks}
        notifications={taskCenter.notifications}
        session={session}
        onClearNotifications={taskCenter.clearNotifications}
        onClose={() => setTasksOpen(false)}
      />
    </div>
  )
}
