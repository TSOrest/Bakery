import { api } from './client'

export interface AuditLogEntry {
  id: number
  entity_table: string
  entity_id: number
  changed_field: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string | null
}

export function fetchAuditLog(entityTable: string, entityId: number): Promise<AuditLogEntry[]> {
  return api.get<AuditLogEntry[]>(`/audit?entity_table=${entityTable}&entity_id=${entityId}`)
}
