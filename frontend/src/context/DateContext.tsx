import { createContext, useContext, useState, type ReactNode } from 'react'

interface DateContextValue {
  workDate: string          // YYYY-MM-DD
  setWorkDate: (d: string) => void
}

const DateContext = createContext<DateContextValue | null>(null)

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function DateProvider({ children }: { children: ReactNode }) {
  const [workDate, setWorkDate] = useState(todayISO)
  return (
    <DateContext.Provider value={{ workDate, setWorkDate }}>
      {children}
    </DateContext.Provider>
  )
}

export function useWorkDate() {
  const ctx = useContext(DateContext)
  if (!ctx) throw new Error('useWorkDate must be used inside DateProvider')
  return ctx
}
