import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { render } from '@react-email/components';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { ActivacionCuentaEmail } from './templates/activacion-cuenta.email';
import { PasswordCambiadaEmail } from './templates/password-cambiada.email';
import { CodigoRecuperacionEmail } from './templates/codigo-recuperacion.email';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly remitente: string;

  constructor(private readonly config: ConfigService) {
    const puerto = Number(this.config.get('MAIL_PORT')) || 587;
    this.remitente = this.config.get<string>('MAIL_FROM') || this.config.get<string>('MAIL_USERNAME') || '';
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('MAIL_HOST'),
      port: puerto,
      secure: puerto === 465,
      // STARTTLS obligatorio salvo en el puerto 465 (TLS directo); MAIL_REQUIRE_TLS=false solo para servidores de prueba locales.
      requireTLS: puerto !== 465 && this.config.get<string>('MAIL_REQUIRE_TLS') !== 'false',
      auth: {
        user: this.config.get<string>('MAIL_USERNAME'),
        pass: this.config.get<string>('MAIL_PASSWORD'),
      },
    });
  }

  async enviarActivacion(para: string, nombre: string, enlace: string, horasValidez: number): Promise<void> {
    const html = await render(ActivacionCuentaEmail({ nombre, enlace, horasValidez }));
    await this.enviar(para, 'Activa tu cuenta de CofflyFlow', html);
  }

  async enviarCodigoRecuperacion(para: string, nombre: string, codigo: string, minutosValidez: number): Promise<void> {
    const html = await render(CodigoRecuperacionEmail({ nombre, codigo, minutosValidez }));
    await this.enviar(para, 'Tu código para recuperar la contraseña', html);
  }

  async enviarAvisoPasswordCambiada(para: string, nombre: string, fecha: string): Promise<void> {
    const html = await render(PasswordCambiadaEmail({ nombre, fecha }));
    await this.enviar(para, 'Cambiaste tu contraseña de CofflyFlow', html);
  }

  private async enviar(para: string, asunto: string, html: string): Promise<void> {
    try {
      const claveBrevo = this.config.get<string>('BREVO_API_KEY')?.trim();
      const claveResend = this.config.get<string>('RESEND_API_KEY')?.trim();
      // Con BREVO_API_KEY o RESEND_API_KEY se envía por la API HTTPS del proveedor (útil donde la plataforma bloquea los
      // puertos SMTP); sin ellas se usa el servidor SMTP configurado en MAIL_*.
      if (claveBrevo) await this.enviarPorBrevo(claveBrevo, para, asunto, html);
      else if (claveResend) await this.enviarPorResend(claveResend, para, asunto, html);
      else await this.transporter.sendMail({ from: this.remitente, to: para, subject: asunto, html });
    } catch (error) {
      // Nunca se registra el contenido del correo (contiene códigos/enlaces de un solo uso).
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`No se pudo enviar el correo "${asunto}": ${err.message}`);
      throw err;
    }
  }

  private async enviarPorResend(clave: string, para: string, asunto: string, html: string): Promise<void> {
    const respuesta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.remitente, to: [para], subject: asunto, html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!respuesta.ok) {
      // El cuerpo de error de Resend no incluye el contenido del correo: es seguro mostrar su mensaje.
      const detalle = (await respuesta.json().catch(() => null)) as { message?: string } | null;
      throw new Error(`Resend respondió ${respuesta.status}${detalle?.message ? `: ${detalle.message}` : ''}`);
    }
  }

  private async enviarPorBrevo(clave: string, para: string, asunto: string, html: string): Promise<void> {
    // El remitente puede venir como "Nombre <correo>" o solo como correo; en Brevo debe ser un remitente verificado.
    const partes = /^(.*?)\s*<([^>]+)>$/.exec(this.remitente);
    const sender = partes ? { name: partes[1].replace(/^"|"$/g, '') || undefined, email: partes[2] } : { email: this.remitente };
    const respuesta = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': clave, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender, to: [{ email: para }], subject: asunto, htmlContent: html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!respuesta.ok) {
      // El cuerpo de error de Brevo no incluye el contenido del correo: es seguro mostrar su mensaje.
      const detalle = (await respuesta.json().catch(() => null)) as { message?: string } | null;
      throw new Error(`Brevo respondió ${respuesta.status}${detalle?.message ? `: ${detalle.message}` : ''}`);
    }
  }
}
