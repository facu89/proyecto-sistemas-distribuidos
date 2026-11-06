/**
 * Opciones de prueba que se activan desde la URL, para comparar cosas en el navegador
 * sin tocar el código. Se pueden combinar: `/?fps&modelo=home.sin-compresion&sin-sombras`
 *
 * - `?fps`                       muestra un contador de cuadros por segundo (arriba a la izquierda)
 * - `?modelo=home.sin-compresion` carga otro .glb de ../modelos (generar_escena.py --sin-compresion)
 * - `?sin-sombras`               apaga las sombras, para ver cuánto cuestan
 */
const parametros = new URLSearchParams(window.location.search)

export const DEPURACION = {
  fps: parametros.has('fps'),
  modelo: parametros.get('modelo') ?? 'home',
  sombras: !parametros.has('sin-sombras'),
}
