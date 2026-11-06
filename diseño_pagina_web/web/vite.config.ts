import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // El modelo vive fuera de web/ (en ../modelos/home.glb, lo genera Blender).
    // Se habilita la carpeta de arriba para que el servidor de desarrollo pueda leerlo.
    fs: { allow: ['..'] },
    // El estado de los bancales lo da el servicio (software/servicio, `pnpm dev` allá).
    // En desarrollo, Vite le reenvía /api; en producción el servicio sirve la web y no hace falta.
    proxy: { '/api': 'http://localhost:8080' },
  },
})
