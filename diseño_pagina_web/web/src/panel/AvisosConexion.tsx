import type { Aviso } from '../bancal'

type Props = {
  avisos: Aviso[]
}

/**
 * Avisos arriba al centro, uno por conexión o desconexión de un cliente MQTT. Los manda EMQX con el
 * webhook directo (regla avisar_conexiones) y el servicio los reenvía por SSE. Cada uno dura 5 s
 * (useBancal lo saca de la lista).
 */
export function AvisosConexion({ avisos }: Props) {
  return (
    // role="status": los lectores de pantalla anuncian cada aviso nuevo sin interrumpir.
    <div className="flotante avisos" role="status" aria-live="polite">
      {avisos.map((aviso) => {
        const conectado = aviso.tipo === 'conectado'
        return (
          <div key={aviso.id} className="aviso" data-tipo={aviso.tipo}>
            <span className="punto-estado" data-estado={conectado ? 'ok' : 'error'} aria-hidden />
            <p className="aviso-texto">
              <strong>{aviso.clientid}</strong> {conectado ? 'se conectó' : 'se desconectó'}
              {aviso.usuario && aviso.usuario !== aviso.clientid && (
                <span className="aviso-detalle"> (usuario {aviso.usuario})</span>
              )}
              {aviso.motivo && <span className="aviso-detalle"> · {aviso.motivo}</span>}
            </p>
          </div>
        )
      })}
    </div>
  )
}
