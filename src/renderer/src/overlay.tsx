/// Nova 游戏内浮窗的渲染入口（独立窗口：透明 + 无边框 + 置顶）。
/// 收到主进程推来的文案就显示；点它通知主进程打开主窗口的 Nova 对话。
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'

import { resolveInitialTheme } from './theme'
import './winui.css'

declare global {
  interface Window {
    overlay?: {
      onText: (handler: (text: string) => void) => void
      clicked: () => void
    }
  }
}

function Overlay(): JSX.Element {
  const [text, setText] = useState('')

  useEffect(() => {
    void resolveInitialTheme().then((theme) => {
      document.documentElement.setAttribute('data-theme', theme)
    })
    window.overlay?.onText((value) => setText(value))
  }, [])

  if (text === '') return <></>

  return (
    <div className="nova-overlay" onClick={() => window.overlay?.clicked()}>
      <div className="nova-overlay-badge">Nova</div>
      <div className="nova-overlay-text">{text}</div>
    </div>
  )
}

void resolveInitialTheme().then((initial) => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <Overlay />
    </React.StrictMode>
  )
})
