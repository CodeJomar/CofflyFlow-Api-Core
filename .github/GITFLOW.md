# Flujo de ramas (Gitflow) y despliegue

```
feature/* ──PR──► develop ──PR (release)──► prod ──► Railway (despliegue automático)
                     ▲                        │
hotfix/*  ───────────┴──────PR urgente────────┘   (y se reintegra a develop)
```

## Ramas

| Rama | Para qué | Quién escribe |
|---|---|---|
| `prod` | Lo que está publicado. **Cada push despliega solo** (API y Web en Railway). | Solo PR desde `develop` o `hotfix/*` |
| `develop` | Integración. Aquí converge todo el trabajo del equipo. | PR desde `feature/*`, `fix/*`, `chore/*`, `docs/*`, `hotfix/*` (el dueño del proyecto también puede subir directo) |
| `feature/<tema>` | Una funcionalidad o corrección (ej. `feature/caja-devoluciones`). | Cada integrante |
| `hotfix/<tema>` | Arreglo urgente de producción. Sale de `prod`. | Quien lo atienda |

`main` es la rama de documentación del servicio (esquemas y contratos API) y `qa`, si el equipo la usa, es homologación: ninguna recibe despliegues automáticos. Solo `prod` publica.

## Día a día

1. `git switch develop && git pull` y luego `git switch -c feature/mi-tema`.
2. Commits con el formato **`tipo(ámbito): descripción`** (`feat`, `fix`, `docs`, `refactor`, `chore`, `ci`…). Ej.: `feat(orders): idempotencia al crear pedidos`.
3. Abre un PR hacia `develop`. Deben pasar **CI · API**, **CI · Web**, **Commits** y **Guardias de ramas**, más una revisión.
4. Para publicar: PR `develop → prod` (plantilla de release). Al fusionarlo, Railway despliega.
5. Hotfix: `git switch -c hotfix/tema prod`, PR hacia `prod`, y después un PR de `prod` hacia `develop` para no perder el arreglo.

## Reglas que se configuran en GitHub (no pueden ir en archivos)

Settings → Branches → *Add branch protection rule*:

**`prod`**
- Require a pull request before merging (1 aprobación y *Require review from Code Owners*).
- Require status checks: `API · tipos, lint, build y seguridad`, `Web · lint, build y seguridad`, `Rama de origen permitida`.
- Require branches to be up to date; Do not allow bypassing; Restrict force pushes y deletions.

**`develop`**
- Require status checks (los mismos). Block force pushes y deletions.
- Si el dueño sigue subiendo directo a `develop`, no marques *Require a pull request* aquí, pero conserva los checks para los PR del equipo.

## Repositorios

El proyecto vive en **dos repositorios de GitHub**, cada uno con su propio `.github` (CI, plantillas, CODEOWNERS) y este mismo flujo:

| Repositorio | Qué contiene | Despliega a Railway |
|---|---|---|
| `CofflyFlow-Api-Core` | API NestJS, `database/` (esquema y migraciones SQL) y `docker/` (docker-compose local) | Sí, servicio **API** |
| `CofflyFlow-Web-Core` | Web Next.js | Sí, servicio **Web** |

Los cambios que cruzan repositorios (por ejemplo, una migración SQL + la web que la usa) se hacen en este orden: primero la migración (en `database/` de la API, aplicada en la base), luego la API y por último la web.

## Railway (despliegue automático desde `prod`)

Dos servicios en el mismo proyecto de Railway. Cada uno se conecta a **su** repositorio (la raíz del repositorio es la raíz del servicio; ahí están su `Dockerfile` y su `railway.json`) y a la rama **`prod`**:

| Servicio | Repositorio | Health check |
|---|---|---|
| API | `CofflyFlow-Api-Core` | `/health/ready` |
| Web | `CofflyFlow-Web-Core` | `/` |

1. En cada servicio: Settings → Source → *Branch connected to production* = `prod`; activa **Wait for CI** para que no despliegue si los checks fallan.
2. Variables y pasos de cada servicio (en Railway, nunca en el repo): `.github/DEPLOY.md` de cada repositorio.
3. Cambios de base de datos: los `database/database-migracion-NN-*.sql` se aplican **antes** de fusionar a `prod`; el despliegue no los ejecuta.
