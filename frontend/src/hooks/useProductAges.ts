import { useEffect, useState } from 'react'
import { api } from '../api/client'

export interface ProductAge {
  product_id: number
  baked_date: string
  age_days: number
}

// Простий кеш на рівні модуля (один сеанс браузера, очищується при перезавантаженні)
const cache: Record<string, ProductAge[]> = {}

export function useProductAges(date: string) {
  const [ages, setAges] = useState<ProductAge[]>(cache[date] ?? [])

  useEffect(() => {
    if (cache[date]) {
      setAges(cache[date])
      return
    }
    api.get<ProductAge[]>(`/products/age?date=${date}`).then((data) => {
      cache[date] = data
      setAges(data)
    }).catch(() => {/* мовчки ігноруємо — бейдж просто не з'явиться */})
  }, [date])

  /** Повертає вік у днях для конкретного виробу, або null якщо невідомо. */
  const getAge = (productId: number): ProductAge | null =>
    ages.find((a) => a.product_id === productId) ?? null

  return { ages, getAge }
}
