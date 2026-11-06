import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // El modelo vive fuera de web/ (en ../modelos/home.glb, lo genera Blender).
    // Se habilita la carpeta de arriba para que el servidor de desarrollo pueda leerlo.
    fs: { allow: ['..'] },
  },
})
