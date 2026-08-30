import { useEffect, useState } from 'react'

import { AppShell } from './components/AppShell'
import { useRoute } from './lib/router'
import { useHealth } from './lib/useHealth'
import { BriefEditor } from './views/BriefEditor'
import { RecordingsList } from './views/RecordingsList'
import { RunGrid } from './views/RunGrid'
import { Speedrun } from './views/Speedrun'

export function App() {
  const route = useRoute()
  const health = useHealth()

  // The rail keeps pointing at whatever Brief and run you last opened, so
  // moving between speedrun, editor and grid never loses your place.
  const routeBriefId =
    route.view === 'speedrun' || route.view === 'brief' || route.view === 'launch'
      ? route.briefId
      : null
  const routeRunId = route.view === 'run' ? route.runId : null

  const [briefId, setBriefId] = useState<string | null>(routeBriefId)
  const [runId, setRunId] = useState<string | null>(routeRunId)

  useEffect(() => {
    if (routeBriefId !== null) {
      setBriefId(routeBriefId)
    }
  }, [routeBriefId])

  useEffect(() => {
    if (routeRunId !== null) {
      setRunId(routeRunId)
    }
  }, [routeRunId])

  return (
    <AppShell
      route={route}
      briefId={briefId}
      runId={runId}
      bleed={route.view === 'speedrun'}
      health={health}
    >
      {route.view === 'recordings' ? <RecordingsList /> : null}
      {route.view === 'speedrun' ? <Speedrun briefId={briefId} /> : null}
      {route.view === 'brief' ? <BriefEditor briefId={briefId} /> : null}
      {route.view === 'launch' ? <RunGrid runId={null} briefId={briefId} /> : null}
      {route.view === 'run' ? <RunGrid runId={runId} briefId={briefId} /> : null}
    </AppShell>
  )
}
