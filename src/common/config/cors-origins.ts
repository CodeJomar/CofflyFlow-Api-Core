/**
 * Orígenes web autorizados. Fuente única para CORS y para la verificación de Origin (CSRF).
 */
export function getCorsOrigins(): string[] {
  const configurados = process.env.CORS_ORIGIN?.split(',')
    .map((origen) => origen.trim())
    .filter(Boolean);
  return configurados?.length ? configurados : ['http://localhost:3000'];
}
