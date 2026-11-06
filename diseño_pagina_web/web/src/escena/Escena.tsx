import type { EstadoActuadores } from '../estado'
import { CamaraAjustada } from './CamaraAjustada'
import { Iluminacion } from './Iluminacion'
import { Modelo } from './Modelo'

type Props = { estado: EstadoActuadores }

/** Todo lo que va dentro del <Canvas> de la home. */
export function Escena({ estado }: Props) {
  return (
    <>
      <CamaraAjustada />
      <Iluminacion lamparaEncendida={estado.luz} />
      <Modelo estado={estado} />
    </>
  )
}
