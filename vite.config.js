import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
    base: '/sistemajuan/',
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                accesovehicular: resolve(__dirname, 'accesovehicular.html'),
                add_cliente_unidad: resolve(__dirname, 'add_cliente_unidad.html'),
                add_puesto: resolve(__dirname, 'add_puesto.html'),
                add_unidad: resolve(__dirname, 'add_unidad.html'),
                consigna_permanente: resolve(__dirname, 'consigna_permanente.html'),
                consigna_temporal: resolve(__dirname, 'consigna_temporal.html'),
                ingresar_consigna: resolve(__dirname, 'ingresar_consigna.html'),
                ingresar_informacion: resolve(__dirname, 'ingresar_informacion.html'),
                menu: resolve(__dirname, 'menu.html'),
                peatonal: resolve(__dirname, 'peatonal.html'),
                registrar_incidente: resolve(__dirname, 'registrar_incidente.html'),
                registros: resolve(__dirname, 'registros.html'),
                ronda: resolve(__dirname, 'ronda.html'),
                salida: resolve(__dirname, 'salida.html'),
                salidavehicular: resolve(__dirname, 'salidavehicular.html'),
                ver_consignas: resolve(__dirname, 'ver_consignas.html'),
                ver_incidencias: resolve(__dirname, 'ver_incidencias.html'),
                ver_peatonal: resolve(__dirname, 'ver_peatonal.html'),
                ver_rondas_manuales: resolve(__dirname, 'ver_rondas_manuales.html'),
                ver_rondas_programadas: resolve(__dirname, 'ver_rondas_programadas.html'),
                ver_vehicular: resolve(__dirname, 'ver_vehicular.html'),
            }
        }
    }
});
