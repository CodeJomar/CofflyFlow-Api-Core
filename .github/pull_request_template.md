## Qué cambia
<!-- Resumen en 1–3 líneas. Enlaza la tarea si existe. -->

## Tipo
- [ ] feature  - [ ] fix  - [ ] refactor  - [ ] docs / ci  - [ ] release (develop → prod)  - [ ] hotfix

## Checklist
- [ ] Compila y pasa lint (`npm run build` / `npm run lint`)
- [ ] Probé el flujo afectado (adjunto evidencia: respuesta, captura o log, **sin secretos**)
- [ ] Si hay **cambio de BD**: archivo `database-migracion-NN-*.sql` idempotente en `database/`, añadido a `database/database.sql` y aplicado en un entorno de prueba
- [ ] Si hay **permisos nuevos**: aparecen en `permission-matrix.ts` y se sembraron (`npm run seed:permisos`)
- [ ] Si cambia un **endpoint o evento WS**: avisé el impacto en la web y actualicé `docs/domain` del kit
- [ ] Si hay **variables de entorno nuevas**: añadidas a `.env.example`, a `env.validation.ts` y a Railway
- [ ] Sin datos sensibles en respuestas (ni UUID de usuarios) ni secretos en el código

## Riesgos y reversa
<!-- ¿Qué podría salir mal en producción y cómo se revierte? -->
