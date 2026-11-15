import { FileText, Presentation } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMissionStore } from '@/store/useMissionStore'
import type { MissionTarget } from '@/types'

export function TopBar({ region, target }: { region: string; target: MissionTarget | undefined }) {
  const routeLength = useMissionStore((state) => state.route.length)
  const setBriefOpen = useMissionStore((state) => state.setBriefOpen)

  return (
    <header className="flex h-16 shrink-0 items-stretch border-b border-line bg-bg">
      <div className="flex items-center gap-3 border-r border-line px-5">
        <span className="h-7 w-[2px] bg-accent" aria-hidden />
        <div>
          <div className="text-[12px] font-semibold leading-tight tracking-[0.14em] text-ink">MERIDIAN 77</div>
          <div className="text-[10px] leading-tight text-faint">Jezero EVA planner</div>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-3 px-5">
        <span className="label hidden sm:inline">Objective</span>
        <span className="truncate text-[12px] text-ink">{target?.name ?? 'No target selected'}</span>
        <span className="meta hidden lg:inline">{region}</span>
      </div>

      <div className="ml-auto flex items-center gap-3 pr-4 sm:pr-5">
        <span className="meta hidden tabular-nums sm:inline">{String(routeLength).padStart(2, '0')} pts</span>
        <span className="meta hidden border-l border-line pl-4 md:inline">local data</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open('/sunum.html', '_blank', 'noopener,noreferrer')}
        >
          <Presentation className="h-3 w-3" aria-hidden />
          Sunum
        </Button>
        <Button variant="outline" size="sm" onClick={() => setBriefOpen(true)}>
          <FileText className="h-3 w-3" aria-hidden />
          Mission brief
        </Button>
      </div>
    </header>
  )
}
