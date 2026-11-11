/**
 * Webhook directo de EMQX: la regla `avisar_conexiones` (software/broker/config/emqx.conf) hace un
 * POST a `/api/webhooks/conexiones` con cada conexión y desconexión de **cualquier** cliente, sin
 * filtrar. El cuerpo es el evento entero tal como lo arma EMQX (`$events/client_connected` o
 * `$events/client_disconnected`); acá se lo reduce a lo que muestra la web.
 */

export type AvisoConexion = {
  tipo: 'conectado' | 'desconectado'
  clientid: string
  usuario: string | null
  /** Solo en las desconexiones: el motivo en palabras (o el `reason` de EMQX si no se conoce). */
  motivo: string | null
  /** Cuándo pasó, en ms desde 1970, según el broker. */
  instante: number
}

const EVENTOS: Record<string, AvisoConexion['tipo']> = {
  'client.connected': 'conectado',
  'client.disconnected': 'desconectado',
}

/** Los `reason` de `client.disconnected` más comunes. */
const MOTIVOS: Record<string, string> = {
  normal: 'se desconectó normalmente',
  keepalive_timeout: 'dejó de responder',
  tcp_closed: 'se cortó la conexión',
  sock_closed: 'se cortó la conexión',
  sock_error: 'error en la conexión',
  takenover: 'otro cliente se conectó con el mismo client ID',
  discarded: 'otro cliente se conectó con el mismo client ID',
  kicked: 'lo desconectó el administrador',
}

/** Devuelve `null` si el cuerpo no es un evento de conexión o desconexión. */
export function aAvisoConexion(cuerpo: unknown, ahora = Date.now()): AvisoConexion | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const evento = cuerpo as Record<string, unknown>
  const tipo = typeof evento.event === 'string' ? EVENTOS[evento.event] : undefined
  if (!tipo || typeof evento.clientid !== 'string' || evento.clientid === '') return null

  const reason = typeof evento.reason === 'string' ? evento.reason : null
  return {
    tipo,
    clientid: evento.clientid,
    usuario: typeof evento.username === 'string' && evento.username !== '' ? evento.username : null,
    motivo: tipo === 'desconectado' && reason ? (MOTIVOS[reason] ?? reason) : null,
    instante: typeof evento.timestamp === 'number' ? evento.timestamp : ahora,
  }
}
