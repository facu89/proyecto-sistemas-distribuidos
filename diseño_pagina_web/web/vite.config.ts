import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // El modelo vive fuera de web/ (en ../modelos/home.glb, lo genera Blender), y las reglas del
    // servicio (validación de los rangos) en software/servicio/src: el servidor de desarrollo tiene que
    // poder leer las dos carpetas.
    fs: { allow: ['..', '../../software/servicio/src'] },
    // El estado de los bancales lo da el servicio (software/servicio, `pnpm dev` allá).
    // En desarrollo, Vite le reenvía /api; en producción el servicio sirve la web y no hace falta.
    proxy: { '/api': 'http://localhost:8080' },
  },
})
