# Guion de voz en off — "El módulo de Contenido" (stop motion, 88 s)

Video: `video-contenido/freeticket-modulo-contenido.mp4` (1920×1080, 12 fps en dos, sin audio).
Los subtítulos del video repiten estas frases; la voz puede leerlas tal cual o relajarlas un poco.
Tiempos a 12 fotogramas por segundo.

| # | Tiempo | Pantalla | Voz en off |
|---|--------|----------|------------|
| 0 | 0:00–0:03 | Logo FreeTicket y título | "Así funciona el módulo de Contenido de FreeTicket, desde el panel del artista." |
| 1 | 0:03–0:09 | Biblioteca con zoom al menú lateral | "Entras por el menú Contenido. Viene con el plan Star." |
| 2 | 0:09–0:13 | Página Membresías, plan Club Luna | "Antes de publicar, creas tu membresía: es lo que tus fans pagan para ver el contenido." |
| 3 | 0:13–0:17 | Toggle Contenido / Comunidad | "Dos pestañas. Contenido es tu biblioteca de videos y series. Comunidad es tu feed." |
| 4 | 0:17–0:25 | Tarjetas, zoom a una serie, filtros | "Cada video o serie es una tarjeta: tipo, fecha, vistas, reacciones y si está publicada o en borrador. Filtras por tipo y estado, en cuadrícula o en lista." |
| 5 | 0:25–0:33 | Menú Subir contenido y diálogo Subir video | "Subir contenido: video o serie. Título, descripción y arrastras el archivo. Se procesa solo. Y 'Solo para miembros' viene marcado: lo exclusivo queda detrás de la membresía." |
| 6 | 0:33–0:38 | Editor de serie con portada | "Las series agrupan videos bajo una portada: sesiones acústicas, detrás del tour, lo que quieras." |
| 7 | 0:38–0:44 | Pestaña Comunidad | "En Comunidad tienes arriba la moderación, los canales y los encuentros. Abajo, el compositor: ¿qué quieres compartir con tu comunidad?" |
| 8 | 0:44–0:54 | Compositor: texto, elegir evento, candado, publicar | "Escribes. Adjuntas una imagen o un show: eliges el evento y queda como tarjeta con fecha y lugar. El candado lo deja solo para miembros, el reloj lo programa, el numeral elige el canal. Y publicas, ahora o cuando tú digas." |
| 9 | 0:54–1:01 | Post fijado con comentarios | "Fijas el anuncio arriba del espacio. Los comentarios se ven aquí mismo, y lo que sobra se borra con un clic." |
| 10 | 1:01–1:07 | Editor de artículo | "Para textos largos, artículos: portada, vista previa en vivo, tiempo de lectura y enlace público. Y si te trabas, Redactar con Claude arma el encargo por ti." |
| 11 | 1:07–1:12 | Diálogo Redactar con Claude | "Tema, tono, extensión y a quién le habla. Copias el encargo o lo abres en Claude y traes el resultado al editor." |
| 12 | 1:12–1:17 | Moderación | "Lo que tu comunidad reporta llega a Moderación: ocultas, ignoras, expulsas o borras. Tres reportes de miembros distintos ocultan un comentario solos." |
| 13 | 1:17–1:23 | Canales y Encuentros | "Canales: Anuncios para ti, General para todos y los que crees por ciudad. Encuentros gratis para miembros, con cupo y confirmación de asistencia." |
| 14 | 1:23–1:28 | Cierre con collage y logo | "Todo tu contenido, tu comunidad y tus shows en un solo lugar. FreeTicket." |

## Notas de producción

- Las capturas son del admin real (`free-admin`, rama main del 20 de octubre) corriendo en local con un workspace de demostración ("Luna Marín", plan Star, membresía "Club Luna"). Los datos son ficticios; la interfaz es la real.
- El video no lleva audio. Para la versión final: grabar la voz sobre esta tabla y, si se quiere, una pista de música suave con "clics" de papel en los cambios de escena.
- Para regenerar o cambiar textos: el escenario es un HTML (`stage.html`) y cada escena es una función; se vuelve a renderizar con Playwright y se codifica con ffmpeg.
