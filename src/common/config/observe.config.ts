import type { ObserveOptions } from '@nestjs/observe';

/**
 * Observabilidad (APM) con @nestjs/observe. Envía trazas y métricas a un servicio de TERCEROS
 * (https://observe.nestjs.com), así que es OPT-IN: solo se activa si existen OBSERVE_APP_KEY y OBSERVE_APP_SECRET
 * (se crean en esa web, gratis hasta 300 000 eventos al mes). Sin credenciales no se carga el módulo: no sale ningún
 * dato de la API y no hay errores 401 en los logs. OBSERVE_ENABLED=false lo apaga aunque haya credenciales.
 *
 * Privacidad: no se envía el usuario autenticado (`getUserId` sin definir), no se reenvían los logs
 * (`forwardLogs` apagado), no se trazan /health ni los endpoints de recuperación/activación y los parámetros
 * sensibles de la URL se enmascaran. Los secretos del APM nunca van en el código: solo variables de entorno.
 */
export function observeHabilitado(): boolean {
  return (
    process.env.OBSERVE_ENABLED !== 'false' &&
    Boolean(process.env.OBSERVE_APP_KEY?.trim()) &&
    Boolean(process.env.OBSERVE_APP_SECRET?.trim())
  );
}

export function opcionesObserve(): ObserveOptions {
  const muestreo = Number(process.env.OBSERVE_TRACES_SAMPLE_RATE ?? 1);

  return {
    appKey: process.env.OBSERVE_APP_KEY!.trim(),
    appSecret: process.env.OBSERVE_APP_SECRET!.trim(),
    serviceId: process.env.OBSERVE_SERVICE_ID?.trim() || 'cofflyflow-api',
    serviceVersion: process.env.OBSERVE_SERVICE_VERSION?.trim() || undefined,
    // Porcentaje de trazas que se envían (1 = todas). Bajarlo en producción con mucho tráfico.
    tracesSampleRate: Number.isFinite(muestreo) ? Math.min(1, Math.max(0, muestreo)) : 1,
    runtimeMetrics: true,
    forwardLogs: false,
    redaction: { keys: ['email', 'password', 'codigo', 'token', 'nueva_password'] },
    http: {
      // Ruido del orquestador y flujos con credenciales de un solo uso.
      ignore: [/^\/health/, /^\/api\/auth\/(activar|verificar-otp|restablecer-password|recuperar)/],
      queryParamsObfuscateRegex: /(token|codigo|code|otp|password|secret|key)/i,
    },
  };
}
